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

    setupFiles: ["src/__tests__/vitest.setup.ts"],
    include: ["src/__tests__/**/*.test.ts"],
    reporters: ["verbose"],
  },
});
