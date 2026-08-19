"""La boucle d'appel — ce qui se passe pendant qu'une personne est au bout du fil.

Ce que ces tests protègent :

  a. l'agent s'annonce AVANT d'écouter quoi que ce soit (US-2) ;
  b. il n'agit que sur une phrase TERMINÉE — répondre à un fragment, c'est
     répondre à une phrase que personne n'a dite ;
  c. il se tait dès que la personne reprend la parole, y compris sur un simple
     fragment : leur arrivée suffit à prouver qu'elle parle ;
  d. un appel qui ne finit jamais est borné — la ligne reste facturée.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field

import pytest

from voice.core.call_loop import (
    MOTS_POUR_COUPER,
    SILENCE_FIN_DE_TOUR_S,
    conduire_appel,
)
from voice.core.conversation import (
    DunningConversation,
    InstalmentDecision,
    Intent,
    Outcome,
    Turn,
)
from voice.core.interfaces import TranscriptSegment
from voice.core.simulation import SimulatedTelephony, SimulatedTextToSpeech


@dataclass
class StubGateway:
    async def may_nudge(self, nudges_so_far: int) -> bool:
        return nudges_so_far < 2

    async def decide_instalment(
        self, *, instalments: int, first_payment_in_days: int, last_payment_late_days: int
    ) -> InstalmentDecision:
        return InstalmentDecision(granted=False)

    async def opening_line(self) -> str:
        return "Bonjour, je suis l'assistant automatique de Dubois."


@dataclass
class StubPhrasing:
    async def line(
        self, intent: Intent, *, facts: Mapping[str, str], history: Sequence[Turn]
    ) -> str:
        return f"[{intent.value}]"


@dataclass
class SttScripte:
    """Rend une suite de segments, sans toucher à l'audio."""

    segments: Sequence[TranscriptSegment]
    delai: float = 0.0

    def transcribe(
        self, audio: AsyncIterator[bytes], *, language: str = "fr"
    ) -> AsyncIterator[TranscriptSegment]:
        async def gen() -> AsyncIterator[TranscriptSegment]:
            for s in self.segments:
                if self.delai:
                    await asyncio.sleep(self.delai)
                yield s

        return gen()


@dataclass
class PuitsEspion:
    """Puits audio qui note ce qu'on lui joue et quand on le coupe.

    `duree` simule le temps que met la voix à sortir : sans elle, l'agent
    « parle » en zéro milliseconde et aucune interruption ne peut jamais tomber
    pendant qu'il parle — le test ne prouverait rien.
    """

    joues: int = 0
    coupures: int = 0
    journal: list[str] = field(default_factory=list)
    duree: float = 0.0

    async def play(self, audio: AsyncIterator[bytes]) -> None:
        self.joues += 1
        self.journal.append("joue")
        async for _ in audio:
            pass
        if self.duree:
            await asyncio.sleep(self.duree)

    async def cut(self) -> None:
        self.coupures += 1
        self.journal.append("coupe")


async def rien() -> AsyncIterator[bytes]:
    """Un flux audio vide : la transcription est scriptée, l'audio ne sert pas."""
    vide: tuple[bytes, ...] = ()
    for morceau in vide:
        yield morceau


def monter(
    segments: Sequence[TranscriptSegment], *, delai: float = 0.0, duree_voix: float = 0.0
) -> tuple[DunningConversation, PuitsEspion, SttScripte]:
    puits = PuitsEspion(duree=duree_voix)
    conv = DunningConversation(
        stt=SttScripte([]),
        tts=SimulatedTextToSpeech(),
        telephony=SimulatedTelephony(),
        gateway=StubGateway(),
        phrasing=StubPhrasing(),
        sink=puits,
    )
    return conv, puits, SttScripte(segments, delai)


# ── a. L'annonce d'abord ───────────────────────────────────────────────────


