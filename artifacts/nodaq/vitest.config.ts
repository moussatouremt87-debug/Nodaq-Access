import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    // jsdom : les défauts d'écran de ce lot sont des défauts de CHEMIN D'USAGE.
    // Aucun n'était visible depuis un test de logique pure — il fallait pouvoir
    // cliquer.
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx",
      // Garde de fuseau partagée par tous les paquets — voir le fichier
      // pour ce qu'elle protège. Un paquet qui perd cette ligne perd la garde.
      "../../tools/tests/*.test.ts",
    ],
  },
});
