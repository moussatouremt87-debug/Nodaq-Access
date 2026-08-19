"""The mandate gateway, over HTTP (ticket 4.18, lot 6).

Implements `voice.core.conversation.MandateGateway` against
`/relance/appel/*`. Every answer here commits the company — how many instalments
may be granted, whether one may nudge again — so none of it is computed on this
side. The decision core answers; the worker carries out.

**No tenant is ever sent.** The call token identifies the call, and the server
reads the tenant from the row it designates. This side literally has no way to
name a tenant, which is what makes CLAUDE.md rule 1 structural rather than a
matter of care. `test_mandate_http.py` asserts that nothing tenant-shaped
crosses the wire.

The refusal **reason** is deliberately not returned by the server, so it cannot
be relayed to the model, which could then say it out loud. The debtor hears a
neutral hand-off; the owner reads the detail in the cockpit.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import httpx

from voice.core.conversation import InstalmentDecision


class MandateConfigError(RuntimeError):
    """Configuration missing. Never carries a token value."""


@dataclass(frozen=True, slots=True)
class MandateConfig:
    base_url: str
    #: Le jeton de CET appel, remis par le serveur au moment de composer. Il ne
    #: vaut que pendant l'appel et n'ouvre aucune autre route.
    call_token: str

    @staticmethod
    def from_env(call_token: str) -> MandateConfig:
        base = os.environ.get("VOICE_DECISION_API_URL") or ""
        if not base:
            raise MandateConfigError("VOICE_DECISION_API_URL is not set")
        if not call_token:
            raise MandateConfigError("call token is empty")
        return MandateConfig(base_url=base.rstrip("/"), call_token=call_token)


class HttpMandateGateway:
    """Asks the server what this call is allowed to do."""

    def __init__(
        self, config: MandateConfig, client: httpx.AsyncClient | None = None
    ) -> None:
        self._config = config
        # Plus court que la formulation, et c'est justifié : ces routes ne
        # consultent aucun modèle. Elles lisent une règle et appliquent une
        # décision pure — si elles mettent plus de trois secondes, ce n'est pas
        # de la lenteur, c'est une panne.
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(3.0, connect=1.0)
        )

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._config.call_token}",
            "Content-Type": "application/json",
        }

    def _url(self, chemin: str) -> str:
        return f"{self._config.base_url}/relance/appel/{chemin}"

    def _verifier(self, reponse: httpx.Response) -> None:
        if reponse.status_code != 200:
            # Aucun corps dans le message : il peut contenir le détail d'une
            # décision, voire un montant. Le code suffit à diagnostiquer.
            raise RuntimeError(
                f"la passerelle de mandat a refusé (HTTP {reponse.status_code})"
            )

    async def may_nudge(self, nudges_so_far: int) -> bool:
        reponse = await self._client.get(
            self._url("insistance"),
            headers=self._headers,
            params={"faites": nudges_so_far},
        )
        self._verifier(reponse)
        return bool(reponse.json()["autorise"])

    async def decide_instalment(
        self, *, instalments: int, first_payment_in_days: int, last_payment_late_days: int
    ) -> InstalmentDecision:
        reponse = await self._client.post(
            self._url("echelonnement"),
            headers=self._headers,
            json={
                "versements": instalments,
                "premierVersementDansJours": first_payment_in_days,
                "dernierVersementRetardJours": last_payment_late_days,
            },
        )
        self._verifier(reponse)
        corps = reponse.json()

        if not corps.get("accorde"):
            # Rien d'autre à lire : le serveur ne rend PAS le motif, exprès.
            return InstalmentDecision(granted=False)

        return InstalmentDecision(
            granted=True,
            # Ce que le noyau a ACCORDÉ, jamais ce que le débiteur a demandé.
            instalments=int(corps["versements"]),
            first_payment_in_days=int(corps["premierVersementDansJours"]),
        )

    async def opening_line(self) -> str:
        reponse = await self._client.get(self._url("ouverture"), headers=self._headers)
        # 409 = raison sociale absente : l'agent ne peut pas s'annoncer, donc on
        # ne compose pas. Se présenter comme « l'assistant automatique de
        # Entreprise » sonnerait comme une arnaque — l'effet exact que l'annonce
        # (US-2) doit produire à l'envers.
        self._verifier(reponse)
        return str(reponse.json()["annonce"])

    async def started(self) -> None:
        """Signale que la conversation commence — l'appel passe en `EN_COURS`."""
        reponse = await self._client.post(self._url("demarre"), headers=self._headers)
        self._verifier(reponse)

    async def aclose(self) -> None:
        await self._client.aclose()
