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
    include: ["src/__tests__/**/*.test.ts",
      // Garde de fuseau partagée par tous les paquets — voir le fichier
      // pour ce qu'elle protège. Un paquet qui perd cette ligne perd la garde.
      "../../tools/tests/*.test.ts",
    ],
    reporters: ["verbose"],

    // Users are French companies — a "month" means a month in Paris.
    // Pin the timezone so period boundaries don't shift with the runner's TZ.
    //
    // DÉFAUT, et non écrasement. Vitest applique `env` au `process.env` du
    // worker : la valeur fixe qui vivait ici gagnait TOUJOURS, y compris
    // contre un `TZ=Pacific/Auckland` explicite en tête de commande. Ce paquet
    // était le seul des huit à épingler le fuseau, et c'est celui qui porte
    // les bornes de période, les dates d'émission et les exercices — l'endroit
    // même où l'on voulait éprouver les trois fuseaux. L'exigence répétée par
    // chaque ticket ne vérifiait donc rien ici.
    //
    // Sans consigne, un mois reste un mois à Paris. Avec consigne, la consigne
    // l'emporte. `tools/tests/fuseau-attendu.test.ts` vérifie qu'elle est bien
    // appliquée, dans ce paquet comme dans les sept autres.
    env: {
      TZ: process.env.TZ ?? "Europe/Paris",
    },
  },
});
