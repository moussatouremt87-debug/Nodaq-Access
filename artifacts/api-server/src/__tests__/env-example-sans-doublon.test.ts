/**
 * Aucune clé déclarée deux fois dans `.env.example` — ticket 4.19.
 *
 * ── Pourquoi cette garde existe ───────────────────────────────────────────
 * Un `.env` réel a porté deux blocs Bridge complets, sous les MÊMES noms, avec
 * des valeurs différentes (deux apps distinctes). Personne ne l'a vu, et la
 * configuration s'est mise à dépendre de QUI la lisait :
 *
 *   — `set -a && source .env` en shell : la DERNIÈRE occurrence gagne ;
 *   — les scripts du dépôt (`appliquer-agent-elevenlabs.mjs`, `evals-agent.mjs`)
 *     posent la variable seulement si elle est absente : la PREMIÈRE gagne.
 *
 * Deux lecteurs, deux valeurs, aucune erreur nulle part. C'est la pire forme
 * de panne : celle qui se tait.
 *
 * Le fichier réel n'est pas lisible ici (il n'est pas versionné, et le
 * CLAUDE.md interdit de le lire). Cette garde tient donc le MODÈLE, qui est ce
 * que tout le monde recopie — et un modèle sans doublon ne produit pas de
 * `.env` à doublon par imitation.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const MODELE = resolve(RACINE, ".env.example");

/** Les noms de variables déclarés, dans l'ordre du fichier. */
function clesDeclarees(): string[] {
  return readFileSync(MODELE, "utf8")
    .split("\n")
    .flatMap((ligne) => {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=/.exec(ligne);
      return m ? [m[1]!] : [];
    });
}

describe("`.env.example` — le modèle que tout le monde recopie", () => {
  test("il déclare des variables (sinon ce test ne vérifie rien)", () => {
    expect(clesDeclarees().length).toBeGreaterThan(20);
  });

  test("aucune clé n'y est déclarée deux fois", () => {
    const vues = new Map<string, number>();
    for (const cle of clesDeclarees()) vues.set(cle, (vues.get(cle) ?? 0) + 1);
    const doublons = [...vues.entries()].filter(([, n]) => n > 1).map(([cle, n]) => `${cle} (×${n})`);

    expect(
      doublons,
      "Une clé déclarée deux fois donne une configuration qui dépend du lecteur : " +
        "`source` prend la dernière, les scripts du dépôt prennent la première.",
    ).toEqual([]);
  });
});
