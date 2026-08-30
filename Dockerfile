# ─────────────────────────────────────────────────────────────────────────────
# NODAQ — Multi-stage production Dockerfile
#
# Uses node:20-slim (Debian Bookworm, glibc) — NOT Alpine — because several
# native optional packages (@rollup/rollup-linux-x64-musl, @tailwindcss/oxide
# musl variant) are explicitly excluded from the pnpm workspace overrides.
# La variante x64-gnu, elle, n'est pas exclue et s'installe correctement.
#
# ATTENTION : `rollup-linux-ARM64-gnu` EST exclu (pnpm-workspace.yaml). Une
# construction arm64 — le défaut sur un Mac Apple Silicon — échoue donc. D'où
# le `--platform linux/amd64` ci-dessus.
#
# Build (--platform OBLIGATOIRE depuis un Mac Apple Silicon) :
#   docker build --platform linux/amd64 -t nodaq:latest .
#
#   `pnpm-workspace.yaml` exclut `@rollup/rollup-linux-arm64-gnu`, si bien
#   qu'une image arm64 échoue à compiler le front. Scaleway Containers tourne
#   en x86_64 de toute façon : c'est l'architecture qu'il faut construire.
#
# Migrate (one-off, owner creds, before first start):
#
#   ── CONTRE UN POSTGRES GÉRÉ (Scaleway RDB), DEUX PIÈGES ────────────────────
#   Les deux ont coûté trois tentatives le 29/08/2026, et l'exemple qui figurait
#   ici y menait tout droit — il ne portait ni TLS ni le bon port.
#
#   1. `sslmode=require` NE SUFFIT PAS. `pg-connection-string` le traite comme
#      `verify-full`, qui exige une CA de confiance. Scaleway signe avec la CA
#      de l'instance : sans elle, « self-signed certificate ». On la récupère
#      avec `scw rdb instance get-certificate <instance-id> > ca.pem`.
#
#   2. NE PAS SE CONNECTER PAR ADRESSE IP. `pg` n'envoie de `servername` TLS
#      que si l'hôte n'est pas une IP — SNI interdit les adresses. Avec une IP,
#      Node retombe sur son défaut `localhost` et le compare au certificat :
#      « Host: localhost is not in the cert's altnames ». Utiliser le NOM DNS
#      de l'instance, qui figure dans les SAN du certificat.
#
#   docker run --rm \
#     -v ./ca.pem:/ca.pem:ro \
#     -e DATABASE_URL="postgres://owner:PASSWORD@rw-<instance-id>.rdb.<region>.scw.cloud:<port>/nodaq?sslmode=verify-full&sslrootcert=/ca.pem" \
#     nodaq:latest node /app/migrate.mjs
#
#   Contre un Postgres local sans TLS, la forme courte suffit :
#     -e DATABASE_URL="postgres://owner:PASSWORD@host:5432/nodaq"
#
# Run (no Replit variables needed):
#   docker run -p 8080:8080 \
#     -e DATABASE_URL_APP="postgres://app_user:PASSWORD@host:5432/nodaq" \
#     -e SESSION_SECRET="$(openssl rand -hex 32)" \
#     -e PUBLIC_URL="https://app.nodaq.fr" \
#     -e PORT=8080 \
#     -e NODE_ENV=production \
#     -e ENCRYPTION_KEY="$(openssl rand -base64 32)" \
#     -e APP_URL="https://app.nodaq.fr" \
#     -e LLM_BASE_URL="…" -e LLM_API_KEY="…" -e LLM_MODEL_CHAT="…" \
#     nodaq:latest
#
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:24-slim AS builder

WORKDIR /workspace

# Install pnpm at the exact version used in development
RUN npm install -g pnpm@10.34.5 --quiet

# Copy workspace manifests first — Docker layer cache is only invalidated when
# the lockfile or manifests change, not on source changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./

# Copy all source packages required for the build
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/nodaq/ ./artifacts/nodaq/

# Install all dependencies (dev + prod) — build tools need dev deps
RUN pnpm install --frozen-lockfile