async def test_l_agent_s_annonce_avant_toute_ecoute() -> None:
    # US-2 : l'annonce n'est pas une réplique parmi d'autres, c'est la
    # condition de l'appel. Elle passe avant le premier mot du débiteur.
    conv, puits, stt = monter([TranscriptSegment(text="bonjour", is_final=True)])

    await conduire_appel(conv, stt, rien())

    assert conv.state.announced
    assert puits.journal[0] == "joue"


# ── b. On n'agit que sur une phrase terminée ───────────────────────────────


async def test_un_fragment_ne_declenche_aucune_reponse() -> None:
    """Le défaut que ce test empêche : répondre à une phrase inexistante.

    « je conteste » est un fragment de « je conteste pas, je peux juste pas
    payer tout de suite ». Agir dessus classerait l'appel en litige alors que
    la personne disait l'inverse.
    """
    conv, _, stt = monter([
        TranscriptSegment(text="je conteste", is_final=False),
        TranscriptSegment(text="je conteste pas, je peux juste pas payer", is_final=True),
    ])

    issue = await conduire_appel(conv, stt, rien())

    # Aucune des deux n'est une phrase de clôture reconnue : l'appel se termine
    # sans issue métier plutôt que sur un litige inventé.
    assert issue is Outcome.UNREACHABLE
    assert "contestation" not in conv.state.escalations


async def test_une_phrase_terminee_est_traitee() -> None:
    conv, _, stt = monter([
        TranscriptSegment(text="je conteste cette facture", is_final=True),
    ])

    issue = await conduire_appel(conv, stt, rien())

    assert issue is Outcome.DISPUTE
    assert "contestation" in conv.state.escalations


async def test_un_segment_vide_est_ignore() -> None:
    conv, _, stt = monter([
        TranscriptSegment(text="   ", is_final=True),
        TranscriptSegment(text="ne me rappelez plus", is_final=True),
    ])

    assert await conduire_appel(conv, stt, rien()) is Outcome.REFUSED


async def test_un_flux_sans_fin_de_tour_est_quand_meme_traite() -> None:
    """Le défaut du TROISIÈME appel réel : l'agent n'a jamais répondu.

    Le modèle de transcription en continu n'émet jamais d'événement
    « terminé » — mesuré au banc : « partiel 154 ms | final — » sur les trois
    tours. Il refuse toute segmentation côté serveur.

    Ma boucle n'agissait que sur un tour terminé : elle attendait donc un
    signal qui n'existe pas. L'annonce passait, la personne parlait, et rien ne
    se produisait. La fin de tour se décide ICI, par le silence.
    """
    conv, _, stt = monter(
        [
            TranscriptSegment(text="ne me", is_final=False),
            TranscriptSegment(text=" rappelez plus", is_final=False),
        ],
        delai=0.01,
    )

    issue = await conduire_appel(conv, stt, rien())

    # Aucun segment n'était `is_final` : sans détection de silence, l'appel se
    # serait terminé en `unreachable` sans que l'agent ait rien fait.
    assert issue is Outcome.REFUSED


async def test_les_fragments_sont_recolles_en_une_phrase() -> None:
    # Recoller compte autant que clore : « je conteste » puis « cette facture »
    # traités séparément ne déclencheraient pas la même chose que la phrase
    # entière — et l'un des deux morceaux peut suffire à mal classer l'appel.
    conv, _, stt = monter(
        [
            TranscriptSegment(text="j'ai", is_final=False),
            TranscriptSegment(text=" déjà payé", is_final=False),
        ],
        delai=0.01,
    )

    assert await conduire_appel(conv, stt, rien()) is Outcome.PAID_CLAIMED


