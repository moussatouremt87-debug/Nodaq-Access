"""Chargement du `.env` pour les points d'entrée de développement.

`uv run python -m voice.appel` ne charge rien : le worker mourait donc sur
« TELEPHONY_ACCOUNT_SID is not set » tant qu'on oubliait de préfixer la commande.
Trois fois de suite, à chaque essai d'appel.

── Ce que ce module NE fait pas ───────────────────────────────────────────
Il n'écrase jamais une variable déjà présente dans l'environnement. Un
déploiement qui pose ses variables autrement garde la main, et le fichier ne
sert que de repli — c'est ce qui permet de le charger sans transformer la
configuration de production en devinette.

── Pourquoi ne pas simplement sourcer le fichier ──────────────────────────
Parce qu'un `.env` réel contient des affectations suivies de prose non
commentée. Le shell les gère en exécutant la prose comme une commande, qui
échoue sans effet ; un découpage naïf sur le premier « = » collerait cette
prose DANS la valeur, et l'on enverrait un jeton suivi d'un commentaire à un
fournisseur. On reproduit donc la règle du shell : la valeur s'arrête au
premier blanc, sauf si elle est entre guillemets.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

_AFFECTATION = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def _valeur(brut: str) -> str:
    brut = brut.strip()
    if not brut:
        return ""
    if brut[0] in "\"'":
        fermeture = brut.find(brut[0], 1)
        return brut[1:fermeture] if fermeture > 0 else brut[1:]
    # Comme le shell : tout ce qui suit un blanc est une autre commande, pas la
    # suite de la valeur.
    return brut.split()[0]


def charger_env(depart: Path | None = None) -> Path | None:
    """Pose les variables manquantes depuis le premier `.env` trouvé en remontant.

    Rend le chemin du fichier utilisé, ou `None` si aucun n'a été trouvé.
    """
    dossier = (depart or Path(__file__).resolve()).parent
    for candidat in [dossier, *dossier.parents]:
        fichier = candidat / ".env"
        if not fichier.is_file():
            continue
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            if ligne.lstrip().startswith("#"):
                continue
            trouve = _AFFECTATION.match(ligne)
            if not trouve:
                continue
            cle = trouve.group(1)
            # L'environnement réel l'emporte TOUJOURS.
            if cle not in os.environ:
                os.environ[cle] = _valeur(trouve.group(2))
        return fichier
    return None
