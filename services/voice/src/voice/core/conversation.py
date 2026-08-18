"""Conversation driver for a dunning call (ticket 4.18, US-2 to US-7).

**This module holds no business rules.** Whether an instalment may be granted,
how many nudges are allowed, what the mandate permits — all of that lives in
`lib/shared` on the TypeScript side, is tested there, and is reached through
`MandateGateway`. Re-deriving any of it here would create a second source of
truth, and the permissive one always wins the day the two drift.

What *does* live here is the conduct of the call: announce yourself, listen,
ask the gateway, say what it answered, recap before hanging up. Those are
behaviours, and behaviours are what the §5 evals assert on.

The split matters for a practical reason too. An eval that re-implemented the
mandate would pass against its own copy of the rules — proving nothing about
the product. Here the evals feed decisions in and check what the agent *did*
with them.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol

from voice.core.interfaces import SpeechToText, TelephonyProvider, TextToSpeech


class Outcome(StrEnum):
    """Business outcome of the conversation (US-6).

    Mirrors `ISSUES_APPEL` in `lib/shared/src/decisionAppel.ts`. Duplicated as
    a value list — not as logic — because the two runtimes must name the same
    things; `tests/test_outcomes_parity.py` fails if they drift.
    """

    PROMISE = "promise"
    DISPUTE = "dispute"
    CALLBACK_REQUESTED = "callback_requested"
    UNREACHABLE = "unreachable"
    REFUSED = "refused"
    PAID_CLAIMED = "paid_claimed"


@dataclass(frozen=True, slots=True)
class InstalmentDecision:
    """What the decision core answered about an instalment request.

    `granted` false means the agent must not concede anything — it takes note
    and closes. The reason is *not* repeated to the debtor: telling someone
    "my owner disabled this for your campaign" exposes an internal setting and
    invites an argument the agent is forbidden to have.
    """

    granted: bool
    instalments: int = 0
    first_payment_in_days: int = 0


class MandateGateway(Protocol):
    """The only door to the business rules. Implemented over HTTP in production."""

    async def may_nudge(self, nudges_so_far: int) -> bool: ...

    async def decide_instalment(
        self, *, instalments: int, first_payment_in_days: int, last_payment_late_days: int
    ) -> InstalmentDecision: ...

    async def opening_line(self) -> str: ...


@dataclass
class CallState:
    """Everything the driver knows about the call in progress."""

    announced: bool = False
    nudges: int = 0
    promise_obtained: bool = False
    promise_confirmed: bool = False
    closure_requested: bool = False
    outcome: Outcome | None = None
    escalations: list[str] = field(default_factory=list)


# Phrases the driver reacts to. Deliberately narrow: this is a fallback for the
# simulation harness and a safety net, never the primary understanding — that
# comes from the model, through the gateway.
_HUMAN_REQUESTED = ("parler à quelqu'un", "un humain", "une personne réelle")
_STOP_REQUESTED = ("ne me rappelez plus", "arrêtez de m'appeler", "rayez-moi")
_DISPUTE = ("je conteste", "je ne dois rien", "cette facture est fausse")
_ALREADY_PAID = ("j'ai déjà payé", "c'est déjà réglé", "j'ai fait le virement")


def _contains(text: str, needles: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(n in lowered for n in needles)


#: Light hesitation, used **only at thinking moments**.
#:
#: Validated by ear in telephone conditions: the same line with a hesitation
#: sounds markedly more human than without. But it belongs where a person would
#: actually pause — before granting something that had to be checked, before
#: reading back a figure — and nowhere else.
#:
#: Not in the opening: the first seconds are where the callee decides whether
#: this is a scam, and someone who hesitates while introducing themselves
#: sounds evasive. Not in closings either: hesitating on "thank you, goodbye"
#: reads as reluctance.
#:
#: `test_hesitation_is_not_sprinkled_everywhere` keeps it from spreading. An
#: agent that hesitates in every sentence is a caricature, which sounds worse
#: than a neutral one.
HESITATION = "Alors… euh,"


class DunningConversation:
    """Runs one call. Knows how to behave, not what to allow."""

    def __init__(
        self,
        *,
        stt: SpeechToText,
        tts: TextToSpeech,
        telephony: TelephonyProvider,
        gateway: MandateGateway,
    ) -> None:
        self._stt = stt
        self._tts = tts
        self._telephony = telephony
        self._gateway = gateway
        self.state = CallState()

    async def _say(self, line: str) -> None:
        async for _chunk in self._tts.synthesize(line):
            pass

    async def announce(self) -> None:
        """Always first, and never skippable (US-2, AI Act transparency).

        The line comes from the decision core rather than being written here:
        an announcement a runtime is free to rephrase is an announcement that
        can one day stop announcing.
        """
        await self._say(await self._gateway.opening_line())
        self.state.announced = True

    async def close(self, outcome: Outcome) -> None:
        """Hang up — but never on an unconfirmed promise.

        US-3 is explicit: no promise is recorded without the debtor confirming
        the recap. Closing before that would leave a promise nobody made, and
        it would later be invoked in good faith against them.

        The one exception is a debtor who asked to stop: insisting on a recap
        at that point is exactly the harassment US-4 forbids.
        """
        if (
            self.state.promise_obtained
            and not self.state.promise_confirmed
            and not self.state.closure_requested
        ):
            raise RuntimeError(
                "closing on an unconfirmed promise — recap it first (US-3)"
            )
        self.state.outcome = outcome

    async def handle(self, utterance: str) -> None:
        """React to one thing the debtor said."""
        if _contains(utterance, _STOP_REQUESTED):
            # Opt-out (US-7). Recorded by the caller; here the call simply ends.
            self.state.closure_requested = True
            await self._say(
                "D'accord, c'est noté. On ne vous rappellera plus. "
                "Merci, et bonne journée."
            )
            await self.close(Outcome.REFUSED)
            return

        if _contains(utterance, _HUMAN_REQUESTED):
            self.state.closure_requested = True
            self.state.escalations.append("rappel_humain")
            await self._say(
                "Bien sûr. Alors je note, et quelqu'un vous rappelle. "
                "Merci, bonne journée."
            )
            await self.close(Outcome.CALLBACK_REQUESTED)
            return

        if _contains(utterance, _DISPUTE):
            # US-4: never argue. Record, close, hand to a human.
            self.state.closure_requested = True
            self.state.escalations.append("contestation")
            await self._say(
                "Ah, d'accord. Écoutez, je note, et je transmets. "
                "Quelqu'un revient vers vous. Bonne journée."
            )
            await self.close(Outcome.DISPUTE)
            return

        if _contains(utterance, _ALREADY_PAID):
            self.state.closure_requested = True
            self.state.escalations.append("paiement_annonce")
            await self._say(
                "Ah, très bien. Du coup je note, et on vérifie de notre côté. "
                "Merci, bonne journée."
            )
            await self.close(Outcome.PAID_CLAIMED)
            return

    async def nudge_for_date(self) -> bool:
        """Ask once more for a precise date. Returns False if the quota is spent.

        The quota is the gateway's answer, never a local counter compared to a
        local constant — that is the whole point of not duplicating rules.
        """
        if not await self._gateway.may_nudge(self.state.nudges):
            return False
        self.state.nudges += 1
        await self._say("Alors, quel jour exactement je peux noter ?")
        return True

    async def request_instalments(
        self, *, instalments: int, first_payment_in_days: int, last_payment_late_days: int
    ) -> InstalmentDecision:
        """The debtor asked to pay in several times (US-3)."""
        decision = await self._gateway.decide_instalment(
            instalments=instalments,
            first_payment_in_days=first_payment_in_days,
            last_payment_late_days=last_payment_late_days,
        )

        if decision.granted:
            # Thinking moment: the agent has just consulted what it may grant.
            await self._say(
                f"{HESITATION} laissez-moi regarder. Voilà. "
                f"Du coup, on peut faire {decision.instalments} fois. "
                f"Le premier sous {decision.first_payment_in_days} jours. Ça vous irait ?"
            )
        else:
            # No internal reason is voiced. The debtor hears a neutral hand-off;
            # the *owner* gets the detailed reason in the cockpit.
            self.state.escalations.append("echelonnement_a_decider")
            await self._say(
                "Écoutez, je note votre demande et je la transmets. "
                "On revient vers vous là-dessus."
            )
        return decision

    async def record_promise(self, *, amount_eur: str, date_label: str) -> None:
        """Take a promise and lock it by recap (US-3)."""
        self.state.promise_obtained = True
        # Thinking moment: the agent is gathering what was just agreed before
        # reading it back. The recap is the one line that must be heard clearly,
        # so the hesitation sits before it, never inside it.
        await self._say(
            f"{HESITATION} je résume. "
            f"Vous réglez {amount_eur} le {date_label}. C'est bien ça ?"
        )

    async def confirm_promise(self) -> None:
        """The debtor confirmed the recap. Only now is the promise real."""
        self.state.promise_confirmed = True

    async def run(self, turns: AsyncIterator[str]) -> Outcome:
        """Drive a whole call from the debtor's turns.

        Used by the simulation harness and the evals. Real calls drive the same
        methods from the LiveKit event loop.
        """
        await self.announce()
        async for utterance in turns:
            await self.handle(utterance)
            if self.state.outcome is not None:
                return self.state.outcome

        if self.state.promise_obtained and self.state.promise_confirmed:
            await self.close(Outcome.PROMISE)
            return Outcome.PROMISE

        await self.close(Outcome.UNREACHABLE)
        return Outcome.UNREACHABLE
