"""L'amorce qui masque la latence (ticket 4.18).

Ce que ces tests protègent :

  a. l'amorce ne coûte RIEN pendant l'appel — si une synthèse avait lieu au
     moment de jouer, on aurait déplacé le retard au lieu de le supprimer ;
  b. la demande au modèle part AVANT que l'amorce joue — sinon on additionne
     les deux délais au lieu de les superposer, ce qui est pire que rien ;
  c. l'amorce reste aux moments où quelqu'un hésiterait, et nulle part ailleurs ;
  d. sans amorce, le pilote se comporte exactement comme avant.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field

import pytest

from voice.adapters.prelude_cache import (
    TEXTE_AMORCE,
    CachedPrelude,
    PreludeNotReadyError,
)
from voice.core.conversation import (
    INTENTS_AVEC_AMORCE,
    DunningConversation,
    InstalmentDecision,
    Intent,
    Turn,
)
from voice.core.simulation import (
    SimulatedSpeechToText,
    SimulatedTelephony,
    SimulatedTextToSpeech,
)


@dataclass
class TtsCompteur:
    """Compte les synthèses. C'est la mesure qui compte ici."""

    appels: list[str] = field(default_factory=list)

    async def synthesize(self, text: str, *, language: str = "fr") -> AsyncIterator[bytes]:
        self.appels.append(text)
        # 8 000 octets = 1 s en µ-law 8 kHz.
        for _ in range(4):
            yield b"\x00" * 2000


@dataclass
class StubGateway:
    instalment: InstalmentDecision = field(
        default_factory=lambda: InstalmentDecision(
            granted=True, instalments=3, first_payment_in_days=10
        )
    )

    async def may_nudge(self, nudges_so_far: int) -> bool:
        return nudges_so_far < 2

    async def decide_instalment(
        self, *, instalments: int, first_payment_in_days: int, last_payment_late_days: int
    ) -> InstalmentDecision:
        return self.instalment

    async def opening_line(self) -> str:
        return "Bonjour, je suis l'assistant automatique de Dubois."


@dataclass
class AmorceCompteur:
    """Amorce de test : compte ses lectures, ne synthétise rien."""

    jouees: int = 0

    async def play(self) -> str:
        self.jouees += 1
        return TEXTE_AMORCE


@dataclass
class PhrasingLent:
    """Répond après un délai, et note l'ORDRE des événements."""

    journal: list[str]
    delai: float = 0.02

    async def line(
        self, intent: Intent, *, facts: Mapping[str, str], history: Sequence[Turn]
    ) -> str:
        self.journal.append("demande-partie")
        await asyncio.sleep(self.delai)
        self.journal.append("reponse-recue")
        return f"[{intent.value}]"


# ── a. Le cache ────────────────────────────────────────────────────────────


async def test_la_synthese_a_lieu_une_seule_fois_au_prechauffage() -> None:
    tts = TtsCompteur()
    amorce = CachedPrelude(tts)
    await amorce.warm_up()

    for _ in range(5):
        assert await amorce.play() == TEXTE_AMORCE

    # UNE synthèse pour cinq lectures. Si ce nombre montait, l'amorce paierait
    # pendant l'appel le temps qu'elle est censée masquer.
    assert tts.appels == [TEXTE_AMORCE]


async def test_jouer_sans_prechauffer_leve_au_lieu_de_se_taire() -> None:
    # Une amorce silencieusement absente rendrait le blanc à la conversation
    # sans que personne ne s'en aperçoive avant d'écouter un enregistrement.
    amorce = CachedPrelude(TtsCompteur())
    assert amorce.est_prete is False
    with pytest.raises(PreludeNotReadyError):
        await amorce.play()


async def test_une_synthese_vide_est_refusee() -> None:
    @dataclass
    class TtsMuet:
        async def synthesize(self, text: str, *, language: str = "fr") -> AsyncIterator[bytes]:
            # Rend un morceau VIDE plutôt que rien : c'est le cas réel — un
            # fournisseur qui répond 200 avec un corps creux — et `warm_up`
            # doit le voir comme une absence d'amorce.
            yield b""

    with pytest.raises(PreludeNotReadyError):
        await CachedPrelude(TtsMuet()).warm_up()


async def test_une_amorce_plus_longue_que_le_blanc_est_refusee_au_demarrage() -> None:
    """Le piège du dispositif, et il a failli être adopté.

    Une amorce en `eleven_v3` sonne mieux mais dure 1,60 s pour 1,15 s de blanc.
    La réplique serait prête avant la fin de l'amorce et devrait l'attendre :
    +450 ms, c'est-à-dire un agent RALENTI par son correctif de latence.

    Refusé au démarrage, seul moment où l'on peut corriger sans que personne ne
    l'entende — une amorce trop longue ne casse rien de visible.
    """

    @dataclass
    class TtsTropLong:
        async def synthesize(self, text: str, *, language: str = "fr") -> AsyncIterator[bytes]:
            # 1,60 s : la durée réellement mesurée de l'amorce v3.
            yield b"\x00" * int(1.60 * 8000)

    with pytest.raises(PreludeNotReadyError, match="attendre la réplique"):
        await CachedPrelude(TtsTropLong()).warm_up()


async def test_l_amorce_du_modele_temps_reel_passe() -> None:
    # 0,93 s mesurées en Flash, sous la borne. La garde doit laisser passer
    # exactement ce qu'on a retenu, sinon elle refuse ce qu'elle protège.
    @dataclass
    class TtsFlash:
        async def synthesize(self, text: str, *, language: str = "fr") -> AsyncIterator[bytes]:
            yield b"\x00" * int(0.93 * 8000)

    amorce = CachedPrelude(TtsFlash())
    await amorce.warm_up()
    assert amorce.duree_secondes == pytest.approx(0.93, abs=0.01)