async def test_un_silence_ne_casse_pas_la_transcription() -> None:
    """Le défaut du CINQUIÈME appel réel, et le plus retors.

    `asyncio.wait_for` ANNULE ce qu'il attend quand le délai expire. Appliqué
    directement au générateur de transcription, il le cassait au premier
    silence : tout appel suivant signalait « flux terminé », et l'appel se
    concluait `unreachable` six cents millisecondes après l'annonce — avant que
    la personne ait parlé.

    Aucun des tests existants ne pouvait l'attraper : ils débitaient tous leurs
    segments plus vite que le seuil de silence. Celui-ci respire, comme une
    vraie conversation.
    """
    silence = SILENCE_FIN_DE_TOUR_S + 0.15

    @dataclass
    class SttQuiRespire:
        def transcribe(
            self, audio: AsyncIterator[bytes], *, language: str = "fr"
        ) -> AsyncIterator[TranscriptSegment]:
            async def gen() -> AsyncIterator[TranscriptSegment]:
                # Un silence AVANT le premier mot : le temps que la personne
                # écoute l'annonce et réfléchisse.
                await asyncio.sleep(silence)
                yield TranscriptSegment(text="ne me rappelez", is_final=False)
                await asyncio.sleep(0.01)
                yield TranscriptSegment(text=" plus", is_final=False)
                # Puis elle se tait, et c'est ce silence qui clôt le tour.
                await asyncio.sleep(silence)

            return gen()

    conv, _, _ = monter([])

    issue = await conduire_appel(conv, SttQuiRespire(), rien(), duree_max_s=5)

    assert issue is Outcome.REFUSED, (
        "le silence initial a cassé la transcription au lieu d'être attendu"
    )


async def test_une_phrase_hors_cloture_obtient_quand_meme_une_reponse() -> None:
    """Le défaut du SIXIÈME appel réel : la transcription marchait, l'agent se taisait.

    `handle` ne sait répondre qu'aux quatre phrases de clôture. « Je peux pas
    tout payer d'un coup » n'en est pas une : l'agent enregistrait le tour et
    ne disait rien. Une conversation où l'un des deux se tait n'est pas une
    conversation.
    """
    conv, _, stt = monter(
        [TranscriptSegment(text="je peux pas tout payer d'un coup", is_final=True)],
    )

    await conduire_appel(conv, stt, rien())

    dits = [t for t in conv.state.history if t.speaker == "agent"]
    # L'annonce, PUIS une relance : l'agent a repris la parole.
    assert len(dits) >= 2, "l'agent est resté muet devant une phrase inattendue"


async def test_le_repli_respecte_le_plafond_d_insistance() -> None:
    # Le quota vient du noyau, pas de cette boucle. Une fois épuisé, on
    # n'invente pas une relance de plus : le recouvrement amiable sanctionne
    # l'appel oppressant.
    conv, _, stt = monter(
        [
            TranscriptSegment(text="je sais pas encore", is_final=True),
            TranscriptSegment(text="je vous rappelle", is_final=True),
            TranscriptSegment(text="peut-être la semaine prochaine", is_final=True),
        ],
        delai=0.01,
    )

    issue = await conduire_appel(conv, stt, rien())

    assert conv.state.nudges == 2, "l'agent a insisté au-delà du plafond"
    assert issue is Outcome.UNREACHABLE


# ── c. L'interruption ──────────────────────────────────────────────────────


async def test_l_annonce_n_est_pas_interruptible() -> None:
    """Le défaut du PREMIER APPEL RÉEL : l'agent se coupait lui-même.

    Sur une ligne téléphonique, sa propre voix revient en écho et le moindre
    souffle produit un fragment de transcription. L'agent entendait « quelqu'un
    parle » et se taisait — en pleine présentation.

    Au-delà du défaut technique, l'annonce est une obligation de transparence
    (US-2). Une annonce qu'un bruit de fond peut interrompre n'est pas une
    annonce.
    """
    conv, puits, stt = monter(
        [TranscriptSegment(text="attendez", is_final=False)],
        delai=0.01,
        duree_voix=0.05,
    )

    await conduire_appel(conv, stt, rien())

    assert puits.coupures == 0, "l'agent s'est coupé pendant sa propre annonce"


async def test_un_souffle_isole_ne_coupe_pas() -> None:
    # Un mot seul, c'est de l'écho ou du bruit. En deçà de deux mots on ne coupe
    # pas — sinon l'agent se tait à chaque respiration de son interlocuteur.
    # Le filtre vit dans la boucle ; ce test épingle le seuil, qui EST
    # l'exigence — un test qui suivrait la constante suivrait aussi ses erreurs.
    assert MOTS_POUR_COUPER == 2


