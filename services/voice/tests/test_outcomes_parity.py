"""Outcome parity between the two runtimes.

`Outcome` (Python) and `ISSUES_APPEL` (TypeScript) name the same six things.
That duplication is deliberate and narrow — a *value list*, never logic — but a
duplicated list drifts, and the drift is silent: the worker would write an
outcome the cockpit cannot display, or the API would reject a value the worker
considers normal.

Reading the TypeScript source rather than importing it: this service has no
Node runtime, and a build step just to compare six strings would cost more than
it protects.
"""

from __future__ import annotations

import re
from pathlib import Path

from voice.core.conversation import Outcome

DECISION_TS = (
    Path(__file__).resolve().parents[3] / "lib" / "shared" / "src" / "decisionAppel.ts"
)


def _issues_from_typescript() -> set[str]:
    source = DECISION_TS.read_text(encoding="utf-8")
    block = re.search(r"export const ISSUES_APPEL = \[(.*?)\] as const;", source, re.S)
    assert block, "ISSUES_APPEL not found — the guard compares nothing"
    values = set(re.findall(r'"([a-z_]+)"', block.group(1)))
    assert values, "ISSUES_APPEL parsed empty"
    return values


def test_typescript_source_is_reachable() -> None:
    # A guard that silently stops finding its counterpart passes forever.
    assert DECISION_TS.is_file(), f"decisionAppel.ts not found at {DECISION_TS}"


def test_outcomes_match_exactly() -> None:
    python_side = {o.value for o in Outcome}
    assert python_side == _issues_from_typescript()
