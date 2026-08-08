# NODAQ

Application SaaS de gestion pour artisans et PME du bâtiment. Gestion des affaires, devis, facturation, trésorerie, équipe, et assistant IA.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port from PORT env)
- `pnpm --filter @workspace/nodaq run dev` — Frontend React/Vite
- `pnpm run typecheck` — Full typecheck across all packages
- `pnpm run build` — Typecheck + build all packages
- `pnpm --filter @workspace/db run push` — Push Drizzle schema (dev only, no migration file)

## Database operations

### First installation (fresh DB)
```bash
# 1. Create app_user role + print DATABASE_URL_APP
DATABASE_URL=postgres://owner:…@host/db node lib/db/scripts/create-app-role.cjs

# 2. Run all versioned migrations (schema + RLS)
DATABASE_URL=postgres://owner:…@host/db pnpm run db:migrate

# 3. Create first tenant + OWNER user (interactive)
DATABASE_URL=postgres://owner:…@host/db node lib/db/scripts/seed-owner.cjs
```

### Subsequent deployments (update existing DB)
```bash
# Run only — applies pending migrations, no-ops if already up to date
DATABASE_URL=postgres://owner:…@host/db pnpm run db:migrate
```

### Migration files
Located in `lib/db/migrations/`. Each numbered `.sql` file is applied once, tracked in the `_migrations` table. Never edit applied migrations — add a new numbered file instead.

- `001_initial_schema.sql` — Full schema (all tables, all columns, all indexes)
- `002_rls.sql` — app_user grants + Row-Level Security on all business tables

### Old scripts (still available, now wrapped by db:migrate)
The legacy CJS scripts in `lib/db/scripts/` remain available for debugging or one-off ops, but `db:migrate` is the canonical path for all schema changes.

## Stack

- pnpm workspaces, Node.js 20/24, TypeScript 5.9
- API: Express 5 (artifacts/api-server)
- Frontend: React 19 + Vite 7 + TailwindCSS 4 (artifacts/nodaq)
- DB: PostgreSQL + Drizzle ORM + RLS (tenant isolation)
- Validation: Zod 3, drizzle-zod
- LLM: @nodaq/llm (fetch-based, LiteLLM-compatible)
- PDF: pdfkit + Factur-X (lib/facturx)
- Auth: DB-backed sessions (nodaq_sid cookie)

## Where things live

| Area | Path |
|------|------|
| API routes | `artifacts/api-server/src/routes/` |
| DB schema (Drizzle) | `lib/db/src/schema/` |
| DB migrations (SQL) | `lib/db/migrations/` |
| LLM client | `lib/llm/src/client.ts` |
| AI agent | `artifacts/api-server/src/lib/mistralAgent.ts` |
| Zod API contracts | `lib/api-zod/src/` |
| Frontend pages | `artifacts/nodaq/src/pages/` |

## Architecture decisions

- **RLS enforced at DB level**: all business tables have `tenant_isolation` policy; app runs as `app_user` (non-owner) so policies always apply. Any query missing the GUC returns 0 rows.
- **Versioned SQL migrations**: `lib/db/migrations/` tracked in `_migrations` table. Idempotent — running twice applies 0 migrations on the second run.
- **PUBLIC_URL, no Replit vars in production**: CORS and startup validation use `PUBLIC_URL`; `REPLIT_DEV_DOMAIN` is a dev fallback only. Scaleway deployments need only `DATABASE_URL_APP`, `SESSION_SECRET`, `PUBLIC_URL`, `PORT`, `NODE_ENV`, and LLM keys.
- **LLM fallback chain**: `LITELLM_API_KEY` → `MISTRAL_API_KEY`; `LITELLM_BASE_URL` defaults to `https://api.mistral.ai/v1`; `LLM_MODEL` defaults to `mistral-large-latest`.
- **esbuild bundle**: API server is bundled to a single ESM file; only `pdfkit`, `nodemailer`, `pino-pretty`, `pg`, and native modules are externalized.

## Docker deployment (Scaleway-ready)

```bash
# Build image
docker build -t nodaq:latest .

# Run migrations (one-off, owner creds)
docker run --rm \
  -e DATABASE_URL="postgres://owner:PASSWORD@host:5432/nodaq" \
  nodaq:latest node /app/migrate.mjs

# Run application (no Replit vars needed)
docker run -p 8080:8080 \
  -e DATABASE_URL_APP="postgres://app_user:PASSWORD@host:5432/nodaq" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e PUBLIC_URL="https://app.nodaq.fr" \
  -e PORT=8080 \
  -e NODE_ENV=production \
  -e LITELLM_API_KEY="…" \
  nodaq:latest
```

## Required environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL_APP` | ✅ runtime | Postgres URL as app_user (RLS enforced) |
| `SESSION_SECRET` | ✅ runtime | Cookie signing secret (random hex string) |
| `PUBLIC_URL` | ✅ production | Canonical origin, e.g. `https://app.nodaq.fr` |
| `PORT` | ✅ always | TCP port for the server |
| `NODE_ENV` | ✅ production | Must be `production` in Docker |
| `LITELLM_API_KEY` or `MISTRAL_API_KEY` | ✅ runtime | LLM API key |
| `DATABASE_URL` | Migration only | Owner/superuser creds for `db:migrate` |
| `LITELLM_BASE_URL` | Optional | LiteLLM proxy URL (defaults to Mistral direct) |
| `LLM_MODEL` | Optional | Model name (defaults to mistral-large-latest) |
| `SCALEWAY_API_KEY` | Optional | Scaleway STT transcription |
| `REPLIT_DEV_DOMAIN` | Dev fallback | Set automatically by Replit; not needed on Scaleway |

## Gotchas

- **Never use owner credentials at runtime**: `DATABASE_URL` is for migrations only; `DATABASE_URL_APP` (app_user) is for the running server.
- **db:migrate requires DATABASE_URL** (owner), not DATABASE_URL_APP.
- **After adding a new table or column**: add a new numbered SQL file in `lib/db/migrations/` AND update the Drizzle schema in `lib/db/src/schema/`. Run `db:migrate` in staging then production.
- **RLS requires app_user**: the startup guard checks `current_user === 'app_user'` and exits if wrong. Run `create-app-role.cjs` to set up the role.
- **Replit-only Vite plugins** (cartographer, devBanner) are gated on `REPL_ID !== undefined` — they are automatically excluded in Docker builds.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- API spec in `lib/api-zod/` — regenerate with `pnpm --filter @workspace/api-spec run codegen`.
