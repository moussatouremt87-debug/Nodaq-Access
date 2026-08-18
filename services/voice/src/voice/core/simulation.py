"""In-memory providers, so the whole pipeline runs without a phone line.

The ticket forbids dialling a real number without an approved `pending_action`,
"including just to test in staging: simulation mode exists for that" (§5). This
module is that mode, and it is not a stub — the conversational evals of §5 run
against it, and they are the gate before any UI is exposed.

Two design points worth stating, because they are what make the evals possible:

* `SimulatedTelephony` records every number it was asked to dial. An eval that
  must prove the agent never calls a `doNotCall` contact needs to assert on
  *attempts*, not on outcomes — a call that fails for unrelated reasons would
  otherwise pass for compliance.
* `SimulatedTextToSpeech` keeps everything the agent said. Every guard-rail in
  §5 (no threats, no more than two nudges, always recap the promise before
  closing) is an assertion over that transcript. Without it the evals could only
  check the final outcome, which is precisely what a badly behaved agent can
  reach by unacceptable means.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterable, Sequence
from dataclasses import dataclass, field

from voice.core.interfaces import CallOutcome, CallSession, TranscriptSegment


class SimulatedSpeechToText:
    """Replays a scripted set of debtor turns instead of listening.

    Audio is consumed and dropped: the caller still has to feed the stream, so
    the plumbing is exercised, but nothing is kept — the same rule as in
    production.
    """

    def __init__(self, turns: Sequence[str]) -> None:
        self._turns = list(turns)
        self.consumed_chunks = 0

    async def transcribe(
        self, audio: AsyncIterator[bytes], *, language: str = "fr"
    ) -> AsyncIterator[TranscriptSegment]:
        async for _chunk in audio:
            self.consumed_chunks += 1
            if not self._turns:
                return
            yield TranscriptSegment(text=self._turns.pop(0), is_final=True, confidence=1.0)


class SimulatedTextToSpeech:
    """Records what the agent said; emits a token of audio per utterance."""

    def __init__(self) -> None:
        self.utterances: list[str] = []

    async def synthesize(self, text: str, *, language: str = "fr") -> AsyncIterator[bytes]:
        self.utterances.append(text)
        yield b"\x00"

    @property
    def said(self) -> str:
        """Everything said in one lowercase string, for eval assertions."""
        return " ".join(self.utterances).lower()


@dataclass(frozen=True, slots=True)
class DialAttempt:
    number_e164: str
    caller_id: str


@dataclass
class SimulatedTelephony:
    """Never places a call. Records what would have been dialled.

    `outcomes` is consumed in order, so an eval can stage "no answer, then
    voicemail, then answered" and check the retry policy. Once exhausted, the
    default applies — a test that runs longer than its script gets a stable
    answer rather than an exception it would have to code around.
    """

    outcomes: list[CallOutcome] = field(default_factory=list)
    default_outcome: CallOutcome = CallOutcome.ANSWERED
    attempts: list[DialAttempt] = field(default_factory=list)
    hung_up: list[str] = field(default_factory=list)
    _counter: int = 0

    async def dial(self, number_e164: str, *, caller_id: str) -> CallSession:
        self.attempts.append(DialAttempt(number_e164=number_e164, caller_id=caller_id))
        outcome = self.outcomes.pop(0) if self.outcomes else self.default_outcome
        self._counter += 1
        return CallSession(id=f"sim-{self._counter}", outcome=outcome)

    async def hang_up(self, call_id: str) -> None:
        self.hung_up.append(call_id)

    def dialled_numbers(self) -> list[str]:
        return [a.number_e164 for a in self.attempts]


async def stream(chunks: Iterable[bytes]) -> AsyncIterator[bytes]:
    """Turns a plain iterable into the async stream the protocols expect."""
    for chunk in chunks:
        yield chunk
