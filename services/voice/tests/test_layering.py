"""Layering guard — no provider SDK may reach `voice.core`.

Ticket 4.18 §5: coupling the business code to the SIP or STT provider is
forbidden, and §1 says why — Telnyx is a starting choice, not a commitment, and
the Gladia/Voxtral decision is explicitly deferred to a benchmark that has not
run. A single import in the wrong module turns "swap the adapter" into "rewrite
the agent".

Modelled on `llm-single-exit.test.ts`, which guards the same class of mistake on
the TypeScript side: an architectural rule that nothing enforces is a comment.

The check reads the source rather than importing it: importing a module to
inspect its imports would execute it, and would also miss anything guarded
behind a conditional import.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

CORE = Path(__file__).resolve().parent.parent / "src" / "voice" / "core"

# Vendor packages that must never appear under `voice.core`. Telephony, speech
# and model SDKs alike — the last group matters because the ticket routes every
# model call through the existing chain, never a provider SDK in the service.
FORBIDDEN_ROOTS = frozenset(
    {
        "telnyx",
        "livekit",
        "twilio",
        "vapi",
        "retell",
        "bland",
        "elevenlabs",
        "deepgram",
        "gladia",
        "openai",
        "anthropic",
        "mistralai",
        "litellm",
    }
)


def _core_modules() -> list[Path]:
    modules = sorted(CORE.rglob("*.py"))
    assert modules, "no module found under voice.core — the guard compares nothing"
    return modules


def _imported_roots(source: str) -> set[str]:
    """Top-level package of every import, including inside functions."""
    roots: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            # `level > 0` is a relative import: local by construction.
            if node.level == 0 and node.module:
                roots.add(node.module.split(".")[0])
    return roots


@pytest.mark.parametrize("module", _core_modules(), ids=lambda p: p.name)
def test_core_imports_no_provider_sdk(module: Path) -> None:
    offending = _imported_roots(module.read_text(encoding="utf-8")) & FORBIDDEN_ROOTS
    assert not offending, (
        f"{module.name} imports {sorted(offending)}. A provider belongs in "
        f"voice.adapters, reached through the protocols in voice.core.interfaces."
    )


def test_guard_would_catch_a_violation() -> None:
    """The guard itself, exercised.

    A rule nobody has seen fire is not a rule. Rather than committing a
    deliberate violation and removing it, the detector is run against a source
    that contains one.
    """
    assert _imported_roots("import telnyx\n") & FORBIDDEN_ROOTS == {"telnyx"}
    assert _imported_roots("from livekit import agents\n") & FORBIDDEN_ROOTS == {"livekit"}
    # And it must not fire on what the core legitimately uses.
    legitimate = _imported_roots("from voice.core.interfaces import CallOutcome\n")
    assert not legitimate & FORBIDDEN_ROOTS
