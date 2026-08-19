"""Wording, fetched from the API server (ticket 4.18).

Implements `voice.core.conversation.Phrasing` by calling
`POST /relance/formulation`. The worker holds no prompt, no model name and no
model key — CLAUDE.md rule 2 allows exactly one exit towards a model, resolved
in `lib/llm`, and giving this process its own credentials would open a second.

The guards live on the same side as the rules they enforce: the route refuses a
reply that threatens, that reads like a letter, or that utters a figure nobody
supplied, and answers with a safe line instead. So there is **no fallback
wording here**. A copy in this file would be a second thing to keep in step,
and the day the two drift the looser one wins.
"""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import httpx

from voice.core.conversation import Intent, Turn


class FormulationConfigError(RuntimeError):
    """Configuration missing. Never carries a secret value."""


@dataclass(frozen=True, slots=True)
class FormulationConfig:
    base_url: str
    #: Le jeton de CET appel, exactement comme la passerelle de mandat.
    #:
    #: Écrit au lot 5b, ce module cherchait une variable d'environnement
    #: `VOICE_DECISION_API_TOKEN` — la couture d'alors, quand le schéma
    #: d'authentification restait à trancher. Le lot 6a a choisi le jeton par
    #: APPEL, et cette variable n'a jamais existé : la requête partait sans
    #: en-tête et se faisait refuser. Constaté au septième appel réel, où tout
    #: le reste fonctionnait — la passerelle répondait, la formulation non.
    call_token: str

    @staticmethod
    def from_env(call_token: str) -> FormulationConfig:
        base = os.environ.get("VOICE_DECISION_API_URL") or ""
        if not base:
            raise FormulationConfigError("VOICE_DECISION_API_URL is not set")
        if not call_token:
            raise FormulationConfigError("call token is empty")
        return FormulationConfig(base_url=base.rstrip("/"), call_token=call_token)


class HttpPhrasing:
    """Asks the API server to word one conversational move."""

    def __init__(
        self, config: FormulationConfig, client: httpx.AsyncClient | None = None
    ) -> None:
        self._config = config
        # Le délai couvre le BUDGET DE LA ROUTE, pas une intuition. Elle
        # s'autorise deux tentatives auprès du modèle avant de prononcer son
        # filet : à ~650 ms l'une, avec des pointes mesurées à 1 084 ms, deux
        # secondes étaient sous le budget qu'elle se donne. La conversation
        # mourait donc sur un `ReadTimeout` au deuxième tour — constaté au
        # huitième appel réel, alors que tout le reste fonctionnait.
        #
        # Six secondes, et l'attente ne s'entend pas : l'amorce couvre le blanc
        # (ADR 003). Ce n'est pas la latence qui est bornée ici, c'est
        # l'obstination.
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(6.0, connect=1.0)
        )

    async def line(
        self,
        intent: Intent,
        *,
        facts: Mapping[str, str],
        history: Sequence[Turn],
    ) -> str:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._config.call_token}",
        }

        reponse = await self._client.post(
            f"{self._config.base_url}/relance/formulation",
            headers=headers,
            json={
                "intention": intent.value,
                "faits": dict(facts),
                "historique": [
                    {"locuteur": t.speaker, "propos": t.text} for t in history
                ],
            },
        )
        if reponse.status_code != 200:
            # No body in the message: it may echo the history, which is
            # conversation verbatim (CLAUDE.md rule 6 — never in a log).
            raise RuntimeError(
                f"formulation refused the request (HTTP {reponse.status_code})"
            )

        ligne = str(reponse.json().get("replique", "")).strip()
        if not ligne:
            raise RuntimeError("formulation returned an empty line")
        return ligne

    async def aclose(self) -> None:
        await self._client.aclose()
