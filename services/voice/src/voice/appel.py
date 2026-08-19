"""Passer un appel, pour de vrai (ticket 4.18, lot 6).

    uv run python -m voice.appel +33XXXXXXXXX JETON

Le jeton vient de `POST /relance/campagnes/:id/appels`, qui ne le rend qu'une
fois. Il identifie l'appel ET authentifie le worker : c'est lui qui permet au
serveur de résoudre le tenant sans que ce processus ait à le nommer.

── L'ordre des opérations, et pourquoi il est celui-là ─────────────────────
1. l'amorce est synthétisée AVANT de composer, hors du chemin temps réel ;
2. le serveur d'écoute est ouvert AVANT l'appel — Twilio s'y connecte dès le
   décroché, et une connexion refusée fait échouer l'appel en silence ;
3. on compose, et on attend le décroché ;
4. la conversation tourne dans la session média ;
5. on raccroche, toujours, même si la conversation a levé.

── Ce que ce module ne fait pas ────────────────────────────────────────────
Il ne décide rien. Le mandat, l'insistance, l'échelonnement, la formulation :
tout vient du serveur. Ce fichier est un câblage, et c'est tout ce qu'il doit
rester.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import sys

import websockets

from voice.adapters.elevenlabs_tts import ElevenLabsConfig, ElevenLabsTextToSpeech
from voice.adapters.formulation_http import FormulationConfig, HttpPhrasing
from voice.adapters.mandate_http import HttpMandateGateway, MandateConfig
from voice.adapters.prelude_cache import CachedPrelude
from voice.adapters.realtime_stt import RealtimeSpeechToText, RealtimeSttConfig
from voice.adapters.twilio_media import SessionMedia
from voice.adapters.twilio_telephony import TwilioConfig, TwilioTelephony
from voice.core.call_loop import conduire_appel
from voice.core.conversation import DunningConversation, Outcome
from voice.core.interfaces import CallOutcome

#: Journal volontairement pauvre : ni transcription, ni numéro, ni réplique.
#: La règle 6 vaut ici plus qu'ailleurs — ce processus VOIT la conversation.
logging.basicConfig(level=logging.INFO, format="[appel] %(message)s")
log = logging.getLogger("voice.appel")

PORT = int(os.environ.get("VOICE_WORKER_PORT") or 8080)

#: Garde-fou, pas un rythme : la boucle a déjà sa propre borne. Celui-ci existe
#: pour le cas où la conversation ne rendrait jamais la main du tout.
DUREE_MAX_APPEL_S = 360.0


async def main(numero: str, jeton: str) -> int:
    tel = TwilioTelephony(TwilioConfig.from_env())
    tts = ElevenLabsTextToSpeech(ElevenLabsConfig.from_env())
    stt = RealtimeSpeechToText(RealtimeSttConfig.from_env())
    passerelle = HttpMandateGateway(MandateConfig.from_env(jeton))
    formulation = HttpPhrasing(FormulationConfig.from_env())

    # Payée maintenant, hors appel : c'est tout l'intérêt de l'amorce.
    amorce = CachedPrelude(tts)
    await amorce.warm_up()
    log.info("amorce prête (%.2f s)", amorce.duree_secondes)

    boucle = asyncio.get_running_loop()
    connectee: asyncio.Future[SessionMedia] = boucle.create_future()
    terminee: asyncio.Future[Outcome] = boucle.create_future()

    async def accueillir(ws: websockets.ServerConnection) -> None:
        session = SessionMedia(ws=ws)
        if not connectee.done():
            connectee.set_result(session)

        conversation = DunningConversation(
            stt=stt,
            tts=tts,
            telephony=tel,
            gateway=passerelle,
            phrasing=formulation,
            prelude=amorce,
            sink=session,
        )
        # `inbound_audio` alimente la transcription ET renseigne `stream_sid` au
        # passage : il faut donc l'ouvrir avant d'espérer pouvoir répondre.
        try:
            issue = await conduire_appel(conversation, stt, session.inbound_audio())
            log.info("issue métier : %s", issue.value)
            if not terminee.done():
                terminee.set_result(issue)
        except Exception as err:
            # Rattrapé volontairement : on RACCROCHE quoi qu'il arrive.
            log.error("la conversation a échoué : %s", type(err).__name__)
            if not terminee.done():
                terminee.set_exception(err)

    # Le serveur AVANT l'appel : Twilio se connecte dès le décroché, et une
    # connexion refusée fait échouer l'appel sans message clair.
    async with websockets.serve(accueillir, "0.0.0.0", PORT):
        log.info("écoute sur le port %d", PORT)
        session_tel = await tel.dial(numero, caller_id=os.environ["TELEPHONY_CALLER_ID"])
        log.info("transport : %s", session_tel.outcome.value)

        if session_tel.outcome is not CallOutcome.ANSWERED:
            return 1

        try:
            # Twilio a décroché : sa connexion ne devrait plus tarder.
            await asyncio.wait_for(connectee, timeout=15)
        except TimeoutError:
            log.error(
                "décroché mais aucune connexion média — "
                "l'URL du flux est-elle joignable depuis l'extérieur ?"
            )
            await tel.hang_up(session_tel.id)
            return 1

        # On attend la FIN de la conversation, et non un délai arbitraire :
        # une attente fixe raccrocherait au nez du débiteur en pleine phrase.
        # `DUREE_MAX_APPEL_S` reste un garde-fou, pas un rythme.
        try:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(terminee, timeout=DUREE_MAX_APPEL_S)
        finally:
            # TOUJOURS : une ligne laissée ouverte est facturée et occupe le
            # numéro, même quand la conversation a levé.
            await tel.hang_up(session_tel.id)

    await tel.aclose()
    await passerelle.aclose()
    await formulation.aclose()
    await tts.aclose()
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage : python -m voice.appel +33XXXXXXXXX JETON", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(asyncio.run(main(sys.argv[1], sys.argv[2])))
