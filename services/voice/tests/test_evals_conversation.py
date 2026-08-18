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

Both stubs hold no rules **on purpose**. The gateway does not re-implement the
mandate and the phrasing does not re-implement the style: those are tested on
the TypeScript side, where they live.

── What moved out of this file, and why ──────────────────────────────────────
The agent's wording is no longer written here — it comes from the model,
through `Phrasing`. Asserting orality against a stub would only prove the stub
was written politely, which is exactly the trap the module note above warns
about. Those assertions now sit where the words are produced and guarded:
`lib/shared/test/formulation.test.ts` and the route's own tests.

What is asserted here instead is stronger, because it is what this side
actually controls: **which move the driver chose, and which facts it was
willing to hand over.** An agent cannot voice a refusal reason it was never
given — see `test_the_refusal_reason_never_reaches_the_model`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field

import pytest

from voice.core.conversation import (
    DunningConversation,
    InstalmentDecision,
    Intent,
    Outcome,
    Turn,
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


@dataclass(frozen=True, slots=True)
class Asked:
    """One formulation request, as the driver made it."""

    intent: Intent
    facts: Mapping[str, str]
    history: tuple[Turn, ...]


@dataclass
class RecordingPhrasing:
    """Records what the driver asked for, answers something plausible.

    The answer is deliberately bland. These evals assert on the *request* —
    which move, which facts — because that is what the driver decides. The
    wording is the model's job and the TypeScript guards' business.
    """

    asked: list[Asked] = field(default_factory=list)

    async def line(
        self,
        intent: Intent,
        *,
        facts: Mapping[str, str],
        history: Sequence[Turn],
    ) -> str:
        self.asked.append(Asked(intent, dict(facts), tuple(history)))
        details = " ".join(facts.values())
        return f"[{intent.value}] {details}".strip()

    def intents(self) -> list[Intent]:
        return [a.intent for a in self.asked]


def build(
    gateway: StubGateway | None = None,
) -> tuple[DunningConversation, SimulatedTextToSpeech, RecordingPhrasing]:
    tts = SimulatedTextToSpeech()
    phrasing = RecordingPhrasing()
    conv = DunningConversation(
        stt=SimulatedSpeechToText([]),
        tts=tts,
        telephony=SimulatedTelephony(),
        gateway=gateway or StubGateway(),
        phrasing=phrasing,
    )
    return conv, tts, phrasing


async def turns(*utterances: str) -> AsyncIterator[str]:
    for u in utterances:
        yield u


def assert_no_forbidden_register(said: str) -> None:
    used = [f for f in FORBIDDEN if f in said]
    assert not used, f"the agent used a forbidden register: {used}"


# ── The announcement (US-2) ────────────────────────────────────────────────


async def test_agent_always_announces_itself_first() -> None:
    conv, tts, _ = build()
    await conv.run(turns("bonjour"))

    assert conv.state.announced
    assert "assistant automatique" in tts.said
    # First thing said, not buried mid-call.
    assert "assistant automatique" in tts.utterances[0].lower()


async def test_announcement_mentions_transcription_not_recording() -> None:
    # The product keeps no audio (§6). Announcing a recording that never
    # happens would be false in the other direction.
    conv, tts, _ = build()
    await conv.announce()
    assert "retranscrit" in tts.said
    assert "sans enregistrement" in tts.said


async def test_the_announcement_never_goes_through_the_model() -> None:
    """US-2: the one line a model may not rephrase.

    An announcement a runtime is free to reword is an announcement that can,
    one day, stop announcing. It comes from the gateway, word for word, and
    the phrasing port is not consulted.
    """
    conv, _, phrasing = build()
    await conv.announce()
    assert phrasing.asked == []


# ── Nudging stops at two (US-3, US-4) ──────────────────────────────────────


async def test_agent_nudges_at_most_twice() -> None:
    conv, tts, _ = build(StubGateway(nudges_allowed=2))
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
    conv, _, _ = build()
    await conv.announce()
    await conv.record_promise(amount_eur="1 200 €", date_label="15 septembre")

    # Closing here would record a promise the debtor never validated — and it
    # would later be invoked in good faith against them.
    with pytest.raises(RuntimeError, match="unconfirmed promise"):
        await conv.close(Outcome.PROMISE)


async def test_a_confirmed_promise_closes_cleanly() -> None:
    conv, tts, phrasing = build()
    await conv.announce()
    await conv.record_promise(amount_eur="1 200 €", date_label="15 septembre")
    await conv.confirm_promise()
    await conv.close(Outcome.PROMISE)

    assert conv.state.outcome is Outcome.PROMISE
    assert Intent.RECAP_PROMISE in phrasing.intents()
    assert_no_forbidden_register(tts.said)


async def test_the_recap_carries_the_exact_figures_it_was_given() -> None:
    """CLAUDE.md rule 3 seen from this side.

    The driver hands over the amount and the date verbatim; the model may
    repeat them and nothing else. Anything it invents is caught on the way
    back by `chiffresInventes`.
    """
    conv, _, phrasing = build()
    await conv.announce()
    await conv.record_promise(amount_eur="1 200 €", date_label="15 septembre")

    recap = next(a for a in phrasing.asked if a.intent is Intent.RECAP_PROMISE)
    assert recap.facts == {"montant": "1 200 €", "date": "15 septembre"}


# ── The three instalment branches, as the driver sees them ─────────────────


async def test_instalment_granted_hands_over_the_granted_figures() -> None:
    gateway = StubGateway(
        instalment=InstalmentDecision(granted=True, instalments=3, first_payment_in_days=10)
    )
    conv, _, phrasing = build(gateway)
    await conv.announce()

    decision = await conv.request_instalments(
        instalments=3, first_payment_in_days=10, last_payment_late_days=25
    )

    assert decision.granted
    offer = next(a for a in phrasing.asked if a.intent is Intent.OFFER_INSTALMENTS)
    # What the core granted, not what the debtor asked for.
    assert offer.facts == {"versements": "3", "premier_versement_jours": "10"}
    assert conv.state.escalations == []


async def test_the_refusal_reason_never_reaches_the_model() -> None:
    """The strongest form of "don't voice the internal reason".

    Previously the driver held a neutral sentence and one had to trust it. Now
    the refusal is worded by a model — so the guarantee is that the model is
    handed **no facts at all**. It cannot say what it never saw, whatever the
    prompt does.
    """
    conv, tts, phrasing = build(StubGateway(instalment=InstalmentDecision(granted=False)))
    await conv.announce()

    decision = await conv.request_instalments(
        instalments=6, first_payment_in_days=45, last_payment_late_days=200
    )

    assert not decision.granted
    assert "echelonnement_a_decider" in conv.state.escalations

    refusal = next(a for a in phrasing.asked if a.intent is Intent.DECLINE_AND_FORWARD)
    assert refusal.facts == {}, "an internal reason was handed to the model"
    assert_no_forbidden_register(tts.said)


# ── Dispute, human request, opt-out, already paid (US-4, US-7) ─────────────


async def test_dispute_is_recorded_never_argued() -> None:
    conv, tts, phrasing = build()
    outcome = await conv.run(turns("je conteste cette facture"))

    assert outcome is Outcome.DISPUTE
    assert "contestation" in conv.state.escalations
    assert Intent.CLOSE_DISPUTE in phrasing.intents()
    assert_no_forbidden_register(tts.said)


async def test_human_request_closes_politely_and_escalates() -> None:
    conv, _, phrasing = build()
    outcome = await conv.run(turns("je veux parler à quelqu'un"))

    assert outcome is Outcome.CALLBACK_REQUESTED
    assert "rappel_humain" in conv.state.escalations
    assert Intent.CLOSE_HUMAN_REQUESTED in phrasing.intents()


async def test_opt_out_closes_immediately() -> None:
    conv, tts, phrasing = build()
    outcome = await conv.run(turns("ne me rappelez plus"))

    assert outcome is Outcome.REFUSED
    assert conv.state.closure_requested
    assert Intent.CLOSE_OPT_OUT in phrasing.intents()
    assert_no_forbidden_register(tts.said)


async def test_claimed_payment_is_taken_at_face_value_and_checked() -> None:
    conv, tts, phrasing = build()
    outcome = await conv.run(turns("j'ai déjà payé la semaine dernière"))

    assert outcome is Outcome.PAID_CLAIMED
    assert Intent.CLOSE_PAID_CLAIMED in phrasing.intents()
    # No arguing, no demanding proof on the phone.
    assert_no_forbidden_register(tts.said)


async def test_a_stop_request_lets_the_agent_close_despite_an_open_promise() -> None:
    # US-4: someone who asks to stop is not held for a recap. Requiring one
    # here would be exactly the harassment the story forbids.
    conv, _, _ = build()
    await conv.announce()
    await conv.record_promise(amount_eur="900 €", date_label="1er octobre")
    await conv.handle("ne me rappelez plus")

    assert conv.state.outcome is Outcome.REFUSED


# ── The model is given something to react to ──────────────────────────────


async def test_the_model_sees_what_the_debtor_just_said() -> None:
    """This is what separates conversing from reciting.

    Without the history, the model would produce the same sentence on every
    call for a given move — which is what the scripted lines did, with a
    network round-trip added.
    """
    conv, _, phrasing = build()
    await conv.run(turns("je conteste cette facture"))

    close = next(a for a in phrasing.asked if a.intent is Intent.CLOSE_DISPUTE)
    assert Turn(speaker="debiteur", text="je conteste cette facture") in close.history
    # And the announcement it already made, so it does not introduce itself twice.
    assert any(t.speaker == "agent" for t in close.history)


async def test_history_keeps_both_sides_in_order() -> None:
    conv, _, _ = build()
    await conv.announce()
    conv.hear("bonjour")
    await conv.nudge_for_date()

    speakers = [t.speaker for t in conv.state.history]
    assert speakers == ["agent", "debiteur", "agent"]


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
        phrasing=RecordingPhrasing(),
    )
    await conv.run(turns("bonjour"))
    assert phone.attempts == []
