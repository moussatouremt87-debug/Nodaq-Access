"""The driver never writes what the agent says (ticket 4.18).

Wording comes from the model, through `Phrasing`. That is the whole point of
the change: lines written in the driver recite — same word, same place, every
call, no reaction to what the person just said — and a debtor hears it within
two turns.

The risk is not that someone rewrites the architecture. It is that one hurried
fix puts a single sentence back ("just for this case"), then a second, and six
months later half the call is scripted again with no one having decided it.
This guard is what makes that a build failure rather than a slow drift.

It reads the source with `ast` rather than by regex: a substring search would
trip over docstrings and comments, and a guard that cries wolf gets deleted.

**One exemption, and it is the rule, not a hole.** `announce()` speaks the
gateway's line directly — US-2 requires the announcement to be produced by
`annonceOuverture()` word for word, because an announcement a model may
rephrase is one that can, one day, stop announcing. The exemption is narrow:
`_speak` may be called with a *variable*, never with a literal.
"""

from __future__ import annotations

import ast
from pathlib import Path

CONVERSATION_PY = (
    Path(__file__).resolve().parents[1] / "src" / "voice" / "core" / "conversation.py"
)

#: Everything that ends up at the synthesiser goes through one of these.
SPEAKING = {"_say", "_speak"}


def _speaking_calls(tree: ast.Module) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in SPEAKING
    ]


def test_the_source_is_reachable() -> None:
    # A guard that silently stops finding its target passes forever.
    assert CONVERSATION_PY.is_file(), f"conversation.py not found at {CONVERSATION_PY}"


def test_no_literal_line_is_ever_spoken() -> None:
    tree = ast.parse(CONVERSATION_PY.read_text(encoding="utf-8"))
    calls = _speaking_calls(tree)
    assert calls, "no speaking call found — the guard is comparing nothing"

    fautives = [
        ast.unparse(argument)
        for call in calls
        for argument in [*call.args, *(kw.value for kw in call.keywords)]
        if isinstance(argument, ast.Constant | ast.JoinedStr)
    ]
    assert not fautives, (
        "a line is written in the driver instead of being worded by the model: "
        f"{fautives}"
    )


def test_every_spoken_move_is_a_declared_intent() -> None:
    """`_say` takes an `Intent`, never an ad-hoc string.

    Without this, `_say("demander_date")` would pass the literal check above by
    being an argument the route happens to accept — and the parity guard with
    TypeScript would stop covering it.
    """
    tree = ast.parse(CONVERSATION_PY.read_text(encoding="utf-8"))
    for call in _speaking_calls(tree):
        if not (isinstance(call.func, ast.Attribute) and call.func.attr == "_say"):
            continue
        premier = call.args[0]
        rendu = ast.unparse(premier)
        assert rendu.startswith("Intent."), f"`_say` called with {rendu}, not an Intent"
