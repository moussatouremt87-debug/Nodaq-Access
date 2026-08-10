import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "**/*.{test,spec}.?(c|m)[jt]s?(x)",
      // Garde de fuseau partagée par tous les paquets — voir le fichier
      // pour ce qu'elle protège. Un paquet qui perd cette ligne perd la garde.
      "../../tools/tests/*.test.ts",
    ],
  },
});
