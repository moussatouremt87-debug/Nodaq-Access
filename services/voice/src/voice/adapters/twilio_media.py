"""La session média d'un appel Twilio (ticket 4.18, lot 6).

Twilio ouvre une WebSocket vers le worker dès que l'appel décroche, et y pousse
l'audio du débiteur en **G.711 µ-law 8 kHz, base64**. On y renvoie la voix de
l'agent dans le même format. C'est le puits audio réel que les lots précédents
laissaient en attente — jusqu'ici l'amorce et la synthèse parcouraient leurs
octets sans destination.

── L'interruption de parole ──────────────────────────────────────────────────
C'était le seul avantage sérieux d'un serveur de média, et il tient en un
message : `clear` vide la file d'attente audio côté Twilio. Sans lui, l'agent
finirait sa phrase pendant que la personne parle — le comportement qui rend un
appel automatisé insupportable, et que le ticket liste comme non négociable.

`mark` sert de repère : Twilio le renvoie quand l'audio qui le précède a été
JOUÉ, pas seulement transmis. C'est la seule façon de savoir où en est
réellement la parole de l'agent, la file pouvant avoir plusieurs secondes
d'avance sur ce que le débiteur entend.

── Ce qui n'entre jamais dans un journal ─────────────────────────────────────
Les trames audio, le numéro appelé, le `callSid` rapproché d'un débiteur. La
règle 6 vaut ici plus qu'ailleurs : ce flux EST la conversation.
"""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import websockets

#: 20 ms de son en µ-law 8 kHz. Twilio émet à cette cadence ; on renvoie de
#: même, sans quoi la file d'attente se remplit plus vite qu'elle ne se vide et
#: l'interruption arrive trop tard pour servir.
OCTETS_PAR_TRAME = 160


@dataclass
class SessionMedia:
    """Une conversation en cours, vue du transport.

    `stream_sid` est exigé par Twilio sur tout ce qu'on lui renvoie. Il n'est
    connu qu'après l'événement `start` — d'où l'attente explicite plutôt qu'une
    valeur vide qui échouerait silencieusement au premier envoi.
    """

    ws: websockets.ServerConnection
    stream_sid: str = ""
    call_sid: str = ""
    _pret: asyncio.Event = field(default_factory=asyncio.Event)

    async def await_start(self) -> None:
        await self._pret.wait()

    # ── Ce qui arrive du débiteur ─────────────────────────────────────────

    async def inbound_audio(self) -> AsyncIterator[bytes]:
        """Les trames du débiteur, prêtes pour la transcription.

        Seule la piste `inbound` est rendue : `outbound` est notre propre voix
        renvoyée en écho. La transcrire ferait entendre l'agent à l'agent, qui
        se répondrait à lui-même.
        """
        async for brut in self.ws:
            e = json.loads(brut)
            evenement = e.get("event")

            if evenement == "start":
                depart = e.get("start", {})
                self.stream_sid = str(e.get("streamSid", ""))
                self.call_sid = str(depart.get("callSid", ""))
                self._pret.set()
            elif evenement == "media":
                media = e.get("media", {})
                if media.get("track") == "outbound":
                    continue
                charge = media.get("payload")
                if charge:
                    yield base64.b64decode(charge)
            elif evenement == "stop":
                return

    # ── Ce qu'on renvoie ──────────────────────────────────────────────────

    async def play(self, audio: AsyncIterator[bytes]) -> None:
        """Envoie la voix de l'agent, par trames de 20 ms.

        Découpé plutôt que poussé d'un bloc : une seule grosse trame arriverait
        entière dans la file de Twilio, et un `clear` ultérieur ne pourrait plus
        rien couper — l'agent finirait sa phrase par-dessus la personne.
        """
        await self.await_start()
        reste = b""
        async for morceau in audio:
            reste += morceau
            while len(reste) >= OCTETS_PAR_TRAME:
                await self._envoyer_trame(reste[:OCTETS_PAR_TRAME])
                reste = reste[OCTETS_PAR_TRAME:]
        if reste:
            await self._envoyer_trame(reste)

    async def _envoyer_trame(self, trame: bytes) -> None:
        await self.ws.send(json.dumps({
            "event": "media",
            "streamSid": self.stream_sid,
            "media": {"payload": base64.b64encode(trame).decode()},
            # « Le payload ne doit pas contenir d'en-têtes de fichier audio » :
            # on envoie des échantillons bruts, jamais un WAV.
        }))

    async def cut(self) -> None:
        """Vide la file audio de Twilio — l'agent se tait immédiatement.

        Appelé quand le débiteur reprend la parole. Ce qui a déjà été transmis
        mais pas encore joué est jeté ; c'est exactement ce qu'on veut, et c'est
        impossible à obtenir en cessant simplement d'envoyer.
        """
        await self.ws.send(json.dumps({"event": "clear", "streamSid": self.stream_sid}))

    async def mark(self, nom: str) -> None:
        """Pose un repère que Twilio renverra quand l'audio aura été JOUÉ.

        La file peut avoir plusieurs secondes d'avance sur ce que le débiteur
        entend : sans repère, l'agent croirait avoir fini de parler alors que sa
        phrase commence à peine.
        """
        await self.ws.send(json.dumps({
            "event": "mark", "streamSid": self.stream_sid, "mark": {"name": nom},
        }))
