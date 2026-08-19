"""Transcription EN CONTINU, sur connexion permanente (ticket 4.18, ADR 004).

Implements `voice.core.interfaces.SpeechToText`.

**Pourquoi pas une requête HTTP par phrase.** Mesuré le 19 août 2026 sur du
français en µ-law 8 kHz : une transcription en lot rend son résultat 1 417 ms
après la fin de parole ; en continu, 154 ms. Mille deux cents millisecondes
ajoutées à chaque tour, quand une conversation téléphonique en tolère 200 à 500
en tout.

L'écart n'est pas un réglage de fournisseur : une transcription en lot ne peut
commencer qu'une fois la phrase terminée, tandis qu'une transcription en continu
travaille pendant qu'on parle et ne paie que la fin.

**Pourquoi ça ne passe pas par `lib/llm`.** Parce que `lib/llm` ne connaît que
des requêtes ponctuelles, et qu'une connexion permanente n'en est pas une. C'est
une sortie vers un modèle assumée hors de la porte unique, et l'ADR 004 dit
précisément ce qu'elle a le droit de faire : transporter de la voix, jamais
formuler. Ce que l'agent DIT continue de passer par `/relance/formulation`, où
chaque phrase est vérifiée avant d'être prononcée.

**Ce qui traverse ici, c'est la parole du débiteur** — la donnée la plus
sensible de l'appel. Elle n'est jamais journalisée (règle 6) et n'est conservée
que par la transcription de l'appel, elle-même effaçable (US-8).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass

import websockets

from voice.core.interfaces import TranscriptSegment

#: Session de transcription seule — le modèle n'y répond pas, il écoute.
URL = "wss://api.openai.com/v1/realtime?intent=transcription"

#: G.711 µ-law : ce que porte une ligne téléphonique. Transcoder en PCM 24 kHz
#: pour « améliorer » l'entrée ne rajouterait pas l'information perdue par le
#: réseau — ça ajouterait seulement une conversion dans le chemin temps réel.
FORMAT_TELEPHONE = "audio/pcmu"

#: Modèle en flux continu. Il REFUSE toute segmentation côté serveur (vérifié :
#: « Turn detection is not supported for this transcription model ») et c'est
#: cohérent — il transcrit au fil de l'eau, la fin de tour se décide ailleurs.
MODELE_CONTINU = "gpt-live-transcribe"

#: Journal de DIAGNOSTIC : compteurs et codes seulement. Jamais un mot de ce que
#: le débiteur a dit — c'est la donnée la plus sensible de l'appel (règle 6).
log = logging.getLogger("voice.stt")


class RealtimeSttConfigError(RuntimeError):
    """Configuration absente. Ne porte jamais la valeur d'une clé."""


@dataclass(frozen=True, slots=True)
class RealtimeSttConfig:
    api_key: str
    model: str = MODELE_CONTINU
    url: str = URL

    @staticmethod
    def from_env() -> RealtimeSttConfig:
        # `VOICE_REALTIME_API_KEY` et non `VOICE_STT_API_KEY` : depuis l'ADR
        # 004 la transcription se fait en continu chez le même fournisseur que
        # les sessions temps réel. Lire l'ancienne variable envoyait la clé
        # Gladia à OpenAI — rejet, connexion fermée, et un appel classé
        # « injoignable » alors que la personne parlait.
        cle = os.environ.get("VOICE_REALTIME_API_KEY", "")
        if not cle:
            raise RealtimeSttConfigError("VOICE_REALTIME_API_KEY is not set")
        return RealtimeSttConfig(
            api_key=cle,
            # `or` et non le défaut de `get` : une variable présente mais VIDE
            # — l'état courant d'un `.env` recopié — demanderait un modèle sans
            # nom, et l'erreur n'arriverait qu'au premier appel réel.
            model=os.environ.get("VOICE_STT_MODEL") or MODELE_CONTINU,
        )


class RealtimeSpeechToText:
    """Transcrit un flux audio au fil de l'eau."""

    def __init__(self, config: RealtimeSttConfig) -> None:
        self._config = config

    def _session(self) -> str:
        return json.dumps({
            "type": "session.update",
            "session": {
                "type": "transcription",
                "audio": {
                    "input": {
                        "format": {"type": FORMAT_TELEPHONE},
                        "transcription": {"model": self._config.model, "language": "fr"},
                        "turn_detection": None,
                    },
                },
            },
        })

    async def transcribe(
        self, audio: AsyncIterator[bytes], *, language: str = "fr"
    ) -> AsyncIterator[TranscriptSegment]:
        cfg = self._config
        async with websockets.connect(
            cfg.url,
            additional_headers={"Authorization": f"Bearer {cfg.api_key}"},
            max_size=None,
        ) as ws:
            await ws.send(self._session())
            log.info("[stt] session ouverte (%s)", cfg.model)
            trames = 0
            evenements: dict[str, int] = {}

            async def emettre() -> None:
                nonlocal trames
                """Pousse l'audio sans attendre les résultats.

                Séparé de la lecture parce que les deux sens sont indépendants :
                attendre une transcription avant d'envoyer la trame suivante
                ferait avancer la conversation au rythme du réseau, pas à celui
                de la personne qui parle.
                """
                async for morceau in audio:
                    if morceau:
                        trames += 1
                        if trames % 250 == 0:
                            log.info("[stt] %d trames envoyées", trames)
                        await ws.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": base64.b64encode(morceau).decode(),
                        }))

            envoi = asyncio.create_task(emettre())
            try:
                async for brut in ws:
                    e = json.loads(brut)
                    t = e.get("type", "")
                    evenements[t] = evenements.get(t, 0) + 1

                    if t == "error":
                        # Le CODE seul : le message peut contenir un fragment de
                        # ce que le débiteur vient de dire.
                        code = e.get("error", {}).get("code", "inconnu")
                        raise RuntimeError(f"transcription refusée : {code}")

                    if t.endswith("input_audio_transcription.delta"):
                        if e.get("delta"):
                            yield TranscriptSegment(text=e["delta"], is_final=False)
                    elif t.endswith("input_audio_transcription.completed"):
                        # `is_final` décide du tour de parole : agir sur un
                        # fragment ferait parler l'agent par-dessus la personne.
                        yield TranscriptSegment(
                            text=e.get("transcript", ""), is_final=True
                        )
            finally:
                envoi.cancel()
                # Ce qui a été VU, pas ce qui a été dit : des types d'événements
                # et des compteurs. C'est ce qui manquait pour comprendre
                # pourquoi la session se fermait aussitôt.
                log.info(
                    "[stt] session close — %d trames envoyées, événements : %s",
                    trames, evenements or "aucun",
                )
