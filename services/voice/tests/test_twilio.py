"""Twilio : composition et session média — sans réseau ni ligne téléphonique.

Ce que ces tests protègent :

  a. COMPOSER NE VAUT PAS DÉCROCHER — Twilio rend la main dès la mise en file,
     bien avant que le téléphone sonne. Prendre ça pour un décroché ferait
     parler l'agent dans le vide ;
  b. l'audio renvoyé est DÉCOUPÉ en trames de 20 ms, sinon l'interruption de
     parole devient impossible ;
  c. seule la piste du débiteur est transcrite — pas notre propre écho ;
  d. rien de la conversation ni du numéro appelé ne fuit dans une erreur.
"""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator

import httpx
import pytest

from voice.adapters.twilio_media import OCTETS_PAR_TRAME, SessionMedia
from voice.adapters.twilio_telephony import (
    TwilioConfig,
    TwilioConfigError,
    TwilioTelephony,
)
from voice.core.interfaces import CallOutcome


def config() -> TwilioConfig:
    return TwilioConfig(
        account_sid="AC-test",
        auth_token="jeton-de-test",
        stream_url="wss://exemple.test/audio",
        base_url="https://api.twilio.test/2010-04-01",
    )


def transport(
    statuts: list[str], *, code_creation: int = 201
) -> tuple[list[httpx.Request], httpx.AsyncClient]:
    """Répond à la création puis déroule les statuts demandés, dans l'ordre."""
    vues: list[httpx.Request] = []
    restants = list(statuts)

    def handler(request: httpx.Request) -> httpx.Response:
        vues.append(request)
        if request.method == "POST" and request.url.path.endswith("Calls.json"):
            if code_creation >= 400:
                return httpx.Response(code_creation, json={"message": "vers +33612345678"})
            return httpx.Response(code_creation, json={"sid": "CA-1", "status": "queued"})
        if request.method == "GET":
            return httpx.Response(200, json={"sid": "CA-1", "status": restants.pop(0)})
        return httpx.Response(200, json={"sid": "CA-1", "status": "completed"})

    return vues, httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ── a. Composer ne vaut pas décrocher ──────────────────────────────────────


async def test_on_attend_le_decroche_avant_de_rendre_la_main() -> None:
    """Le défaut que ce test empêche : parler dans le vide.

    Twilio répond « queued » immédiatement. Un adaptateur qui rendrait
    `ANSWERED` à cet instant ferait démarrer l'annonce alors que le téléphone
    n'a pas encore sonné.
    """
    vues, client = transport(["ringing", "ringing", "in-progress"])
    tel = TwilioTelephony(config(), client=client, pas_s=0)

    session = await tel.dial("+33612345678", caller_id="+16617658816")

    assert session.outcome is CallOutcome.ANSWERED
    assert session.id == "CA-1"
    # Une création, puis trois interrogations de statut.
    assert len([v for v in vues if v.method == "GET"]) == 3


@pytest.mark.parametrize(
    ("statut", "attendu"),
    [
        ("busy", CallOutcome.BUSY),
        ("no-answer", CallOutcome.NO_ANSWER),
        ("failed", CallOutcome.FAILED),
        ("canceled", CallOutcome.FAILED),
    ],
)
async def test_les_issues_de_transport_sont_traduites(
    statut: str, attendu: CallOutcome
) -> None:
    _, client = transport([statut])
    tel = TwilioTelephony(config(), client=client, pas_s=0)
    session = await tel.dial("+33612345678", caller_id="+16617658816")
    assert session.outcome is attendu


async def test_une_sonnerie_sans_fin_est_raccrochee() -> None:
    # Sans échéance, une tentative resterait ouverte indéfiniment : facturée,
    # et invisible au cockpit.
    vues, client = transport(["ringing"] * 50)
    tel = TwilioTelephony(config(), client=client, pas_s=0, attente_max_s=0)

    session = await tel.dial("+33612345678", caller_id="+16617658816")

    assert session.outcome is CallOutcome.NO_ANSWER
    raccroches = [v for v in vues if v.method == "POST" and v.url.path.endswith("CA-1.json")]
    assert raccroches, "la tentative a été abandonnée sans raccrocher"


async def test_le_twiml_branche_un_flux_bidirectionnel() -> None:
    # `<Start>` n'écoute que dans un sens : l'agent ne pourrait jamais répondre.
    vues, client = transport(["in-progress"])
    tel = TwilioTelephony(config(), client=client, pas_s=0)

    await tel.dial("+33612345678", caller_id="+16617658816")

    corps = vues[0].content.decode()
    assert "%3CConnect%3E" in corps or "<Connect>" in corps
    assert "Start" not in corps


