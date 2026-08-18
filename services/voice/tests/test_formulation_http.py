"""The wording adapter — tested without touching the network.

`httpx.MockTransport` intercepts at the transport layer, so the request that
*would* have gone over the wire is inspected in full. What matters here is that
this side sends a decided move plus the facts it was given, and nothing more:
no prompt, no model name, no key. The single exit towards a model stays in
`lib/llm` (CLAUDE.md rule 2).
"""

from __future__ import annotations

import json

import httpx
import pytest

from voice.adapters.formulation_http import (
    FormulationConfig,
    FormulationConfigError,
    HttpPhrasing,
)
from voice.core.conversation import Intent, Turn


def capture(
    *, status: int = 200, body: object | None = None
) -> tuple[list[httpx.Request], httpx.AsyncClient]:
    vues: list[httpx.Request] = []
    defaut = {"replique": "Ah, d'accord.", "source": "modele"}

    def handler(request: httpx.Request) -> httpx.Response:
        vues.append(request)
        return httpx.Response(status, json=body if body is not None else defaut)

    return vues, httpx.AsyncClient(transport=httpx.MockTransport(handler))


def config() -> FormulationConfig:
    return FormulationConfig(base_url="https://api.test.nodaq", token="jeton-de-test")


# ── What goes over the wire ────────────────────────────────────────────────


async def test_sends_the_intent_facts_and_history() -> None:
    vues, client = capture()
    phrasing = HttpPhrasing(config(), client=client)

    await phrasing.line(
        Intent.RECAP_PROMISE,
        facts={"montant": "1 200 €", "date": "15 septembre"},
        history=[Turn(speaker="debiteur", text="le 15 ça ira")],
    )

    envoye = json.loads(vues[0].content)
    assert envoye["intention"] == "recapituler_promesse"
    assert envoye["faits"] == {"montant": "1 200 €", "date": "15 septembre"}
    # The wire uses the French keys the Zod schema expects. A rename on either
    # side is a 400 during a live call, which is why the parity guard exists.
    assert envoye["historique"] == [{"locuteur": "debiteur", "propos": "le 15 ça ira"}]


async def test_sends_no_prompt_and_no_model_name() -> None:
    """Rule 2: exactly one exit towards a model, resolved in `lib/llm`.

    If this worker ever carried the prompt or the model name, it would be one
    step away from carrying a key and calling a provider directly.
    """
    vues, client = capture()
    phrasing = HttpPhrasing(config(), client=client)

    await phrasing.line(Intent.ASK_DATE, facts={}, history=[])

    corps = vues[0].content.decode().lower()
    for interdit in ("model", "prompt", "system", "temperature", "api_key"):
        assert interdit not in corps, f"the worker is carrying « {interdit} »"


async def test_the_reply_is_used_verbatim() -> None:
    _, client = capture(body={"replique": "Alors… euh, je regarde.", "source": "modele"})
    phrasing = HttpPhrasing(config(), client=client)

    assert await phrasing.line(Intent.ASK_DATE, facts={}, history=[]) == (
        "Alors… euh, je regarde."
    )


# ── Failures never leak the conversation ───────────────────────────────────


async def test_an_http_error_never_echoes_the_body() -> None:
    # An error body may echo the history back, which is conversation verbatim.
    # CLAUDE.md rule 6 forbids it in a log — including inside an exception
    # message, which is exactly where it would end up.
    _, client = capture(status=500, body={"error": "le débiteur a dit : je conteste"})
    phrasing = HttpPhrasing(config(), client=client)

    with pytest.raises(RuntimeError) as err:
        await phrasing.line(Intent.CLOSE_DISPUTE, facts={}, history=[])

    assert "500" in str(err.value)
    assert "je conteste" not in str(err.value)


async def test_an_empty_reply_raises_rather_than_speaking_silence() -> None:
    _, client = capture(body={"replique": "   "})
    phrasing = HttpPhrasing(config(), client=client)

    with pytest.raises(RuntimeError, match="empty"):
        await phrasing.line(Intent.ASK_DATE, facts={}, history=[])


# ── Configuration refuses to guess ─────────────────────────────────────────


def test_missing_url_raises_rather_than_defaulting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("VOICE_DECISION_API_URL", raising=False)
    with pytest.raises(FormulationConfigError, match="VOICE_DECISION_API_URL"):
        FormulationConfig.from_env()


def test_a_present_but_empty_url_is_treated_as_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The most common state of a copied `.env`. `get(name, default)` would
    # return "" and build requests against a bare path.
    monkeypatch.setenv("VOICE_DECISION_API_URL", "")
    with pytest.raises(FormulationConfigError):
        FormulationConfig.from_env()


def test_a_trailing_slash_does_not_double_up(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_DECISION_API_URL", "https://api.test.nodaq/")
    assert FormulationConfig.from_env().base_url == "https://api.test.nodaq"
