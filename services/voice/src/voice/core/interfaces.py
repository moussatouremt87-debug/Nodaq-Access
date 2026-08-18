"""Provider seams for the outbound voice agent (ticket 4.18, §1).

Every external dependency of a call — speech-to-text, text-to-speech,
telephony — is reached through one of the protocols below and never directly.

The reason is written in the ticket and it is not stylistic: Telnyx is a
*starting choice*, not a coupling. Moving to a French carrier must stay a change
of implementation, not a rewrite. The same holds for STT, where the ticket
explicitly defers the Gladia/Voxtral decision to a latency benchmark that has
not happened yet — code written against a concrete provider today would have to
be unwritten tomorrow.

`tests/test_layering.py` enforces that nothing under `voice.core` imports a
provider SDK. Only `voice.adapters` may.

Audio never touches disk and never reaches a log: the product keeps the
transcript, never the recording (ticket §6, aligned with the dictated quote).
That is why audio moves as streams here and is never returned whole.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


@dataclass(frozen=True, slots=True)
class TranscriptSegment:
    """One chunk of recognised speech.

    `is_final` matters for turn-taking: acting on a partial transcript makes the
    agent talk over the person it called.
    """

    text: str
    is_final: bool
    confidence: float | None = None


class SpeechToText(Protocol):
    """Streaming recognition. French, telephone-band audio."""

    async def transcribe(
        self, audio: AsyncIterator[bytes], *, language: str = "fr"
    ) -> AsyncIterator[TranscriptSegment]: ...


class TextToSpeech(Protocol):
    """Speech synthesis, streamed so the agent can be cut off mid-sentence.

    Barge-in is not a refinement. An agent that finishes its sentence while the
    person is talking is the single behaviour that makes automated calls
    unbearable, and the ticket lists it as non-negotiable (§1, VAD).
    """

    async def synthesize(self, text: str, *, language: str = "fr") -> AsyncIterator[bytes]: ...


class CallOutcome(StrEnum):
    """How a dial attempt ended, at the transport level.

    Distinct from the *business* outcome of the conversation (promise, dispute,
    opt-out…), which belongs to the decision core and is deliberately not
    modelled here: a carrier knows whether it rang, not whether a debtor agreed
    to pay.
    """

    ANSWERED = "answered"
    VOICEMAIL = "voicemail"
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class CallSession:
    """A live call. `id` is the carrier's, kept for cost reconciliation."""

    id: str
    outcome: CallOutcome


class TelephonyProvider(Protocol):
    """Places calls. Knows nothing about invoices, debtors or mandates."""

    async def dial(self, number_e164: str, *, caller_id: str) -> CallSession: ...

    async def hang_up(self, call_id: str) -> None: ...