# ── Build the frontend (Vite) ─────────────────────────────────────────────────
# BASE_PATH=/ — SPA is served from root in Docker (no sub-path prefix).
# NODE_ENV=production ensures Replit-only Vite plugins (gated on REPL_ID !== undefined)
# are automatically skipped, no code change needed.
# PORT is consumed by vite.config.ts at import time; unused during a build-only run.
ENV NODE_ENV=production \
    BASE_PATH=/ \
    PORT=8080 \
    # FRONTEND_PORT DOIT différer de PORT, même pour une construction seule.
    # `vite.config.ts` refuse de se charger si les deux sont égaux — le proxy
    # /api se renverrait la requête à lui-même. Le fichier retombe sur PORT
    # quand FRONTEND_PORT est absent, donc ne rien poser ici les rend égaux et
    # casse la construction. La valeur n'a aucun effet : en production l'API
    # sert elle-même le SPA bâti, il n'y a pas de proxy.
    FRONTEND_PORT=5173

RUN pnpm --filter @workspace/nodaq run build

# ── Build the API server (esbuild single-file bundle) ────────────────────────
RUN pnpm --filter @workspace/api-server run build

# ── Create a standalone deployment with real, non-symlinked node_modules ─────
# pnpm deploy resolves all workspace:* dependencies and copies files out of the
# pnpm virtual store as regular files (not symlinks), making node_modules
# portable into the production stage without carrying the entire .pnpm store.
# The --legacy flag is required for pnpm v10 in workspaces that do not set
# inject-workspace-packages=true.
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /standalone

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:24-slim AS production

WORKDIR /app

# Create a non-root user (Debian syntax: groupadd / useradd)
RUN groupadd -r -g 1001 nodaq && \
    useradd  -r -u 1001 -g nodaq -M nodaq

# ── Runtime artefacts ─────────────────────────────────────────────────────────

# Resolved production node_modules — real files, no symlinks to pnpm store.
# Contains: express, nodemailer, pdfkit, pino, pg, and all transitive prod deps.
COPY --from=builder --chown=nodaq:nodaq /standalone/node_modules ./node_modules

# API server esbuild bundle (self-contained; workspace libs already inlined)
COPY --from=builder --chown=nodaq:nodaq \
  /workspace/artifacts/api-server/dist ./dist

# Frontend static files — served by Express in production via express.static
COPY --from=builder --chown=nodaq:nodaq \
  /workspace/artifacts/nodaq/dist/public ./public

# Migration runner + SQL files
# Run as a one-off before the app starts: node /app/migrate.mjs
# Requires DATABASE_URL (owner creds), not DATABASE_URL_APP.
COPY --from=builder --chown=nodaq:nodaq \
  /workspace/lib/db/scripts/migrate.mjs ./migrate.mjs
COPY --from=builder --chown=nodaq:nodaq \
  /workspace/lib/db/migrations ./migrations

# Les articles d'aide. Le disque du conteneur est éphémère : ils doivent être
# DANS l'image, comme les migrations. `AIDE_DIR` les désigne à l'exécution.
#
# Copiés depuis le CONTEXTE, pas depuis l'étage `builder` : celui-ci ne reçoit
# que `lib/`, `artifacts/api-server/` et `artifacts/nodaq/` — `docs/` n'y a
# jamais existé, et la première version de cette ligne faisait échouer la
# construction. Ces fichiers ne sont de toute façon pas compilés : les faire
# transiter par l'étage de compilation n'apporterait rien et invaliderait son
# cache à chaque correction d'une phrase.
COPY --chown=nodaq:nodaq docs/aide ./aide

# package.json — used by the /api/health endpoint to read the version field
COPY --from=builder --chown=nodaq:nodaq \
  /workspace/artifacts/api-server/package.json ./package.json

USER nodaq

# ── Configuration ─────────────────────────────────────────────────────────────
ENV NODE_ENV=production \
    PORT=8080 \
    # Tell migrate.mjs where the SQL files are inside the image.
    # Without this the script resolves paths relative to its own parent dir,
    # which in the container would be /app (not /app/migrations).
    MIGRATIONS_DIR=/app/migrations \
    AIDE_DIR=/app/aide

# Users are French companies — a "month" or "quarter" means Paris calendar
# time. Pinning TZ avoids off-by-one period boundaries on hosts running UTC.
ENV TZ=Europe/Paris

EXPOSE 8080

# ── Health check ──────────────────────────────────────────────────────────────
# Uses the Node.js built-in http module — no curl/wget needed, keeps image minimal.
# Exits 0 when /api/health returns HTTP 200 with {"status":"ok"}, 1 otherwise.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "\
    require('http').get(\
      'http://localhost:' + (process.env.PORT || 8080) + '/api/health',\
      function(r) { process.exit(r.statusCode === 200 ? 0 : 1); }\
    ).on('error', function() { process.exit(1); })"

# ── Entrypoint ────────────────────────────────────────────────────────────────
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
