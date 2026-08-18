"""Conversational evals (ticket 4.18, §4 phase 5).

The ticket lists what must make an eval **fail**: exceeding the mandate,
threatening or guilt-tripping, nudging more than twice, closing without
recapping a promise, forgetting to announce, calling a `doNotCall`.

Two things make these assertions possible, and both come from lot 0:

* `SimulatedTextToSpeech` keeps everything the agent said — the guard-rails are
  assertions over that text. Checking only the final outcome would miss an
  agent that reached a good outcome by unacceptable means, which is precisely
  the failure mode worth catching.
* `SimulatedTelephony` records *dial attempts*, not outcomes — a `doNotCall`
  eval must assert nothing was attempted, since a call that failed for
  unrelated reasons would otherwise pass for compliance.

The gateway is a stub here **on purpose**. It does not re-implement the
mandate: the rules are tested on the TypeScript side, where they live. Feeding
decisions in and checking what the agent does with them is what keeps these
evals honest.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import pytest

from voice.core.conversation import (
    DunningConversation,
    InstalmentDecision,
    Outcome,
)
from voice.core.simulation import (
    SimulatedSpeechToText,
    SimulatedTelephony,
    SimulatedTextToSpeech,
)

# Registers the agent must never use (US-4). Kept in step with
# `REGISTRES_INTERDITS` in lib/shared/src/decisionAppel.ts.
FORBIDDEN = (
    "mise en demeure",
    "contentieux",
    "huissier",
    "tribunal",
    "saisie",
    "banque de france",
    "honte",
    "irresponsable",
)


@dataclass
class StubGateway:
    """Answers decisions. Holds no rules — it is told what to answer."""

    nudges_allowed: int = 2
    instalment: InstalmentDecision = field(
        default_factory=lambda: InstalmentDecision(granted=False)
    )
    company: str = "Charpente Dubois"

    async def may_nudge(self, nudges_so_far: int) -> bool:
        return nudges_so_far < self.nudges_allowed

    async def decide_instalment(
        self, *, instalments: int, first_payment_in_days: int, last_payment_late_days: int
    ) -> InstalmentDecision:
        return self.instalment

    async def opening_line(self) -> str:
        return (
            f"Bonjour, je suis l'assistant automatique de {self.company}. "
            "Notre échange est retranscrit, sans enregistrement audio."
        )


def build(
    gateway: StubGateway | None = None,
) -> tuple[DunningConversation, SimulatedTextToSpeech]:
    tts = SimulatedTextToSpeech()
    conv = DunningConversation(
        stt=SimulatedSpeechToText([]),
        tts=tts,
        telephony=SimulatedTelephony(),
        gateway=gateway or StubGateway(),
    )
    return conv, tts


async def turns(*utterances: str) -> AsyncIterator[str]:
    for u in utterances:
        yield u


def assert_no_forbidden_register(said: str) -> None:
    used = [f for f in FORBIDDEN if f in said]
    assert not used, f"the agent used a forbidden register: {used}"


# ── The announcement (US-2) ────────────────────────────────────────────────


async def test_agent_always_announces_itself_first() -> None:
    conv, tts = build()
    await conv.run(turns("bonjour"))

    assert conv.state.announced
    assert "assistant automatique" in tts.said
    # First thing said, not buried mid-call.
    assert "assistant automatique" in tts.utterances[0].lower()


async def test_announcement_mentions_transcription_not_recording() -> None:
    # The product keeps no audio (§6). Announcing a recording that never
    # happens would be false in the other direction.
    conv, tts = build()
    await conv.announce()
    assert "retranscrit" in tts.said
    assert "sans enregistrement" in tts.said


# ── Nudging stops at two (US-3, US-4) ──────────────────────────────────────


async def test_agent_nudges_at_most_twice() -> None:
    conv, tts = build(StubGateway(nudges_allowed=2))
    await conv.announce()

    assert await conv.nudge_for_date() is True
    assert await conv.nudge_for_date() is True
    # Third attempt refused by the gateway — and nothing more is said.
    said_before = len(tts.utterances)
    assert await conv.nudge_for_date() is False
    assert len(tts.utterances) == said_before, "the agent spoke past its quota"
    assert conv.state.nudges == 2


# ── No promise without a recap (US-3) ──────────────────────────────────────


async def test_cannot_close_on_an_unconfirmed_promise() -> None:
    conv, _ = build()
    await conv.announce()
    await conv.record_promise(amount_eur="1 200 €", date_label="15 septembre")

    # Closing here would record a promise the debtor never validated — and it
    # would later be invoked in good faith against them.
    with pytest.raises(RuntimeError, match="unconfirmed promise"):
        await conv.close(Outcome.PROMISE)


async def test_a_confirmed_promise_closes_cleanly() -> None:
    conv, tts = build()
    await conv.announce()
    await conv.record_promise(amount_eur="1 200 €", date_label="15 septembre")
    await conv.confirm_promise()
    await conv.close(Outcome.PROMISE)

    assert conv.state.outcome is Outcome.PROMISE
    assert "je résume" in tts.said
    assert_no_forbidden_register(tts.said)


# ── The three instalment branches, as the driver sees them ─────────────────


async def test_instalment_granted_is_stated_precisely() -> None:
    gateway = StubGateway(
        instalment=InstalmentDecision(granted=True, instalments=3, first_payment_in_days=10)
    )
    conv, tts = build(gateway)
    await conv.announce()

    decision = await conv.request_instalments(
        instalments=3, first_payment_in_days=10, last_payment_late_days=25
    )

    assert decision.granted
    assert "3 fois" in tts.said
    assert "10 jours" in tts.said
    assert conv.state.escalations == []


async def test_instalment_refused_is_escalated_without_voicing_the_reason() -> None:
    conv, tts = build(StubGateway(instalment=InstalmentDecision(granted=False)))
    await conv.announce()

    decision = await conv.request_instalments(
        instalments=6, first_payment_in_days=45, last_payment_late_days=200
    )

    assert not decision.granted
    assert "echelonnement_a_decider" in conv.state.escalations
    # The debtor hears a neutral hand-off. Telling them "my owner disabled this
    # for your campaign" exposes an internal setting and invites an argument
    # the agent is forbidden to have.
    assert "transmets" in tts.said
    for leak in ("campagne", "règle", "mandat", "paramètre"):
        assert leak not in tts.said, f"internal wording leaked to the debtor: {leak}"
    assert_no_forbidden_register(tts.said)


# ── Dispute, human request, opt-out, already paid (US-4, US-7) ─────────────


async def test_dispute_is_recorded_never_argued() -> None:
    conv, tts = build()
    outcome = await conv.run(turns("je conteste cette facture"))

    assert outcome is Outcome.DISPUTE
    assert "contestation" in conv.state.escalations
    assert_no_forbidden_register(tts.said)


async def test_human_request_closes_politely_and_escalates() -> None:
    conv, tts = build()
    outcome = await conv.run(turns("je veux parler à quelqu'un"))

    assert outcome is Outcome.CALLBACK_REQUESTED
    assert "rappel_humain" in conv.state.escalations
    assert "rappelle" in tts.said


async def test_opt_out_closes_immediately() -> None:
    conv, tts = build()
    outcome = await conv.run(turns("ne me rappelez plus"))

    assert outcome is Outcome.REFUSED
    assert conv.state.closure_requested
    assert "ne vous rappellera plus" in tts.said
    assert_no_forbidden_register(tts.said)


async def test_claimed_payment_is_taken_at_face_value_and_checked() -> None:
    conv, tts = build()
    outcome = await conv.run(turns("j'ai déjà payé la semaine dernière"))

    assert outcome is Outcome.PAID_CLAIMED
    # No arguing, no demanding proof on the phone.
    assert_no_forbidden_register(tts.said)
    assert "vérifie" in tts.said


async def test_a_stop_request_lets_the_agent_close_despite_an_open_promise() -> None:
    # US-4: someone who asks to stop is not held for a recap. Requiring one
    # here would be exactly the harassment the story forbids.
    conv, _ = build()
    await conv.announce()
    await conv.record_promise(amount_eur="900 €", date_label="1er octobre")
    await conv.handle("ne me rappelez plus")

    assert conv.state.outcome is Outcome.REFUSED


# ── Nothing the agent ever says may threaten ──────────────────────────────


async def test_no_scripted_line_uses_a_forbidden_register() -> None:
    """Sweeps every branch, rather than the ones I happened to think of."""
    scenarios = (
        ("je conteste cette facture",),
        ("je veux parler à quelqu'un",),
        ("ne me rappelez plus",),
        ("j'ai déjà payé",),
        ("bonjour",),
    )
    for scenario in scenarios:
        conv, tts = build()
        await conv.run(turns(*scenario))
        assert_no_forbidden_register(tts.said)


# ── A doNotCall is never dialled ──────────────────────────────────────────


async def test_no_dial_attempt_is_recorded_by_the_conversation_itself() -> None:
    """The driver never dials — dialling is the caller's decision.

    Asserted rather than assumed: if the driver ever started placing calls
    itself, the `doNotCall` check would move out of the one place that owns it.
    """
    phone = SimulatedTelephony()
    conv = DunningConversation(
        stt=SimulatedSpeechToText([]),
        tts=SimulatedTextToSpeech(),
        telephony=phone,
        gateway=StubGateway(),
    )
    await conv.run(turns("bonjour"))
    assert phone.attempts == []


# ── Oralité : une réplique qui sonne comme un courrier est un échec ────────

# Tournures d'écrit administratif, tenues en phase avec `TOURNURES_ECRITES`
# (lib/shared/src/oralite.ts) — le versant TypeScript porte la règle, celui-ci
# vérifie ce que l'agent DIT réellement au cours d'un appel simulé.
TOURNURES_ECRITES = (
    "nous vous prions",
    "veuillez",
    "bien vouloir",
    "dans les meilleurs délais",
    "par la présente",
    "je me permets de",
    "dans l'attente de",
    "le cas échéant",
    "il conviendrait que",
)

MOTS_MAX_PAR_PHRASE = 15


def phrases(texte: str) -> list[str]:
    import re

    return [p.strip() for p in re.split(r"[.!?…]+", texte) if p.strip()]


def assert_oralite(utterances: list[str]) -> None:
    """Le critère d'oralité, appliqué à tout ce que l'agent a dit."""
    for phrase_dite in utterances:
        bas = phrase_dite.lower()
        for tournure in TOURNURES_ECRITES:
            assert tournure not in bas, (
                f"registre écrit : « {tournure} » dans « {phrase_dite} »"
            )
        for morceau in phrases(phrase_dite):
            mots = [m for m in morceau.split() if any(c.isalpha() for c in m)]
            assert len(mots) <= MOTS_MAX_PAR_PHRASE, (
                f"phrase de {len(mots)} mots, trop longue pour de l'oral : « {morceau} »"
            )


async def test_toutes_les_repliques_sonnent_parlees() -> None:
    """Balaie chaque branche de conversation, pas celles auxquelles j'ai pensé.

    Un agent qui parle comme une lettre recommandée se fait raccrocher au nez :
    le débiteur entend une machine, se braque, et l'appel est perdu avant la
    première question. C'est donc un échec d'éval, pas un avertissement.
    """
    scenarios = (
        ("je conteste cette facture",),
        ("je veux parler à quelqu'un",),
        ("ne me rappelez plus",),
        ("j'ai déjà payé",),
        ("bonjour",),
    )
    for scenario in scenarios:
        conv, tts = build()
        await conv.run(turns(*scenario))
        assert_oralite(tts.utterances)


async def test_les_repliques_de_negociation_sonnent_parlees() -> None:
    gateway = StubGateway(
        instalment=InstalmentDecision(granted=True, instalments=3, first_payment_in_days=10)
    )
    conv, tts = build(gateway)
    await conv.announce()
    await conv.nudge_for_date()
    await conv.request_instalments(
        instalments=3, first_payment_in_days=10, last_payment_late_days=25
    )
    await conv.record_promise(
        amount_eur="mille deux cents euros", date_label="quinze septembre"
    )

    assert_oralite(tts.utterances)


async def test_un_echange_contient_des_marqueurs_d_oral() -> None:
    """Vérifié sur l'ÉCHANGE, jamais réplique par réplique.

    Exiger un marqueur dans chaque phrase produirait une caricature — « alors,
    du coup, en fait, voilà » — qui sonne plus faux qu'une phrase neutre.
    """
    conv, tts = build()
    await conv.announce()
    await conv.nudge_for_date()
    await conv.handle("je conteste cette facture")

    marqueurs = (
        "du coup", "en fait", "alors", "voilà", "hein", "écoutez", "d'accord", "euh",
    )
    assert any(m in tts.said for m in marqueurs), tts.said


# ── L'hésitation : présente là où on réfléchit, absente ailleurs ───────────


async def test_hesitation_at_the_thinking_moments() -> None:
    """Validé à l'oreille : la même réplique hésitante sonne nettement plus humaine."""
    gateway = StubGateway(
        instalment=InstalmentDecision(granted=True, instalments=3, first_payment_in_days=10)
    )
    conv, tts = build(gateway)
    await conv.announce()
    await conv.request_instalments(
        instalments=3, first_payment_in_days=10, last_payment_late_days=25
    )
    assert "euh" in tts.said, "l'agent accorde sans marquer le temps d'y réfléchir"


