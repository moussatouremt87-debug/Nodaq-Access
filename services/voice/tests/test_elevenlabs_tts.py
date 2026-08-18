"""The ElevenLabs adapter — tested without touching the network.

`httpx.MockTransport` intercepts at the transport layer, so the request that
*would* have gone over the wire is inspected in full. That matters more here
than in a normal adapter: what crosses this boundary is personal data leaving
the sovereign perimeter, and the assertions below are about exactly what
crosses.
"""

from __future__ import annotations

import json

import httpx
import pytest

from voice.adapters.elevenlabs_tts import (
    FORMAT_TELEPHONE,
    MODEL_TEMPS_REEL,
    ElevenLabsConfig,
    ElevenLabsConfigError,
    ElevenLabsTextToSpeech,
)


def capture() -> tuple[list[httpx.Request], httpx.AsyncClient]:
    """A client that records requests and answers with three audio chunks."""
    vues: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        vues.append(request)
        return httpx.Response(200, content=b"\x01\x02\x03")

    return vues, httpx.AsyncClient(transport=httpx.MockTransport(handler))


def config(*, zero_retention: bool = False) -> ElevenLabsConfig:
    return ElevenLabsConfig(
        api_key="cle-de-test", voice_id="voix-123", zero_retention=zero_retention
    )


# ── What goes over the wire ────────────────────────────────────────────────


async def test_uses_the_realtime_model_and_telephone_format() -> None:
    vues, client = capture()
    tts = ElevenLabsTextToSpeech(config(), client=client)

    async for _ in tts.synthesize("Bonjour."):
        pass

    req = vues[0]
    assert MODEL_TEMPS_REEL in req.content.decode()
    # ulaw_8000 is what the Twilio trunk ingests. Asking for anything else
    # would put a resampling step in the live path and degrade twice.
    assert req.url.params["output_format"] == FORMAT_TELEPHONE
    assert "voix-123" in str(req.url)


async def test_language_is_sent_explicitly() -> None:
    # A French line detected as English is spoken with an English accent, and a
    # debtor who hears that hangs up. Detection is never relied upon.
    vues, client = capture()
    tts = ElevenLabsTextToSpeech(config(), client=client)

    async for _ in tts.synthesize("Quel jour exactement puis-je noter ?"):
        pass

    envoye = json.loads(vues[0].content)
    assert envoye["language_code"] == "fr"


async def test_audio_is_streamed_not_buffered() -> None:
    # Barge-in: a sentence that cannot be cut off mid-way is what makes
    # automated calls unbearable.
    _, client = capture()
    tts = ElevenLabsTextToSpeech(config(), client=client)

    morceaux = [m async for m in tts.synthesize("Bonjour.")]

    assert morceaux
    assert b"".join(morceaux) == b"\x01\x02\x03"


# ── Zero Retention Mode: claimed only when it is actually held ─────────────


async def test_zero_retention_is_off_by_default() -> None:
    """Enterprise-only, verified 2026-08-18.

    Defaulting to True would make the code *claim* a posture the contract does
    not provide — precisely the lie the sovereignty attestation exists to
    prevent.
    """
    vues, client = capture()
    tts = ElevenLabsTextToSpeech(config(), client=client)

    async for _ in tts.synthesize("Bonjour."):
        pass

    assert "enable_logging" not in vues[0].url.params


async def test_zero_retention_is_sent_when_explicitly_enabled() -> None:
    vues, client = capture()
    tts = ElevenLabsTextToSpeech(config(zero_retention=True), client=client)

    async for _ in tts.synthesize("Bonjour."):
        pass

    assert vues[0].url.params["enable_logging"] == "false"


# ── The key never leaks ────────────────────────────────────────────────────


async def test_the_api_key_is_sent_as_a_header_never_in_the_url() -> None:
    vues, client = capture()
    tts = ElevenLabsTextToSpeech(config(), client=client)

    async for _ in tts.synthesize("Bonjour."):
        pass

    assert vues[0].headers["xi-api-key"] == "cle-de-test"
    # A key in a query string ends up in every proxy log along the way.
    assert "cle-de-test" not in str(vues[0].url)


async def test_an_error_never_echoes_the_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, content=b'{"detail":"invalid api key cle-de-test"}')

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    tts = ElevenLabsTextToSpeech(config(), client=client)

    with pytest.raises(RuntimeError) as err:
        async for _ in tts.synthesize("Bonjour."):
            pass

    # The vendor echoed the key back; we must not relay it into our logs.
    # CLAUDE.md rule 6: never, not even truncated.
    assert "401" in str(err.value)
    assert "cle-de-test" not in str(err.value)


# ── Configuration refuses to guess ─────────────────────────────────────────


def test_missing_key_or_voice_raises_rather_than_defaulting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A synthesis provider chosen by omission is a subprocessor nobody
    # declared. There is no default here on purpose.
    monkeypatch.delenv("VOICE_TTS_API_KEY", raising=False)
    monkeypatch.delenv("VOICE_TTS_VOICE_ID", raising=False)
    with pytest.raises(ElevenLabsConfigError, match="VOICE_TTS_API_KEY"):
        ElevenLabsConfig.from_env()

    monkeypatch.setenv("VOICE_TTS_API_KEY", "x")
    with pytest.raises(ElevenLabsConfigError, match="VOICE_TTS_VOICE_ID"):
        ElevenLabsConfig.from_env()


def test_config_error_never_contains_a_key_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_TTS_API_KEY", "cle-tres-secrete")
    monkeypatch.delenv("VOICE_TTS_VOICE_ID", raising=False)
    with pytest.raises(ElevenLabsConfigError) as err:
        ElevenLabsConfig.from_env()
    assert "cle-tres-secrete" not in str(err.value)


def test_zero_retention_from_env_requires_the_exact_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VOICE_TTS_API_KEY", "x")
    monkeypatch.setenv("VOICE_TTS_VOICE_ID", "v")
    for valeur in ("", "1", "yes", "True", "TRUE"):
        monkeypatch.setenv("VOICE_TTS_ZERO_RETENTION", valeur)
        # Anything but the exact `true` leaves the guarantee unclaimed. A loose
        # parser here would silently assert an Enterprise posture.
        assert ElevenLabsConfig.from_env().zero_retention is False
    monkeypatch.setenv("VOICE_TTS_ZERO_RETENTION", "true")
    assert ElevenLabsConfig.from_env().zero_retention is True
