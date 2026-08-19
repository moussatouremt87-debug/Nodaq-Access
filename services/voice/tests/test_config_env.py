"""Le chargement du `.env` des points d'entrée.

Ce que ces tests protègent :
  a. l'environnement réel l'emporte TOUJOURS — sinon un déploiement qui pose
     ses variables autrement se ferait écraser par un fichier de développement ;
  b. la prose non commentée qui suit une valeur n'entre PAS dans la valeur : un
     jeton suivi d'un commentaire partirait tel quel chez un fournisseur.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from voice.config_env import charger_env


def test_l_environnement_reel_l_emporte(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".env").write_text("DEJA_POSEE=du-fichier\n", encoding="utf-8")
    monkeypatch.setenv("DEJA_POSEE", "de-l-environnement")

    charger_env(tmp_path / "faux.py")

    assert os.environ["DEJA_POSEE"] == "de-l-environnement"


def test_la_prose_qui_suit_une_valeur_n_y_entre_pas(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Cas réel : un `.env` où le commentaire a perdu son dièse. Le shell exécute
    # la prose comme une commande ; un découpage naïf la collerait dans la clé.
    (tmp_path / ".env").write_text(
        "UN_JETON=sk-secret — commentaire oublié sans dièse\n", encoding="utf-8"
    )
    monkeypatch.delenv("UN_JETON", raising=False)

    charger_env(tmp_path / "faux.py")

    assert os.environ["UN_JETON"] == "sk-secret"


def test_les_guillemets_preservent_les_espaces(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".env").write_text('AVEC_ESPACES="deux mots"\n', encoding="utf-8")
    monkeypatch.delenv("AVEC_ESPACES", raising=False)

    charger_env(tmp_path / "faux.py")

    assert os.environ["AVEC_ESPACES"] == "deux mots"


def test_les_commentaires_et_lignes_vides_sont_ignores(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".env").write_text("# UN_COMMENTE=non\n\nUNE_VRAIE=oui\n", encoding="utf-8")
    monkeypatch.delenv("UN_COMMENTE", raising=False)
    monkeypatch.delenv("UNE_VRAIE", raising=False)

    charger_env(tmp_path / "faux.py")

    assert "UN_COMMENTE" not in os.environ
    assert os.environ["UNE_VRAIE"] == "oui"


def test_aucun_fichier_ne_fait_pas_echouer(tmp_path: Path) -> None:
    # Un déploiement sans `.env` est le cas NORMAL en production.
    assert charger_env(tmp_path / "vide" / "faux.py") is None or True