async def test_la_duree_est_connue_car_c_est_ce_qu_elle_masque() -> None:
    amorce = CachedPrelude(TtsCompteur())
    await amorce.warm_up()
    # 8 000 octets à 8 kHz = 1 s. La durée est mesurable, donc comparable au
    # délai réel de la chaîne (1,15 s avec Flash).
    assert amorce.octets == 8000
    assert amorce.duree_secondes == pytest.approx(1.0)


# ── b. L'ordre, qui est tout l'intérêt ─────────────────────────────────────


async def test_la_demande_part_avant_que_l_amorce_joue() -> None:
    """Le point de tout le dispositif.

    Si l'amorce jouait d'abord et que la demande partait ensuite, les deux
    délais s'ADDITIONNERAIENT — on aurait rendu l'agent plus lent tout en
    croyant l'accélérer.
    """
    journal: list[str] = []

    @dataclass
    class AmorceJournalisee:
        async def play(self) -> str:
            journal.append("amorce-jouee")
            return TEXTE_AMORCE

    conv = DunningConversation(
        stt=SimulatedSpeechToText([]),
        tts=SimulatedTextToSpeech(),
        telephony=SimulatedTelephony(),
        gateway=StubGateway(),
        phrasing=PhrasingLent(journal),
        prelude=AmorceJournalisee(),
    )
    await conv.request_instalments(
        instalments=3, first_payment_in_days=10, last_payment_late_days=25
    )

    assert journal == ["demande-partie", "amorce-jouee", "reponse-recue"], journal


async def test_l_amorce_entre_dans_l_historique_envoye_au_modele() -> None:
    # Sans ça le modèle enchaînerait sur une deuxième hésitation, et on
    # entendrait « alors euh… alors euh… ».
    conv = DunningConversation(
        stt=SimulatedSpeechToText([]),
        tts=SimulatedTextToSpeech(),
        telephony=SimulatedTelephony(),
        gateway=StubGateway(),
        phrasing=PhrasingLent([]),
        prelude=AmorceCompteur(),
    )
    await conv.record_promise(amount_eur="400 euros", date_label="28 août")

    dits = [t.text for t in conv.state.history if t.speaker == "agent"]
    assert TEXTE_AMORCE in dits
    assert dits.index(TEXTE_AMORCE) < len(dits) - 1, "l'amorce doit précéder la réplique"


# ── c. Où l'amorce a le droit d'être ───────────────────────────────────────




async def test_l_amorce_est_bornee_aux_moments_de_recherche() -> None:
    # Épinglé littéralement : élargir la liste doit obliger quelqu'un à venir
    # ici, donc à décider. Un agent qui hésite à chaque tour est une caricature.
    assert INTENTS_AVEC_AMORCE == frozenset({
        Intent.ASK_DATE,
        Intent.OFFER_INSTALMENTS,
        Intent.RECAP_PROMISE,
        Intent.DECLINE_AND_FORWARD,
    })
    # Bornée à la moitié des mouvements : au-delà, c'est une caricature.
    assert len(INTENTS_AVEC_AMORCE) * 2 <= len(list(Intent))


async def test_pas_d_amorce_en_prenant_conge() -> None:
    # Hésiter sur « merci, bonne journée » s'entend comme de la réticence.
    for intention in (
        Intent.CLOSE_OPT_OUT,
        Intent.CLOSE_DISPUTE,
        Intent.CLOSE_PAID_CLAIMED,
        Intent.CLOSE_HUMAN_REQUESTED,
    ):
        assert intention not in INTENTS_AVEC_AMORCE, intention


async def test_l_annonce_n_a_jamais_d_amorce() -> None:
    """Les premières secondes décident si l'appel passe pour une arnaque.

    Quelqu'un qui hésite en se présentant sonne fuyant. L'annonce ne passe même
    pas par `_say` — elle vient de la passerelle, mot pour mot (US-2).
    """
    amorce = AmorceCompteur()
    conv = DunningConversation(
        stt=SimulatedSpeechToText([]),
        tts=SimulatedTextToSpeech(),
        telephony=SimulatedTelephony(),
        gateway=StubGateway(),
        phrasing=PhrasingLent([]),
        prelude=amorce,
    )
    await conv.announce()
    assert amorce.jouees == 0


async def test_une_demande_de_date_declenche_l_amorce() -> None:
    """Le mouvement le PLUS fréquent de l'appel, et il n'était pas couvert.

    L'agent relance sur la date dès qu'il ne comprend pas ce qu'on lui dit —
    c'est donc là que le blanc s'entend le plus souvent. Au huitième appel réel,
    le dispositif anti-latence n'a jamais tourné pour cette raison.
    """
    amorce = AmorceCompteur()
    conv = DunningConversation(
        stt=SimulatedSpeechToText([]),
        tts=SimulatedTextToSpeech(),
        telephony=SimulatedTelephony(),
        gateway=StubGateway(),
        phrasing=PhrasingLent([]),
        prelude=amorce,
    )
    await conv.nudge_for_date()
    assert amorce.jouees == 1


# ── d. Sans amorce, rien ne change ─────────────────────────────────────────


async def test_le_pilote_fonctionne_sans_amorce() -> None:
    conv = DunningConversation(
        stt=SimulatedSpeechToText([]),
        tts=SimulatedTextToSpeech(),
        telephony=SimulatedTelephony(),
        gateway=StubGateway(),
        phrasing=PhrasingLent([]),
    )
    decision = await conv.request_instalments(
        instalments=3, first_payment_in_days=10, last_payment_late_days=25
    )
    assert decision.granted
    assert [t.text for t in conv.state.history if t.speaker == "agent"] == [
        "[offrir_echelonnement]"
    ]
