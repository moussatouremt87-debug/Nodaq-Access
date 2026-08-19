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

from voice.core.call_loop import conduire_appel
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


# ── c. L'interruption ──────────────────────────────────────────────────────


async def test_un_fragment_suffit_a_faire_taire_l_agent() -> None:
    """Un fragment ne dit pas QUOI répondre, mais il prouve que la personne parle.

    C'est tout ce qu'il faut pour se taire — et attendre la phrase complète
    laisserait l'agent parler par-dessus pendant une seconde entière.
    """
    # L'agent met 50 ms à dire son annonce ; le débiteur le coupe au bout de 10.
    conv, puits, stt = monter(
        [
            TranscriptSegment(text="attendez", is_final=False),
            TranscriptSegment(text="ne me rappelez plus", is_final=True),
        ],
        delai=0.01,
        duree_voix=0.05,
    )

    await conduire_appel(conv, stt, rien())

    assert puits.coupures >= 1


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
