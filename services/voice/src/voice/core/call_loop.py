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
import logging
import re
from collections.abc import AsyncIterator

from voice.core.conversation import DunningConversation, Outcome
from voice.core.interfaces import SpeechToText, TranscriptSegment

#: En deçà, ce n'est pas quelqu'un qui parle : c'est de l'écho ou du bruit.
#: Deux mots, parce qu'un « allô » isolé doit encore pouvoir couper l'agent —
#: mais pas un souffle transcrit en « euh ».
MOTS_POUR_COUPER = 2

#: Compteurs seulement — jamais un mot de la conversation (règle 6).
log = logging.getLogger("voice.boucle")

#: Combien de silence fait la fin d'une phrase.
#:
#: Le modèle de transcription en continu n'émet JAMAIS d'événement « terminé » —
#: mesuré au banc du 19 août : « partiel 154 ms | final — » sur les trois tours.
#: Il transcrit au fil de l'eau et refuse toute segmentation côté serveur. La
#: fin de tour se décide donc ici.
#:
#: Constaté au troisième appel réel : l'annonce passait, la personne parlait, et
#: l'agent ne répondait jamais — il attendait un signal qui n'existe pas.
#:
#: 400 ms, revu à la baisse après le huitième appel réel.
#:
#: Ce seuil ne retarde pas seulement la réponse : il retarde l'AMORCE, qui ne
#: peut se déclencher qu'une fois le tour clos. Six cents millisecondes de
#: silence s'ajoutaient donc au blanc AVANT que le dispositif censé le masquer
#: n'entre en jeu. C'est le premier morceau du délai, et le seul que rien ne
#: couvre.
#:
#: En dessous de 400 ms on coupe les gens qui marquent un temps au milieu d'une
#: phrase — et depuis que l'amorce suit immédiatement, une coupure prématurée
#: fait parler l'agent PAR-DESSUS eux. Le compromis se paie donc des deux côtés.
#:
#: Un fournisseur qui sait clore ses tours reste prioritaire : `is_final`
#: court-circuite cette attente.
SILENCE_FIN_DE_TOUR_S = 0.4


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

    echec: list[BaseException] = []

    # Les fragments passent par une file INTERMÉDIAIRE, et ce n'est pas un
    # détour gratuit. `asyncio.wait_for` ANNULE ce qu'il attend quand le délai
    # expire : appliqué directement au générateur de transcription, il le
    # cassait au premier silence, et tout appel suivant signalait « flux
    # terminé ». L'appel se concluait donc `unreachable` six cents
    # millisecondes après l'annonce — avant que la personne ait parlé.
    # Annuler un `get()` de file, en revanche, ne casse rien.
    fragments: asyncio.Queue[TranscriptSegment | None] = asyncio.Queue()

    async def pomper() -> None:
        """Vide la transcription dans la file, sans jamais être annulée."""
        try:
            async for segment in stt.transcribe(audio_entrant):
                await fragments.put(segment)
        except Exception as err:
            # Une transcription qui meurt ressemble EXACTEMENT à un débiteur
            # qui se tait. On garde l'erreur pour la relever après, plutôt que
            # de la perdre dans une tâche que personne n'attend.
            echec.append(err)
        finally:
            log.info("[boucle] la transcription s'est terminée")
            await fragments.put(None)

    async def ecouter() -> None:
        tampon = ""
        while True:
            try:
                segment = await asyncio.wait_for(
                    fragments.get(), timeout=SILENCE_FIN_DE_TOUR_S
                )
            except TimeoutError:
                # Plus rien depuis un moment : la personne a fini sa phrase.
                # C'est NOUS qui le décidons — voir `SILENCE_FIN_DE_TOUR_S`.
                if tampon.strip():
                    await tours.put(tampon.strip())
                    tampon = ""
                continue

            if segment is None:
                break

            # « L'arrivée d'un fragment prouve que la personne parle » : je
            # l'ai écrit, et c'est FAUX au téléphone. La voix de l'agent revient
            # en écho, un souffle suffit à produire un fragment, et l'agent se
            # coupait lui-même — constaté au premier appel réel.
            #
            # Il faut donc de la PAROLE, pas du signal : on juge sur ce qui
            # s'est accumulé, pas sur le fragment isolé qui vient d'arriver.
            #
            # Les espaces sont NORMALISÉS : un fragment arrive déjà avec le
            # sien, et en ajouter un second donnait « ne me  rappelez plus »,
            # qui ne correspond plus à rien.
            accumule = re.sub(r"\s+", " ", f"{tampon} {segment.text}").strip()
            if segment.is_final or len(accumule.split()) >= MOTS_POUR_COUPER:
                await conversation.barge_in()

            if segment.is_final:
                tampon = ""
                if accumule:
                    await tours.put(accumule)
            else:
                tampon = accumule

        if tampon.strip():
            await tours.put(tampon.strip())
        await tours.put(None)

    # L'écoute démarre AVANT l'annonce, et pas après : c'est justement pendant
    # qu'on se présente qu'on se fait couper — « c'est à quel sujet ? ». Une
    # écoute qui ne commence qu'après l'annonce laisse l'agent débiter sa
    # présentation par-dessus quelqu'un qui parle déjà.
    pompe = asyncio.create_task(pomper())
    ecoute = asyncio.create_task(ecouter())
    await conversation.announce()

    async def conduire() -> Outcome | None:
        while True:
            propos = await tours.get()
            if propos is None:
                return None

            avant = len(conversation.state.history)
            await conversation.handle(propos)
            if conversation.state.outcome is not None:
                return conversation.state.outcome

            # `handle` ne sait répondre qu'aux quatre phrases de CLÔTURE. Tout
            # le reste — « je peux pas tout payer », « rappelez-moi demain »,
            # une question — le laissait muet : il enregistrait et se taisait.
            # Constaté au sixième appel réel, où la transcription marchait
            # parfaitement et où l'agent n'a pourtant rien dit.
            #
            # Faute de savoir ce que la personne VEUT, on fait ce qu'un
            # chargé de relance fait par défaut : on redemande une date. Le
            # noyau borne cette insistance à deux, et refuse au-delà — c'est
            # lui qui décide, pas cette boucle.
            #
            # C'est un REPLI, pas une compréhension. Reconnaître une demande
            # d'échelonnement, une contestation nuancée ou une promesse
            # demande une classification par le modèle, côté serveur, avec ses
            # gardes. Tant qu'elle n'existe pas, l'agent tient la
            # conversation sans jamais prétendre avoir compris.
            if len(conversation.state.history) == avant + 1:
                # Rien n'a été dit en réponse : seul le tour du débiteur est
                # entré dans l'historique.
                if not await conversation.nudge_for_date():
                    # Quota d'insistance épuisé : on ne harcèle pas.
                    return Outcome.UNREACHABLE

    try:
        issue = await asyncio.wait_for(conduire(), timeout=duree_max_s)
    except TimeoutError:
        # On ne laisse pas la ligne ouverte. L'issue reste honnête : personne
        # n'a rien promis, et rien ne permet de dire que l'appel a abouti.
        issue = None
    finally:
        ecoute.cancel()
        pompe.cancel()

    if echec:
        # Levée APRÈS l'annulation de l'écoute : une panne technique n'est pas
        # une issue métier, et la maquiller en `unreachable` fausserait le
        # compte-rendu au dirigeant.
        raise echec[0]

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