async def test_une_vraie_prise_de_parole_fait_taire_l_agent() -> None:
    """L'exigence non négociable du ticket, une fois l'annonce passée.

    La file de l'opérateur peut avoir plusieurs secondes d'avance : cesser
    d'envoyer ne suffit pas, il faut la VIDER.
    """
    conv, puits, _ = monter([])
    conv.state.announced = True
    conv.state.speaking = True

    await conv.barge_in()

    assert puits.coupures == 1


async def test_on_ne_coupe_pas_quand_l_agent_se_tait() -> None:
    # Vider la file alors que rien ne joue est inutile, et masquerait un vrai
    # problème de synchronisation le jour où ça arriverait.
    conv, puits, _ = monter([])
    await conv.barge_in()
    assert puits.coupures == 0


# ── d. Un appel ne dure pas indéfiniment ───────────────────────────────────


async def test_un_appel_sans_fin_est_borne() -> None:
    """La ligne reste facturée tant qu'elle est ouverte.

    Le flux ne se tarit jamais ici : sans borne, la boucle tournerait jusqu'à
    ce que quelqu'un s'en aperçoive sur la facture.
    """
    @dataclass
    class SttInfini:
        def transcribe(
            self, audio: AsyncIterator[bytes], *, language: str = "fr"
        ) -> AsyncIterator[TranscriptSegment]:
            async def gen() -> AsyncIterator[TranscriptSegment]:
                while True:
                    await asyncio.sleep(0.01)
                    yield TranscriptSegment(text="euh", is_final=False)

            return gen()

    conv, _, _ = monter([])
    issue = await conduire_appel(conv, SttInfini(), rien(), duree_max_s=0.05)

    # Honnête : personne n'a rien promis, on ne conclut pas à une réussite.
    assert issue is Outcome.UNREACHABLE


async def test_une_transcription_qui_meurt_ne_passe_pas_pour_un_silence() -> None:
    """Le défaut du DEUXIÈME APPEL RÉEL, et le plus sournois des trois.

    La transcription recevait une clé destinée à un autre fournisseur. Elle
    était rejetée, la connexion se fermait, le flux se tarissait — et la boucle
    concluait `unreachable`. L'appel était donc classé « injoignable » alors que
    la personne parlait, et rien dans les journaux ne disait le contraire.

    Une panne technique n'est pas une issue métier. Elle doit remonter.
    """

    @dataclass
    class SttQuiMeurt:
        def transcribe(
            self, audio: AsyncIterator[bytes], *, language: str = "fr"
        ) -> AsyncIterator[TranscriptSegment]:
            async def gen() -> AsyncIterator[TranscriptSegment]:
                # Un segment d'abord, puis la panne : c'est la forme réelle
                # d'une connexion qui se ferme en cours de route.
                yield TranscriptSegment(text="", is_final=False)
                raise RuntimeError("transcription refusée : invalid_api_key")

            return gen()

    conv, _, _ = monter([])

    with pytest.raises(RuntimeError, match="invalid_api_key"):
        await conduire_appel(conv, SttQuiMeurt(), rien())


async def test_une_promesse_confirmee_survit_a_la_fin_du_flux() -> None:
    conv, _, stt = monter([])
    await conv.record_promise(amount_eur="400 euros", date_label="28 août")
    await conv.confirm_promise()

    assert await conduire_appel(conv, stt, rien()) is Outcome.PROMISE


async def test_une_promesse_non_confirmee_ne_conclut_pas_a_une_promesse() -> None:
    # US-3 : pas de promesse enregistrée sans reformulation confirmée. La règle
    # vaut aussi quand le débiteur raccroche au milieu.
    conv, _, stt = monter([])
    await conv.record_promise(amount_eur="400 euros", date_label="28 août")

    with pytest.raises(RuntimeError, match="unconfirmed promise"):
        await conduire_appel(conv, stt, rien())
