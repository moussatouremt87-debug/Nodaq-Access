"""The simulation providers, which every later eval will stand on.

If they lie, the §5 evals pass while proving nothing — so they get tested
first, before any conversational logic exists to hide behind.
"""

from __future__ import annotations

from voice.core.interfaces import CallOutcome
from voice.core.simulation import (
    SimulatedSpeechToText,
    SimulatedTelephony,
    SimulatedTextToSpeech,
    stream,
)


async def test_stt_replays_scripted_turns_and_keeps_no_audio() -> None:
    stt = SimulatedSpeechToText(["je paierai vendredi", "d'accord"])

    segments = [
        seg.text async for seg in stt.transcribe(stream([b"a", b"b", b"c"]), language="fr")
    ]

    assert segments == ["je paierai vendredi", "d'accord"]
    # The audio was consumed — the plumbing ran — and nothing was retained.
    assert stt.consumed_chunks >= 2
    assert not hasattr(stt, "audio")


async def test_stt_stops_when_the_script_runs_out() -> None:
    """Silence, not an exception: a debtor who stops talking is normal."""
    stt = SimulatedSpeechToText(["oui"])
    segments = [seg async for seg in stt.transcribe(stream([b"a", b"b", b"c", b"d"]))]
    assert len(segments) == 1


async def test_tts_records_everything_said() -> None:
    """The evals of §5 are assertions over this record."""
    tts = SimulatedTextToSpeech()

    async for _ in tts.synthesize("Bonjour, assistant automatique de Dubois."):
        pass
    async for _ in tts.synthesize("Quel jour exactement puis-je noter ?"):
        pass

    assert len(tts.utterances) == 2
    assert "assistant automatique" in tts.said
    assert "quel jour" in tts.said


async def test_telephony_records_attempts_without_dialling() -> None:
    """Attempts, not outcomes — a `doNotCall` eval must assert on attempts."""
    phone = SimulatedTelephony()

    await phone.dial("+33600000001", caller_id="+33500000000")
    await phone.dial("+33600000002", caller_id="+33500000000")

    assert phone.dialled_numbers() == ["+33600000001", "+33600000002"]


async def test_telephony_replays_staged_outcomes_then_falls_back() -> None:
    """Stages "no answer, then voicemail" so retry policy can be exercised."""
    phone = SimulatedTelephony(outcomes=[CallOutcome.NO_ANSWER, CallOutcome.VOICEMAIL])

    first = await phone.dial("+33600000001", caller_id="+33500000000")
    second = await phone.dial("+33600000001", caller_id="+33500000000")
    third = await phone.dial("+33600000001", caller_id="+33500000000")

    assert first.outcome is CallOutcome.NO_ANSWER
    assert second.outcome is CallOutcome.VOICEMAIL
    # Script exhausted: a stable default rather than an error the test would
    # have to work around.
    assert third.outcome is CallOutcome.ANSWERED
    assert first.id != second.id != third.id


async def test_hang_up_is_recorded() -> None:
    phone = SimulatedTelephony()
    session = await phone.dial("+33600000001", caller_id="+33500000000")
    await phone.hang_up(session.id)
    assert phone.hung_up == [session.id]
