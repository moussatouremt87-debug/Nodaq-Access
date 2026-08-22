import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real PostgreSQL — no mocks; timeout must accommodate DB round-trips.
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,

    // Les fichiers s'exécutent EN PARALLÈLE, et c'est le défaut de Vitest.
    //
    // Ils ont été sérialisés au ticket 4.22 pour endiguer des `ECONNRESET`
    // intermittents, sur la foi d'un diagnostic — l'épuisement des ports
    // éphémères — qui s'est révélé FAUX à la mesure : le pic observé pendant
    // une exécution complète est de 677 sockets en TIME_WAIT, sur 16 384
    // disponibles. La sérialisation coûtait un facteur trois sur la CI sans
    // rien régler (3 exécutions rouges sur 12 après, contre 2 sur 12 avant).
    //
    // La vraie cause était le RECYCLAGE des ports, provoqué par un serveur
    // HTTP créé PAR REQUÊTE — plus de 28 000 par exécution. Elle est traitée
    // à la source dans `helpers.ts` (`serveurTest`), et le parallélisme n'a
    // plus lieu d'être retiré.
    fileParallelism: true,

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
