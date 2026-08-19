"""La boucle d'appel : ce qui fait tourner les pièces ensemble (ticket 4.18).

Toutes les pièces existaient depuis les lots précédents — composer, transcrire,
décider, formuler, synthétiser, masquer la latence. Il manquait ce qui les
enchaîne pendant qu'une personne réelle est au bout du fil.

Ce module ne décide de rien et ne formule rien. Il fait trois choses :

  * il donne la parole à l'agent en premier, toujours (US-2) ;
  * il transmet au pilote CE QUI A ÉTÉ DIT, une fois la phrase terminée ;
  * il coupe l'agent dès que la personne reprend la parole.

── Pourquoi n'agir que sur une transcription DÉFINITIVE ────────────────────
Un fragment est une hypothèse : « je peux pas » devient « je peux pas payer
avant le quinze » trois cents millisecondes plus tard. Répondre au fragment,
c'est répondre à une phrase que personne n'a dite — et couper la parole à
quelqu'un qui n'avait pas fini.

Les fragments servent quand même : leur seule ARRIVÉE prouve que la personne
parle, ce qui suffit à faire taire l'agent.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from voice.core.conversation import DunningConversation, Outcome
from voice.core.interfaces import SpeechToText, TranscriptSegment


#: En deçà, ce n'est pas quelqu'un qui parle : c'est de l'écho ou du bruit.
#: Deux mots, parce qu'un « allô » isolé doit encore pouvoir couper l'agent —
#: mais pas un souffle transcrit en « euh ».
MOTS_POUR_COUPER = 2


async def conduire_appel(
    conversation: DunningConversation,
    stt: SpeechToText,
    audio_entrant: AsyncIterator[bytes],
    *,
    duree_max_s: float = 300.0,
) -> Outcome:
    """Mène une conversation du décroché au raccroché.

    `duree_max_s` n'est pas une précaution de confort : un appel qui ne se
    termine jamais reste facturé et occupe la ligne. Cinq minutes est déjà très
    long pour une relance — au-delà, quelque chose s'est mal passé.
    """
    # DEUX tâches, et c'est le point du module. Faire écouter et parler la même
    # tâche paraît plus simple — mais pendant que l'agent parle, elle n'irait
    # pas chercher ce qui arrive du débiteur. L'interruption ne pourrait alors
    # jamais se déclencher AU MOMENT où elle sert, c'est-à-dire pendant que
    # l'agent parle. Le défaut est invisible en lecture et évident à l'oreille.
    tours: asyncio.Queue[str | None] = asyncio.Queue()

    async def ecouter() -> None:
        try:
            async for segment in stt.transcribe(audio_entrant):
                # « L'arrivée d'un fragment prouve que la personne parle » : je
                # l'ai écrit, et c'est FAUX au téléphone. La voix de l'agent
                # revient en écho, un souffle suffit à produire un fragment, et
                # l'agent se coupait lui-même — constaté au premier appel réel.
                #
                # Il faut donc de la PAROLE, pas du signal : un tour terminé, ou
                # un fragment déjà assez fourni pour ne pas être un bruit.
                if segment.is_final or len(segment.text.split()) >= MOTS_POUR_COUPER:
                    await conversation.barge_in()

                if segment.is_final and segment.text.strip():
                    await tours.put(segment.text.strip())
        finally:
            await tours.put(None)

    # L'écoute démarre AVANT l'annonce, et pas après : c'est justement pendant
    # qu'on se présente qu'on se fait couper — « c'est à quel sujet ? ». Une
    # écoute qui ne commence qu'après l'annonce laisse l'agent débiter sa
    # présentation par-dessus quelqu'un qui parle déjà.
    ecoute = asyncio.create_task(ecouter())
    await conversation.announce()

    async def conduire() -> Outcome | None:
        while True:
            propos = await tours.get()
            if propos is None:
                return None
            await conversation.handle(propos)
            if conversation.state.outcome is not None:
                return conversation.state.outcome

    try:
        issue = await asyncio.wait_for(conduire(), timeout=duree_max_s)
    except TimeoutError:
        # On ne laisse pas la ligne ouverte. L'issue reste honnête : personne
        # n'a rien promis, et rien ne permet de dire que l'appel a abouti.
        issue = None
    finally:
        ecoute.cancel()

    if issue is not None:
        return issue

    # Le flux s'est tari sans issue métier : le débiteur a raccroché, ou n'a
    # jamais rien dit d'exploitable. `close` refusera de conclure sur une
    # promesse non confirmée — c'est l'US-3, et elle vaut aussi ici.
    if conversation.state.promise_obtained and conversation.state.promise_confirmed:
        await conversation.close(Outcome.PROMISE)
        return Outcome.PROMISE

    await conversation.close(Outcome.UNREACHABLE)
    return Outcome.UNREACHABLE


async def segments_finaux(
    stt: SpeechToText, audio: AsyncIterator[bytes]
) -> AsyncIterator[TranscriptSegment]:
    """Ne garde que les tours de parole terminés. Utile aux essais hors ligne."""
    async for segment in stt.transcribe(audio):
        if segment.is_final and segment.text.strip():
            yield segment
