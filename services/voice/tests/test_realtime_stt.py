"""La transcription en continu — éprouvée sans réseau.

Un faux serveur WebSocket local joue le rôle du fournisseur : on inspecte ce que
l'adaptateur ENVOIE, et on lui fait rendre ce qu'un vrai renverrait. C'est le
pendant de `httpx.MockTransport` pour les adaptateurs HTTP.

Ce que ces tests protègent :
  a. le format téléphonique part tel quel, sans transcodage inutile ;
  b. l'audio est poussé SANS attendre les transcriptions — sinon la
     conversation avancerait au rythme du réseau ;
  c. `is_final` distingue un fragment d'un tour terminé : agir sur un fragment
     ferait parler l'agent par-dessus la personne ;
  d. rien de ce que dit le débiteur ne fuit dans un message d'erreur.
"""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator, Mapping, Sequence

import pytest
import websockets

from voice.adapters.realtime_stt import (
    FORMAT_TELEPHONE,
    MODELE_CONTINU,
    RealtimeSpeechToText,
    RealtimeSttConfig,
    RealtimeSttConfigError,
)


async def audio_de(*morceaux: bytes) -> AsyncIterator[bytes]:
    for m in morceaux:
        yield m
        await asyncio.sleep(0)


class FauxFournisseur:
    """Serveur WebSocket local. Enregistre ce qu'il reçoit, rend ce qu'on lui dit."""

    def __init__(self, evenements: Sequence[Mapping[str, object]]) -> None:
        self.evenements = evenements
        self.recus: list[Mapping[str, object]] = []
        self._serveur: websockets.Server | None = None

    async def __aenter__(self) -> FauxFournisseur:
        async def poignee(ws: websockets.ServerConnection) -> None:
            # La session arrive d'abord ; on la note puis on déroule le script.
            self.recus.append(json.loads(await ws.recv()))
            for e in self.evenements:
                await ws.send(json.dumps(e))
            # Puis on écoute brièvement et on FERME. Sans fermeture, la boucle
            # de lecture de l'adaptateur attend indéfiniment un événement qui
            # ne viendra plus — c'est ce qui bloquait la suite entière.
            try:
                while True:
                    brut = await asyncio.wait_for(ws.recv(), timeout=0.15)
                    self.recus.append(json.loads(brut))
            except (TimeoutError, websockets.ConnectionClosed):
                pass

        self._serveur = await websockets.serve(poignee, "127.0.0.1", 0)
        return self

    async def __aexit__(self, *_: object) -> None:
        if self._serveur:
            self._serveur.close()
            await self._serveur.wait_closed()

    @property
    def url(self) -> str:
        assert self._serveur
        port = self._serveur.sockets[0].getsockname()[1]
        return f"ws://127.0.0.1:{port}"

    def config(self) -> RealtimeSttConfig:
        return RealtimeSttConfig(api_key="cle-de-test", url=self.url)


# ── a. Ce qui part sur le fil ──────────────────────────────────────────────


async def test_le_format_telephonique_part_tel_quel() -> None:
    """µ-law 8 kHz, sans transcodage.

    Convertir en PCM 24 kHz pour « améliorer » l'entrée n'ajouterait pas
    l'information que le réseau a déjà perdue — seulement une conversion dans le
    chemin temps réel.
    """
    async with FauxFournisseur([]) as f:
        stt = RealtimeSpeechToText(f.config())
        async for _ in stt.transcribe(audio_de(b"\xff" * 160)):
            pass

    session = f.recus[0]["session"]
    assert session["audio"]["input"]["format"]["type"] == FORMAT_TELEPHONE  # type: ignore[index]
    assert session["audio"]["input"]["transcription"]["model"] == MODELE_CONTINU  # type: ignore[index]
    # Le modèle en flux continu refuse toute segmentation côté serveur.
    assert session["audio"]["input"]["turn_detection"] is None  # type: ignore[index]


