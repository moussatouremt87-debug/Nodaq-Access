import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real PostgreSQL — no mocks; timeout must accommodate DB round-trips.
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,

    // All RLS tests run sequentially in a single fork so they share
    // admin-pool setup/teardown without port collisions.
    pool: "forks",
    singleFork: true,

    // Global setup: injects fake LITELLM env vars + patches fetch so
    // chatCompletion() succeeds without a real LiteLLM server.
    setupFiles: ["src/__tests__/vitest.setup.ts"],

    include: ["src/__tests__/**/*.test.ts"],
    reporters: ["verbose"],
  },
});
