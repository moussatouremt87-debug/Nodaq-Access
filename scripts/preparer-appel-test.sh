#!/usr/bin/env bash
#
# Monte le décor minimal d'un appel supervisé et rend son jeton.
#
#   ./scripts/preparer-appel-test.sh +971XXXXXXXXX            (jeton seulement)
#   ./scripts/preparer-appel-test.sh +971XXXXXXXXX --appeler   (et on appelle)
#
# Ce que ça crée : un tenant jetable, sa règle de relance, sa raison sociale,
# une campagne d'un appel, la validation de cette campagne, puis l'appel
# planifié. Le jeton n'est rendu qu'une fois — le perdre oblige à replanifier.
#
# ── Pourquoi passer par les VRAIES routes ──────────────────────────────────
# On pourrait écrire directement en base et gagner trente lignes. Ce serait un
# décor qui ne prouve rien : le jour où une route change, le script continuerait
# de « marcher » en fabriquant un état que le produit ne sait plus produire.
# Ici, si la validation d'une campagne se casse, ce script se casse avec elle.
#
# La SEULE exception est la double authentification, marquée en base : franchir
# un TOTP depuis un script demanderait de reproduire la génération de codes, ce
# qui n'apprendrait rien sur l'agent vocal.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NUMERO="${1:-}"
APPELER="${2:-}"
if [ -z "$NUMERO" ]; then
  echo "usage : $0 +NUMERO_E164" >&2
  exit 2
fi

# Chargé par le SHELL, comme le fait l'application — et non par un analyseur
# maison. Le `.env` contient des affectations suivies de texte non commenté :
# le shell les traite correctement (la prose devient une commande introuvable,
# sans effet), là où découper naïvement sur le premier « = » collerait cette
# prose dans la valeur.
#
# `set +e` le temps du chargement : sans lui, la première prose tue le script.
set +e
set -a
# shellcheck disable=SC1091
. "$RACINE/.env" 2>/dev/null
set +a
set -e

API="${VOICE_DECISION_API_URL:-http://localhost:8080/api}"
BASE_DONNEES=$(printenv DATABASE_URL | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
SUFFIXE="$(date +%s)"
EMAIL="appel-test-$SUFFIXE@nodaq.test"

# Extrait une valeur imbriquée : `json campagne id`. Les clés passent en
# ARGUMENTS et non dans une expression à évaluer — l'imbrication de guillemets
# entre bash et python cassait à la première clé.
json() {
  python3 -c '
import json, sys
d = json.load(sys.stdin)
for cle in sys.argv[1:]:
    d = d[cle]
print(d)' "$@"
}

echo "→ API : $API"

# ── 1. Un tenant jetable, avec son propriétaire ───────────────────────────
INSCRIPTION=$(curl -s -D /tmp/entetes-appel -X POST "$API/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"test-pass-1234\",\"nom\":\"Essai\",\"tenantNom\":\"Charpente Dubois\"}")
USER_ID=$(printf '%s' "$INSCRIPTION" | json userId)
COOKIE=$(grep -i '^set-cookie:' /tmp/entetes-appel | head -1 | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+).*/\1/')
echo "→ tenant créé"

# ── 2. La double authentification, franchie en base ───────────────────────
docker exec "$(docker ps --filter ancestor=postgres:16 --format '{{.Names}}' | head -1)" \
  psql -U postgres -d "$BASE_DONNEES" -tAq -c \
  "UPDATE sessions SET mfa_verified_at = now() WHERE user_id = '$USER_ID';" >/dev/null
echo "→ session vérifiée"

# ── 3. Ce dont l'agent a besoin pour parler ───────────────────────────────
# L'IBAN est celui du JEU D'ESSAI de la norme ISO 13616, pas un compte réel :
# le tenant d'essai est jetable et l'app Bridge est un bac à sable, donc aucun
# euro ne bouge. En production, c'est le dirigeant qui saisit le sien dans
# Paramètres — la route en vérifie la clé de contrôle avant d'enregistrer.
curl -s -X POST "$API/parametres" -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  -X PATCH -d '{"company.raison_sociale":"Charpente Dubois","company.iban":"FR1420041010050500013M02606"}' >/dev/null
curl -s -X PUT "$API/relance/regles" -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
  -d '{"echelonnementAutorise":true,"maxVersements":4,"delaiMaxPremierVersementJours":15,"retardMaxJours":45,"lienPaiementAutorise":true,"remiseAutorisee":false}' >/dev/null
echo "→ raison sociale et règle de relance posées"

# ── 4. Une campagne, puis sa VALIDATION ───────────────────────────────────
# La règle 4 n'admet pas d'exception : aucun appel n'est composé sans
# `pending_action` approuvée, « y compris juste pour tester ».
CAMPAGNE=$(curl -s -X POST "$API/relance/campagnes" -H "Cookie: $COOKIE" \
  -H "Content-Type: application/json" \
  -d "{\"appels\":[{\"clientId\":null,\"factureId\":\"F-ESSAI\",\"montantCents\":40000,\"numero\":\"$NUMERO\",\"clientNom\":\"Essai Supervisé\"}]}")
CAMPAGNE_ID=$(printf '%s' "$CAMPAGNE" | json campagne id)
PENDING_ID=$(printf '%s' "$CAMPAGNE" | json pendingActionId)

curl -s -X POST "$API/pending-actions/$PENDING_ID/approve" -H "Cookie: $COOKIE" >/dev/null
echo "→ campagne validée"

# ── 5. L'appel planifié, et son jeton ─────────────────────────────────────
APPEL=$(curl -s -X POST "$API/relance/campagnes/$CAMPAGNE_ID/appels" -H "Cookie: $COOKIE" \
  -H "Content-Type: application/json" \
  -d "{\"factureId\":\"F-ESSAI\",\"numero\":\"$NUMERO\"}")
JETON=$(printf '%s' "$APPEL" | json jeton)

echo

if [ "$APPELER" = "--appeler" ]; then
  # Depuis le ticket 4.18-bis, planifier DÉCLENCHE : la route ci-dessus a déjà
  # demandé à la plateforme de composer. Plus de worker à lancer — on relit ce
  # que la planification a répondu.
  DECLENCHE=$(printf '%s' "$APPEL" | json declenche 2>/dev/null || echo "false")
  case "$DECLENCHE" in
    True|true)
      echo "→ la plateforme compose le $NUMERO — décroche."
      ;;
    *)
      echo "→ appel PLANIFIÉ mais non composé :"
      printf '  %s\n' "$(printf '%s' "$APPEL" | json motif 2>/dev/null || echo "motif non fourni")"
      echo "  Vérifie ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_NUMBER_ID et la clé."
      ;;
  esac
  exit 0
fi

echo "════════════════════════════════════════════════════════════════"
echo "  Jeton obtenu. Pour appeler :"
echo
echo "  ./scripts/preparer-appel-test.sh $NUMERO --appeler"
echo
echo "  (ou, si tu tiens à lancer le worker toi-même, le jeton est"
echo "   ci-dessus — mais --appeler évite de le recopier.)"
echo "════════════════════════════════════════════════════════════════"
