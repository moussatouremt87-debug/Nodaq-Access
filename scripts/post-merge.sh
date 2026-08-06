#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Apply platform table migrations (non-interactive, idempotent raw SQL)
pnpm --filter @workspace/db run migrate-platform

# Apply remaining Drizzle schema non-interactively
pnpm --filter @workspace/db run push-force

# Unit regression: connector secret merge logic
pnpm --filter @workspace/db run test-connectors

# HTTP-level regression: build the API server, start it on a test port,
# run the connector route tests, then shut it down.
echo "Building API server for HTTP regression..."
pnpm --filter @workspace/api-server run build

# Kill any leftover process on the test port before starting
fuser -k 18080/tcp 2>/dev/null || true

echo "Starting API server on port 18080 for HTTP regression..."
PORT=18080 node artifacts/api-server/dist/index.mjs &
API_PID=$!
# Always clean up the test server, even on failure
cleanup_server() { kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true; fuser -k 18080/tcp 2>/dev/null || true; echo "Test server stopped"; }
trap cleanup_server EXIT

# Poll until the server responds (up to 20 s) — fail explicitly if it never starts
echo "Waiting for test server to be ready..."
SERVER_READY=0
for i in $(seq 1 40); do
  if curl -sf http://localhost:18080/api/healthz > /dev/null 2>&1; then
    echo "Server ready after $((i * 500))ms"
    SERVER_READY=1
    break
  fi
  sleep 0.5
done
if [ "$SERVER_READY" -ne 1 ]; then
  echo "ERROR: Test server did not become reachable within 20 seconds" >&2
  exit 1
fi

TEST_API_BASE=http://localhost:18080 \
  pnpm --filter @workspace/db run test-connectors-http

TEST_API_BASE=http://localhost:18080 \
  pnpm --filter @workspace/db run test-planning-http

echo "HTTP regression tests complete."
