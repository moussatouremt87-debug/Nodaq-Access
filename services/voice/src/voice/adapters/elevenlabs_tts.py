"""ElevenLabs speech synthesis (ticket 4.18, §1 — decided August 2026).

Chosen after Kokoro-82M and Chatterbox Multilingual were built and rejected:
Kokoro runs in real time on CPU but sounds synthetic; Chatterbox sounds better
but generated **seven to nine times slower than real time** on Apple Silicon
(measured, not estimated), which rules it out for a live phone call. See
`docs/adr/002-tts-elevenlabs.md` for the full trade-off and, more importantly,
for the reversion criterion.

Two things about this file are deliberate and worth reading before changing it.

**No vendor SDK.** Plain HTTP over `httpx`. The layering guard in
`tests/test_layering.py` forbids provider SDKs in `voice.core`; adapters are
allowed them, but taking one here would still buy a dependency, a release
cadence and a surface we do not need for three endpoints. It also keeps the
adapter readable as *exactly* what goes over the wire — which matters when the
thing going over the wire is personal data.

**Output is telephone audio, natively.** ElevenLabs emits `ulaw_8000`, which is
the format Twilio's trunk expects. Nothing is resampled, so nothing degrades
twice, and no `ffmpeg` sits in the live path.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

API_BASE = "https://api.elevenlabs.io/v1"

#: Real-time model. ~75 ms, 32 languages including French. The alternatives are
#: either English-only (`eleven_flash_v2`) or an order of magnitude slower.
MODEL_TEMPS_REEL = "eleven_flash_v2_5"

#: G.711 μ-law, 8 kHz — what a phone line carries and what Twilio ingests.
FORMAT_TELEPHONE = "ulaw_8000"


class ElevenLabsConfigError(RuntimeError):
    """Configuration missing or incoherent. Never carries a key value."""


@dataclass(frozen=True, slots=True)
class ElevenLabsConfig:
    api_key: str
    voice_id: str
    model_id: str = MODEL_TEMPS_REEL
    output_format: str = FORMAT_TELEPHONE
    base_url: str = API_BASE
    #: Zero Retention Mode. **Enterprise-only** — verified against the vendor
    #: documentation in August 2026: "if using enable_logging=false (zero
    #: retention mode), you must be an enterprise customer".
    #:
    #: Left False by default on purpose. Sending it on a self-service plan does
    #: not silently grant the guarantee, and a default of True would let the
    #: code *claim* a posture the contract does not provide — the exact kind of
    #: lie the sovereignty attestation exists to prevent.
    zero_retention: bool = False

    @staticmethod
    def from_env() -> ElevenLabsConfig:
        """Read configuration. No defaults for anything that decides where data goes.

        A missing variable raises rather than falling back: a synthesis
        provider chosen by omission is a subprocessor nobody declared.
        """
        key = os.environ.get("VOICE_TTS_API_KEY", "")
        voice = os.environ.get("VOICE_TTS_VOICE_ID", "")
        if not key:
            raise ElevenLabsConfigError("VOICE_TTS_API_KEY is not set")
        if not voice:
            raise ElevenLabsConfigError("VOICE_TTS_VOICE_ID is not set")
        return ElevenLabsConfig(
            api_key=key,
            voice_id=voice,
            # `or` et non le défaut de `get` : une variable PRÉSENTE MAIS VIDE
            # — l'état le plus courant d'un `.env` recopié — rendrait "" et
            # écraserait le défaut par une chaîne vide. On demanderait alors un
            # modèle sans nom, et l'erreur arriverait au premier appel réel.
            model_id=os.environ.get("VOICE_TTS_MODEL") or MODEL_TEMPS_REEL,
            base_url=os.environ.get("VOICE_TTS_BASE_URL") or API_BASE,
            zero_retention=os.environ.get("VOICE_TTS_ZERO_RETENTION", "") == "true",
        )


def texte_sans_identite(texte: str) -> str:
    """Hook for the minimisation rule — see the module note below.

    Kept as an explicit, named seam rather than an inline `replace` so that the
    place where personal data could reach a US subprocessor is a single,
    greppable function. It currently returns the text unchanged: stripping the
    debtor's name is decided by the caller, which is the only layer that knows
    which words *are* the name.
    """
    return texte


class ElevenLabsTextToSpeech:
    """Streaming synthesis. Implements `voice.core.interfaces.TextToSpeech`.

    Streamed rather than buffered because the agent must be interruptible: a
    sentence that cannot be cut off mid-way is what makes automated calls
    unbearable, and the ticket lists barge-in as non-negotiable.
    """

    def __init__(
        self, config: ElevenLabsConfig, client: httpx.AsyncClient | None = None
    ) -> None:
        self._config = config
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=3.0)
        )

    async def synthesize(self, text: str, *, language: str = "fr") -> AsyncIterator[bytes]:
        cfg = self._config
        params: dict[str, str] = {"output_format": cfg.output_format}
        if cfg.zero_retention:
            params["enable_logging"] = "false"

        payload = {
            "text": texte_sans_identite(text),
            "model_id": cfg.model_id,
            # `language` is passed explicitly rather than left to detection: a
            # French line detected as English would be spoken with an English
            # accent, and a debtor hearing that hangs up.
            "language_code": language,
        }

        async with self._client.stream(
            "POST",
            f"{cfg.base_url}/text-to-speech/{cfg.voice_id}/stream",
            params=params,
            headers={"xi-api-key": cfg.api_key, "Content-Type": "application/json"},
            json=payload,
        ) as reponse:
            if reponse.status_code != 200:
                corps = (await reponse.aread())[:200].decode("utf-8", "replace")
                # The vendor echoes the submitted key back in some error bodies.
                # Relaying it verbatim would put the key in our logs — found by
                # `test_an_error_never_echoes_the_key`, which is exactly why
                # that test asserts on a body containing the key.
                # CLAUDE.md rule 6: never, not even truncated.
                corps = corps.replace(cfg.api_key, "[clé masquée]")
                raise RuntimeError(
                    f"ElevenLabs refused the request (HTTP {reponse.status_code}): {corps}"
                )
            async for morceau in reponse.aiter_bytes():
                if morceau:
                    yield morceau

    async def aclose(self) -> None:
        await self._client.aclose()