# ── b. Ce qui repart vers l'appel ──────────────────────────────────────────


class FausseWs:
    """Note ce qu'on lui envoie ; joue un script à la lecture."""

    def __init__(self, script: list[dict[str, object]] | None = None) -> None:
        self.envoyes: list[dict[str, object]] = []
        self._script = script or []

    async def send(self, brut: str) -> None:
        self.envoyes.append(json.loads(brut))

    async def _lire(self) -> AsyncIterator[str]:
        for e in self._script:
            yield json.dumps(e)

    def __aiter__(self) -> AsyncIterator[str]:
        return self._lire()


async def flux(*morceaux: bytes) -> AsyncIterator[bytes]:
    for m in morceaux:
        yield m


async def test_l_audio_sortant_est_decoupe_en_trames_de_20_ms() -> None:
    """Sans découpage, l'interruption devient impossible.

    Une grosse trame arrive entière dans la file de Twilio ; un `clear`
    ultérieur n'a plus rien à couper, et l'agent termine sa phrase par-dessus
    la personne.
    """
    ws = FausseWs()
    session = SessionMedia(ws=ws)  # type: ignore[arg-type]
    session.stream_sid = "MZ-1"
    session._pret.set()

    await session.play(flux(b"\x00" * (OCTETS_PAR_TRAME * 3)))

    trames = [e for e in ws.envoyes if e.get("event") == "media"]
    assert len(trames) == 3
    for t in trames:
        charge = base64.b64decode(t["media"]["payload"])  # type: ignore[index]
        assert len(charge) == OCTETS_PAR_TRAME
        assert t["streamSid"] == "MZ-1"


async def test_un_reste_partiel_est_quand_meme_envoye() -> None:
    ws = FausseWs()
    session = SessionMedia(ws=ws)  # type: ignore[arg-type]
    session.stream_sid = "MZ-1"
    session._pret.set()

    await session.play(flux(b"\x00" * (OCTETS_PAR_TRAME + 40)))

    trames = [e for e in ws.envoyes if e.get("event") == "media"]
    assert len(trames) == 2
    assert len(base64.b64decode(trames[1]["media"]["payload"])) == 40  # type: ignore[index]


async def test_couper_vide_la_file_de_twilio() -> None:
    # Cesser d'envoyer ne suffit pas : ce qui est déjà transmis serait joué.
    ws = FausseWs()
    session = SessionMedia(ws=ws)  # type: ignore[arg-type]
    session.stream_sid = "MZ-1"

    await session.cut()

    assert ws.envoyes == [{"event": "clear", "streamSid": "MZ-1"}]


# ── c. Ce qu'on écoute, et ce qu'on ignore ─────────────────────────────────


async def test_seule_la_piste_du_debiteur_est_transcrite() -> None:
    """`outbound` est notre propre voix, renvoyée en écho.

    La transcrire ferait entendre l'agent à l'agent : il se répondrait à
    lui-même, et le compteur d'insistances s'emballerait sur ses propres mots.
    """
    script: list[dict[str, object]] = [
        {"event": "start", "streamSid": "MZ-1", "start": {"callSid": "CA-1"}},
        {"event": "media", "media": {"track": "inbound",
                                     "payload": base64.b64encode(b"\x11" * 160).decode()}},
        {"event": "media", "media": {"track": "outbound",
                                     "payload": base64.b64encode(b"\x22" * 160).decode()}},
        {"event": "stop"},
    ]
    session = SessionMedia(ws=FausseWs(script))  # type: ignore[arg-type]

    # `run()` lit le transport et DÉPOSE l'audio ; `inbound_audio()` le draine.
    # Les deux sont séparés depuis l'interblocage du premier appel réel :
    # l'annonce attendait le `stream_sid`, que seule la boucle de transcription
    # allait lire — le téléphone sonnait et personne ne parlait.
    await session.run()
    recus = [m async for m in session.inbound_audio()]

    assert recus == [b"\x11" * 160]
    assert session.call_sid == "CA-1"
    assert session.stream_sid == "MZ-1"


