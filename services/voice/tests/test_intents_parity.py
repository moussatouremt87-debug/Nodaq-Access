"""Intent parity between the two runtimes, and the boundary the model never crosses.

`Intent` (Python) and `INTENTIONS_REPLIQUE` (TypeScript) name the same eight
conversational moves. The string is what travels over the wire, so a drift is
not a stylistic problem: the worker would ask for a move the route rejects with
a 400 — during a live call, in front of a real person.

Same approach as `test_outcomes_parity.py`: read the TypeScript source rather
than import it. This service has no Node runtime, and a build step to compare
eight strings would cost more than it protects.
"""

from __future__ import annotations

import re
from pathlib import Path

from voice.core.conversation import Intent

FORMULATION_TS = (
    Path(__file__).resolve().parents[3] / "lib" / "shared" / "src" / "formulation.ts"
)


def _intents_from_typescript() -> set[str]:
    source = FORMULATION_TS.read_text(encoding="utf-8")
    block = re.search(
        r"export const INTENTIONS_REPLIQUE = \[(.*?)\] as const;", source, re.S
    )
    assert block, "INTENTIONS_REPLIQUE not found — the guard compares nothing"
    values = set(re.findall(r'"([a-z_]+)"', block.group(1)))
    assert values, "INTENTIONS_REPLIQUE parsed empty"
    return values


def test_typescript_source_is_reachable() -> None:
    # A guard that silently stops finding its counterpart passes forever.
    assert FORMULATION_TS.is_file(), f"formulation.ts not found at {FORMULATION_TS}"


def test_intents_match_exactly() -> None:
    python_side = {i.value for i in Intent}
    assert python_side == _intents_from_typescript()


def test_no_intent_lets_the_model_write_the_announcement() -> None:
    """US-2, asserted on both sides.

    The opening announcement comes from `annonceOuverture()`, word for word.
    An announcement a model may rephrase is one that can, one day, stop
    announcing — so there must be no move that asks it to introduce itself.
    """
    # Pinned literally, like its TypeScript counterpart. Adding a move must
    # force someone to come and edit this list — that is, to decide — rather
    # than slip past a pattern match. (A name filter was tried and was worse:
    # `clore_paiement_annonce` contains "annonce", meaning the payment the
    # debtor announced, and tripped the guard for the wrong reason.)
    assert {i.value for i in Intent} == {
        "demander_date",
        "offrir_echelonnement",
        "refuser_et_transmettre",
        "recapituler_promesse",
        "clore_contestation",
        "clore_paiement_annonce",
        "clore_rappel_humain",
        "clore_opposition",
    }
