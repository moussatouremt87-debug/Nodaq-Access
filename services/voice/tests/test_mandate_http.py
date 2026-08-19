"""La passerelle de mandat vue du worker — sans toucher au réseau.

Ce qui compte ici tient en une phrase : **rien de ce que ce module envoie ne
nomme un tenant, et rien de ce qu'il reçoit ne contient le motif d'un refus.**
Le premier point rend la règle 1 structurelle ; le second empêche qu'une
configuration interne soit prononcée à un débiteur.
"""

from __future__ import annotations

import json

import httpx
import pytest

from voice.adapters.mandate_http import (
    HttpMandateGateway,
    MandateConfig,
    MandateConfigError,
)


def capture(
    reponses: dict[str, tuple[int, object]],
) -> tuple[list[httpx.Request], httpx.AsyncClient]:
    vues: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        vues.append(request)
        for fragment, (code, corps) in reponses.items():
            if fragment in request.url.path:
                return httpx.Response(code, json=corps)
        return httpx.Response(404, json={})

    return vues, httpx.AsyncClient(transport=httpx.MockTransport(handler))


def config() -> MandateConfig:
    return MandateConfig(base_url="https://api.test.nodaq", call_token="jeton-de-cet-appel")


# ── Aucun tenant ne traverse ───────────────────────────────────────────────


async def test_no_tenant_is_ever_sent() -> None:
    """La garde qui justifie tout le dispositif.

    Le serveur lit le tenant depuis la ligne que le jeton désigne. Si ce module
    en envoyait un, il redeviendrait possible d'en forger un — et le choix d'un
    jeton par appel plutôt que d'un jeton de service perdrait sa raison d'être.
    """
    vues, client = capture(
        {
            "insistance": (200, {"autorise": True, "plafond": 2}),
            "echelonnement": (200, {"accorde": False}),
            "ouverture": (200, {"annonce": "Bonjour !"}),
        }
    )
    passerelle = HttpMandateGateway(config(), client=client)

    await passerelle.may_nudge(0)
    await passerelle.decide_instalment(
        instalments=3, first_payment_in_days=10, last_payment_late_days=25
    )
    await passerelle.opening_line()

    for requete in vues:
        entier = (str(requete.url) + requete.content.decode()).lower()
        for interdit in ("tenant", "campagne", "campaign"):
            assert interdit not in entier, f"« {interdit} » traverse la frontière"


async def test_the_token_travels_as_a_header_never_in_the_url() -> None:
    vues, client = capture({"insistance": (200, {"autorise": True, "plafond": 2})})
    passerelle = HttpMandateGateway(config(), client=client)

    await passerelle.may_nudge(1)

    assert vues[0].headers["authorization"] == "Bearer jeton-de-cet-appel"
    # Un jeton en chaîne de requête finit dans tous les journaux de la chaîne.
    assert "jeton-de-cet-appel" not in str(vues[0].url)


# ── Ce que le worker fait des réponses ─────────────────────────────────────


async def test_a_granted_instalment_carries_what_the_core_allowed() -> None:
    # Ce que le noyau a ACCORDÉ, jamais ce que le débiteur a demandé : il a
    # demandé 6 fois, la réponse en autorise 3.
    _, client = capture(
        {
            "echelonnement": (
                200,
                {"accorde": True, "versements": 3, "premierVersementDansJours": 10},
            )
        }
    )
    passerelle = HttpMandateGateway(config(), client=client)

    decision = await passerelle.decide_instalment(
        instalments=6, first_payment_in_days=45, last_payment_late_days=200
    )

    assert decision.granted
    assert decision.instalments == 3
    assert decision.first_payment_in_days == 10


async def test_a_refusal_carries_no_reason() -> None:
    """Le serveur ne rend pas le motif, et ce module n'en invente pas.

    Un motif remonté ici finirait dans les faits transmis au modèle, qui
    pourrait le prononcer : « mon patron a désactivé ça pour votre campagne »
    expose un réglage interne et invite à une discussion que l'agent n'a pas le
    droit d'avoir.
    """
    _, client = capture({"echelonnement": (200, {"accorde": False})})
    passerelle = HttpMandateGateway(config(), client=client)

    decision = await passerelle.decide_instalment(
        instalments=6, first_payment_in_days=45, last_payment_late_days=200
    )

    assert decision.granted is False
    assert decision.instalments == 0
    assert decision.first_payment_in_days == 0


