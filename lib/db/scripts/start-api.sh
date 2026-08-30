#!/bin/sh
# Demarrage de l'image de production.
#
# DATABASE_URL donne les droits owner uniquement aux migrations et a la reprise
# des secrets legacy. Elle est retiree de l'environnement AVANT l'API, qui ne
# peut alors utiliser que DATABASE_URL_APP et reste soumise a la RLS.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[startup] FATAL: DATABASE_URL owner est requise pour migrer avant l'API." >&2
  exit 1
fi

node ./migrate.mjs

# Ne jamais transmettre les droits owner au processus applicatif.
unset DATABASE_URL

exec node --enable-source-maps ./dist/index.mjs
