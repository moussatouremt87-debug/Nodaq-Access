#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Apply platform table migrations (non-interactive, idempotent raw SQL)
pnpm --filter @workspace/db run migrate-platform
# Apply remaining Drizzle schema non-interactively
pnpm --filter @workspace/db run push-force
# Regression: connector secret merge preserves unedited fields
pnpm --filter @workspace/db run test-connectors