async def test_the_nudge_quota_comes_from_the_server() -> None:
    # Jamais d'un compteur local comparé à une constante recopiée : c'est tout
    # l'intérêt de ne pas dupliquer la règle dans ce runtime.
    vues, client = capture({"insistance": (200, {"autorise": False, "plafond": 2})})
    passerelle = HttpMandateGateway(config(), client=client)

    assert await passerelle.may_nudge(2) is False
    assert vues[0].url.params["faites"] == "2"


async def test_the_opening_line_is_used_verbatim() -> None:
    # US-2 : elle vient du noyau, mot pour mot. Ce module ne la retouche pas.
    annonce = "Bonjour ! Je suis l'assistant automatique de Charpente Dubois."
    _, client = capture({"ouverture": (200, {"annonce": annonce})})
    passerelle = HttpMandateGateway(config(), client=client)

    assert await passerelle.opening_line() == annonce


async def test_a_missing_company_name_stops_the_call() -> None:
    # 409 : sans raison sociale, l'agent ne peut pas s'annoncer. On ne compose
    # pas plutôt que de se présenter comme « l'assistant automatique de
    # Entreprise », ce qui sonne comme une arnaque.
    _, client = capture({"ouverture": (409, {"error": "La raison sociale…"})})
    passerelle = HttpMandateGateway(config(), client=client)

    with pytest.raises(RuntimeError, match="409"):
        await passerelle.opening_line()


# ── Les échecs ne fuient rien ──────────────────────────────────────────────


async def test_an_error_never_echoes_the_body() -> None:
    # Un corps d'erreur peut contenir un montant ou un détail de décision.
    # Règle 6 — jamais dans un journal, y compris via un message d'exception.
    _, client = capture({"echelonnement": (500, {"error": "montant 1200 € refusé"})})
    passerelle = HttpMandateGateway(config(), client=client)

    with pytest.raises(RuntimeError) as err:
        await passerelle.decide_instalment(
            instalments=3, first_payment_in_days=10, last_payment_late_days=25
        )

    assert "500" in str(err.value)
    assert "1200" not in str(err.value)


async def test_an_expired_token_is_an_error_not_a_silent_default() -> None:
    # 401 = l'appel est clos, ou le jeton révoqué. Rendre « pas d'insistance »
    # en silence ferait passer une panne d'authentification pour une décision
    # métier.
    _, client = capture({"insistance": (401, {"error": "Jeton invalide"})})
    passerelle = HttpMandateGateway(config(), client=client)

    with pytest.raises(RuntimeError, match="401"):
        await passerelle.may_nudge(0)


# ── La configuration refuse de deviner ─────────────────────────────────────


def test_missing_url_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VOICE_DECISION_API_URL", raising=False)
    with pytest.raises(MandateConfigError, match="VOICE_DECISION_API_URL"):
        MandateConfig.from_env("un-jeton")


def test_an_empty_token_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    # Un jeton vide produirait un en-tête `Bearer ` et un 401 au premier appel,
    # au téléphone. On échoue au démarrage.
    monkeypatch.setenv("VOICE_DECISION_API_URL", "https://api.test.nodaq")
    with pytest.raises(MandateConfigError):
        MandateConfig.from_env("")


def test_config_error_never_contains_the_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VOICE_DECISION_API_URL", raising=False)
    with pytest.raises(MandateConfigError) as err:
        MandateConfig.from_env("jeton-tres-secret")
    assert "jeton-tres-secret" not in str(err.value)


async def test_the_wire_shape_matches_the_server_schema() -> None:
    # Les clés voyagent en FRANÇAIS, comme le schéma Zod les attend. Un renommage
    # d'un côté est un 400 pendant un appel réel.
    vues, client = capture({"echelonnement": (200, {"accorde": False})})
    passerelle = HttpMandateGateway(config(), client=client)

    await passerelle.decide_instalment(
        instalments=3, first_payment_in_days=10, last_payment_late_days=25
    )

    assert json.loads(vues[0].content) == {
        "versements": 3,
        "premierVersementDansJours": 10,
        "dernierVersementRetardJours": 25,
    }