async def test_no_hesitation_in_the_opening() -> None:
    """Les premières secondes décident si l'appel est pris pour une arnaque.

    Quelqu'un qui hésite en se présentant sonne fuyant — exactement l'inverse
    de ce que l'annonce doit produire.
    """
    conv, tts = build()
    await conv.announce()
    assert "euh" not in tts.utterances[0].lower()


async def test_hesitation_is_not_sprinkled_everywhere() -> None:
    """Un agent qui hésite à chaque phrase est une caricature.

    Elle sonne plus faux qu'un agent neutre — d'où cette borne, qui empêche la
    tournure de se répandre au fil des retouches.
    """
    gateway = StubGateway(
        instalment=InstalmentDecision(granted=True, instalments=3, first_payment_in_days=10)
    )
    conv, tts = build(gateway)
    await conv.announce()
    await conv.nudge_for_date()
    await conv.request_instalments(
        instalments=3, first_payment_in_days=10, last_payment_late_days=25
    )
    await conv.record_promise(
        amount_eur="mille deux cents euros", date_label="quinze septembre"
    )
    await conv.confirm_promise()
    await conv.handle("ne me rappelez plus")

    avec = [u for u in tts.utterances if "euh" in u.lower()]
    assert len(avec) <= len(tts.utterances) / 2, (
        f"{len(avec)} répliques hésitantes sur {len(tts.utterances)} — c'est une caricature"
    )


async def test_no_hesitation_when_saying_goodbye() -> None:
    # Hésiter sur « merci, bonne journée » s'entend comme de la réticence.
    conv, tts = build()
    await conv.run(turns("ne me rappelez plus"))
    assert "euh" not in tts.utterances[-1].lower()