async def test_parler_ne_depend_pas_de_qui_ecoute() -> None:
    """L'interblocage du premier appel réel, gardé.

    Pour parler, la session doit connaître le `stream_sid`, qui n'arrive que
    dans l'événement `start`. Tant que cet événement n'était lu que par la
    boucle de transcription, l'agent attendait un identifiant que personne
    n'allait chercher : le téléphone sonnait, on décrochait, et rien ne se
    passait.

    Ici PERSONNE ne consomme `inbound_audio()` — et l'agent doit quand même
    pouvoir prononcer son annonce.
    """
    script: list[dict[str, object]] = [
        {"event": "start", "streamSid": "MZ-9", "start": {"callSid": "CA-9"}},
        {"event": "media", "media": {"track": "inbound",
                                     "payload": base64.b64encode(b"\x33" * 160).decode()}},
    ]
    ws = FausseWs(script)
    session = SessionMedia(ws=ws)  # type: ignore[arg-type]

    lecture = asyncio.create_task(session.run())
    await asyncio.wait_for(session.await_start(), timeout=1)
    await asyncio.wait_for(session.play(flux(b"\x00" * OCTETS_PAR_TRAME)), timeout=1)

    assert session.stream_sid == "MZ-9"
    assert [e for e in ws.envoyes if e.get("event") == "media"], "l'agent n'a pas pu parler"
    lecture.cancel()


async def test_jouer_attend_de_connaitre_le_flux() -> None:
    # `streamSid` n'est connu qu'après l'événement `start`. Envoyer avant
    # produirait des trames avec un identifiant vide, silencieusement ignorées.
    ws = FausseWs()
    session = SessionMedia(ws=ws)  # type: ignore[arg-type]

    tache = asyncio.create_task(session.play(flux(b"\x00" * OCTETS_PAR_TRAME)))
    await asyncio.sleep(0.02)
    assert ws.envoyes == [], "l'audio est parti avant de connaître le flux"

    session.stream_sid = "MZ-1"
    session._pret.set()
    await tache
    assert len(ws.envoyes) == 1


# ── d. Les échecs ne racontent rien ────────────────────────────────────────


async def test_une_erreur_ne_reprend_pas_le_numero_appele() -> None:
    # Le corps d'erreur de Twilio cite le numéro composé, qui est une donnée
    # personnelle. Règle 6 : jamais dans un journal, exception comprise.
    _, client = transport([], code_creation=400)
    tel = TwilioTelephony(config(), client=client, pas_s=0)

    with pytest.raises(RuntimeError) as err:
        await tel.dial("+33612345678", caller_id="+16617658816")

    assert "400" in str(err.value)
    assert "33612345678" not in str(err.value)


# ── e. La configuration refuse de deviner ──────────────────────────────────


def test_une_url_de_flux_non_wss_est_refusee(monkeypatch: pytest.MonkeyPatch) -> None:
    # `https://` serait accepté par Twilio puis échouerait à l'ouverture, en
    # pleine tentative d'appel. On refuse au démarrage.
    monkeypatch.setenv("TELEPHONY_ACCOUNT_SID", "AC-x")
    monkeypatch.setenv("TELEPHONY_AUTH_TOKEN", "t")
    monkeypatch.setenv("TELEPHONY_STREAM_URL", "https://exemple.test/audio")
    with pytest.raises(TwilioConfigError, match="wss://"):
        TwilioConfig.from_env()


def test_les_variables_absentes_levent(monkeypatch: pytest.MonkeyPatch) -> None:
    for absente in ("TELEPHONY_ACCOUNT_SID", "TELEPHONY_AUTH_TOKEN", "TELEPHONY_STREAM_URL"):
        monkeypatch.setenv("TELEPHONY_ACCOUNT_SID", "AC-x")
        monkeypatch.setenv("TELEPHONY_AUTH_TOKEN", "t")
        monkeypatch.setenv("TELEPHONY_STREAM_URL", "wss://exemple.test/audio")
        monkeypatch.delenv(absente)
        with pytest.raises(TwilioConfigError, match=absente):
            TwilioConfig.from_env()


def test_l_erreur_de_config_ne_contient_jamais_le_jeton(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TELEPHONY_ACCOUNT_SID", "AC-x")
    monkeypatch.setenv("TELEPHONY_AUTH_TOKEN", "jeton-tres-secret")
    monkeypatch.delenv("TELEPHONY_STREAM_URL", raising=False)
    with pytest.raises(TwilioConfigError) as err:
        TwilioConfig.from_env()
    assert "jeton-tres-secret" not in str(err.value)
