import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real PostgreSQL — no mocks; timeout must accommodate DB round-trips.
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,

    // Les fichiers de test s'exécutent l'un APRÈS l'autre, jamais en parallèle.
    //
    // Deux raisons, et les deux ont fait des dégâts avant d'être comprises :
    //   — Supertest monte un serveur `app.listen(0)` par requête, et ce paquet
    //     en compte plus de 300. Plusieurs fichiers en vol puisent tous dans la
    //     réserve de ports éphémères de la MACHINE : d'où des `ECONNRESET`
    //     intermittents, sur un fichier différent à chaque fois.
    //   — Tous les fichiers partagent UNE base PostgreSQL. Le nettoyage de fin
    //     de fichier s'exécutait pendant qu'un autre était au milieu de ses
    //     tests, d'où des « la ligne n'est pas là » : 404 sur une route qui
    //     existe, compte à 0, 201 devenu 200.
    //
    // `fileParallelism: false` et NON `singleFork: true` : cette dernière était
    // écrite ici depuis l'origine, n'existe plus dans Vitest 4, et était donc
    // ignorée en silence. Les fichiers tournaient à neuf forks, exactement le
    // contraire de ce que ce commentaire promettait. Voir ticket 4.22.
    pool: "forks",
    fileParallelism: false,

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