async def test_l_audio_est_pousse_sans_attendre_les_transcriptions() -> None:
    # Attendre un résultat avant d'envoyer la trame suivante ferait avancer la
    # conversation au rythme du réseau, pas à celui de la personne qui parle.
    async with FauxFournisseur([]) as f:
        stt = RealtimeSpeechToText(f.config())
        async for _ in stt.transcribe(audio_de(b"\x01" * 160, b"\x02" * 160, b"\x03" * 160)):
            pass
        await asyncio.sleep(0.05)

    trames = [r for r in f.recus if r.get("type") == "input_audio_buffer.append"]
    assert len(trames) == 3
    assert base64.b64decode(trames[0]["audio"]) == b"\x01" * 160  # type: ignore[arg-type]


async def test_un_morceau_vide_n_est_pas_envoye() -> None:
    async with FauxFournisseur([]) as f:
        stt = RealtimeSpeechToText(f.config())
        async for _ in stt.transcribe(audio_de(b"", b"\x01" * 160, b"")):
            pass
        await asyncio.sleep(0.05)

    assert len([r for r in f.recus if r.get("type") == "input_audio_buffer.append"]) == 1


# ── b. Ce qui remonte ──────────────────────────────────────────────────────


async def test_les_fragments_et_le_tour_termine_sont_distingues() -> None:
    """`is_final` décide du tour de parole.

    Agir sur un fragment ferait répondre l'agent au milieu de la phrase du
    débiteur — le comportement qui rend un appel automatisé insupportable.
    """
    evenements = [
        {"type": "conversation.item.input_audio_transcription.delta", "delta": "Je peux pas"},
        {"type": "conversation.item.input_audio_transcription.delta", "delta": " tout payer"},
        {"type": "conversation.item.input_audio_transcription.completed",
         "transcript": "Je peux pas tout payer d'un coup."},
    ]
    async with FauxFournisseur(evenements) as f:
        stt = RealtimeSpeechToText(f.config())
        segments = [s async for s in stt.transcribe(audio_de(b"\xff" * 160))]

    assert [s.is_final for s in segments] == [False, False, True]
    assert segments[-1].text == "Je peux pas tout payer d'un coup."


async def test_un_fragment_vide_n_est_pas_remonte() -> None:
    evenements = [
        {"type": "conversation.item.input_audio_transcription.delta", "delta": ""},
        {"type": "conversation.item.input_audio_transcription.completed",
         "transcript": "Bonjour."},
    ]
    async with FauxFournisseur(evenements) as f:
        stt = RealtimeSpeechToText(f.config())
        segments = [s async for s in stt.transcribe(audio_de(b"\xff" * 160))]

    assert len(segments) == 1
    assert segments[0].is_final


# ── c. Les échecs ne racontent pas la conversation ─────────────────────────


async def test_une_erreur_ne_reprend_pas_ce_que_le_debiteur_a_dit() -> None:
    # Le corps d'erreur d'un fournisseur peut contenir un fragment d'audio
    # transcrit. Règle 6 : jamais dans un journal, message d'exception compris.
    evenements = [{
        "type": "error",
        "error": {"code": "audio_too_short", "message": "près de : je peux pas tout payer"},
    }]
    async with FauxFournisseur(evenements) as f:
        stt = RealtimeSpeechToText(f.config())
        with pytest.raises(RuntimeError) as err:
            async for _ in stt.transcribe(audio_de(b"\xff" * 160)):
                pass

    assert "audio_too_short" in str(err.value)
    assert "payer" not in str(err.value)


# ── d. La configuration refuse de deviner ──────────────────────────────────


def test_une_cle_absente_leve(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VOICE_STT_API_KEY", raising=False)
    with pytest.raises(RealtimeSttConfigError, match="VOICE_STT_API_KEY"):
        RealtimeSttConfig.from_env()


def test_l_erreur_de_config_ne_contient_jamais_la_cle(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICE_STT_API_KEY", "cle-tres-secrete")
    monkeypatch.setenv("VOICE_STT_MODEL", "")
    # Rien ne doit lever ici, mais si un jour c'est le cas, pas de fuite.
    assert RealtimeSttConfig.from_env().model == MODELE_CONTINU


def test_une_variable_presente_mais_vide_retombe_sur_le_defaut(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # L'état le plus courant d'un `.env` recopié : présente et vide. Le défaut
    # de `get` rendrait "" et demanderait un modèle sans nom.
    monkeypatch.setenv("VOICE_STT_API_KEY", "x")
    monkeypatch.setenv("VOICE_STT_MODEL", "")
    assert RealtimeSttConfig.from_env().model == MODELE_CONTINU
