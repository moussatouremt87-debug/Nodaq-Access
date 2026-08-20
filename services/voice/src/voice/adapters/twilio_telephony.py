"""Composition d'appels par Twilio Media Streams (ticket 4.18, lot 6).

Implements `voice.core.interfaces.TelephonyProvider`.

**Pourquoi Media Streams et pas le trunk SIP.** Le trunk SIP configuré en
août (ADR 001) suppose un serveur de média entre l'opérateur et le worker.
Media Streams supprime cet étage : Twilio ouvre une WebSocket vers le worker et
y pousse du **G.711 µ-law 8 kHz en base64**, dans les deux sens — précisément le
format que toute la chaîne parle déjà, de la transcription à l'amorce. Ni pile
SIP, ni serveur de média, ni transcodage dans le chemin temps réel.

Le trunk reste configuré et documenté : il redeviendrait la voie d'accès le jour
où le produit voudrait de l'entrant ou du multi-partie, où un serveur de média
gagne son coût.

**Aucun SDK fournisseur.** HTTP simple sur `httpx`, comme l'adaptateur de
synthèse. Trois points d'API ne justifient pas une dépendance, sa cadence de
publication et sa surface — et le code reste lisible comme *exactement* ce qui
part sur le fil.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass

import httpx

from voice.core.interfaces import CallOutcome, CallSession

API = "https://api.twilio.com/2010-04-01"

#: Le TwiML qui branche l'audio de l'appel sur notre WebSocket.
#:
#: `<Connect>` et NON `<Start>` : le premier est bidirectionnel — on peut
#: renvoyer de la voix — là où le second ne fait qu'écouter. Avec `<Connect>`,
#: Twilio n'exécute aucune instruction suivante tant que la WebSocket est
#: ouverte : l'appel VIT dans cette connexion.
TWIML = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    "<Response><Connect><Stream url=\"{url}\"/></Connect></Response>"
)

#: Ce que l'opérateur sait dire de la fin d'une tentative.
#:
#: `voicemail` n'y figure pas, et c'est une limite honnête : distinguer un
#: répondeur d'un humain demande la détection de messagerie de Twilio, qui est
#: une option facturée à part. Sans elle, un répondeur se présente comme un
#: décroché — le pilote s'en apercevra au contenu, pas au transport.
STATUTS = {
    "in-progress": CallOutcome.ANSWERED,
    "completed": CallOutcome.ANSWERED,
    "busy": CallOutcome.BUSY,
    "no-answer": CallOutcome.NO_ANSWER,
    "failed": CallOutcome.FAILED,
    "canceled": CallOutcome.FAILED,
}

#: Statuts où l'appel n'a pas encore abouti — on attend.
EN_COURS = ("queued", "initiated", "ringing")


class TwilioConfigError(RuntimeError):
    """Configuration absente. Ne porte jamais la valeur d'un secret."""


@dataclass(frozen=True, slots=True)
class TwilioConfig:
    account_sid: str
    auth_token: str
    #: L'adresse `wss://` que Twilio appellera pour l'audio.
    stream_url: str
    base_url: str = API

    @staticmethod
    def from_env() -> TwilioConfig:
        sid = os.environ.get("TELEPHONY_ACCOUNT_SID", "")
        token = os.environ.get("TELEPHONY_AUTH_TOKEN", "")
        flux = os.environ.get("TELEPHONY_STREAM_URL", "")
        if not sid:
            raise TwilioConfigError("TELEPHONY_ACCOUNT_SID is not set")
        if not token:
            raise TwilioConfigError("TELEPHONY_AUTH_TOKEN is not set")
        if not flux:
            raise TwilioConfigError("TELEPHONY_STREAM_URL is not set")
        if not flux.startswith("wss://"):
            # `https://` serait accepté par Twilio puis échouerait à
            # l'ouverture, en pleine tentative d'appel. On refuse au démarrage.
            raise TwilioConfigError("TELEPHONY_STREAM_URL doit commencer par wss://")
        return TwilioConfig(
            account_sid=sid,
            auth_token=token,
            stream_url=flux,
            base_url=os.environ.get("TELEPHONY_BASE_URL") or API,
        )


class TwilioTelephony:
    """Compose et raccroche. Ne sait rien des factures ni des mandats."""

    def __init__(
        self,
        config: TwilioConfig,
        client: httpx.AsyncClient | None = None,
        *,
        attente_max_s: float = 60.0,
        pas_s: float = 0.5,
    ) -> None:
        self._config = config
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=3.0)
        )
        self._attente_max_s = attente_max_s
        self._pas_s = pas_s

    @property
    def _auth(self) -> tuple[str, str]:
        return (self._config.account_sid, self._config.auth_token)

    def _url(self, chemin: str) -> str:
        return f"{self._config.base_url}/Accounts/{self._config.account_sid}/{chemin}"

    def _verifier(self, reponse: httpx.Response) -> None:
        if reponse.status_code >= 400:
            # Le corps de Twilio peut reprendre le NUMÉRO appelé, qui est une
            # donnée personnelle. Seul le code remonte (règle 6).
            raise RuntimeError(f"Twilio a refusé la requête (HTTP {reponse.status_code})")

    async def dial(self, number_e164: str, *, caller_id: str) -> CallSession:
        """Compose, puis attend de savoir si ça a décroché.

        Twilio rend la main dès la mise en file — bien avant que le téléphone
        sonne. Rendre `CallSession` à cet instant ferait passer une mise en file
        pour un décroché, et le pilote parlerait dans le vide. On interroge donc
        le statut jusqu'à ce qu'il quitte la file d'attente.
        """
        reponse = await self._client.post(
            self._url("Calls.json"),
            auth=self._auth,
            data={
                "To": number_e164,
                "From": caller_id,
                "Twiml": TWIML.format(url=self._config.stream_url),
            },
        )
        self._verifier(reponse)
        call_sid = str(reponse.json()["sid"])

        echeance = asyncio.get_running_loop().time() + self._attente_max_s
        while True:
            statut = await self.statut(call_sid)
            if statut not in EN_COURS:
                return CallSession(id=call_sid, outcome=STATUTS.get(statut, CallOutcome.FAILED))
            if asyncio.get_running_loop().time() >= echeance:
                # Ni décroché ni rejeté dans le délai : on ne laisse pas une
                # tentative ouverte indéfiniment, elle serait facturée et
                # invisible.
                await self.hang_up(call_sid)
                return CallSession(id=call_sid, outcome=CallOutcome.NO_ANSWER)
            await asyncio.sleep(self._pas_s)

    async def statut(self, call_id: str) -> str:
        reponse = await self._client.get(self._url(f"Calls/{call_id}.json"), auth=self._auth)
        self._verifier(reponse)
        return str(reponse.json()["status"])

    async def hang_up(self, call_id: str) -> None:
        reponse = await self._client.post(
            self._url(f"Calls/{call_id}.json"), auth=self._auth, data={"Status": "completed"}
        )
        self._verifier(reponse)

    async def aclose(self) -> None:
        await self._client.aclose()
