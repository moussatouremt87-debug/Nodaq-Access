/**
 * Garde structurelle — la sortie de session est bien MONTÉE, aux deux tailles.
 *
 * POURQUOI ELLE EXISTE. `menu-utilisateur.test.tsx` monte le composant tout
 * seul : il prouve qu'il se comporte bien, jamais qu'on peut l'atteindre.
 * C'est exactement l'angle mort qui a produit le défaut d'origine —
 * `POST /api/auth/logout` fonctionnait parfaitement depuis le premier lot, et
 * l'application était malgré tout livrée sans aucun moyen de se déconnecter.
 * Retirer `<MenuUtilisateur>` de la coquille ne ferait tomber aucun test de
 * comportement.
 *
 * Même famille que `nav.test.ts`, et pour la même raison : un écran qui existe
 * sans chemin pour y aller n'échoue nulle part.
 *
 * Les DEUX variantes sont exigées. Sur téléphone la barre latérale n'est pas
 * rendue (`hidden md:flex`) : ne monter que `barre` rendrait la déconnexion
 * introuvable précisément pour l'artisan qui n'a pas d'ordinateur, et ça
 * passerait inaperçu sur un écran de développement large.
 *
 * Le fichier source est LU plutôt qu'importé : `app-shell.tsx` tire toute
 * l'application (react-query, wouter, les pages) pour un contrôle qui est
 * purement textuel.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE_COQUILLE = readFileSync(join(__dirname, "app-shell.tsx"), "utf8");

describe("La sortie de session est atteignable depuis la coquille", () => {
  test("app-shell.tsx importe le menu du compte", () => {
    expect(SOURCE_COQUILLE).toMatch(
      /import\s*\{[^}]*\bMenuUtilisateur\b[^}]*\}\s*from\s*['"]@\/components\/menu-utilisateur['"]/,
    );
  });

  test.each([
    ["barre", "barre latérale (ordinateur)"],
    ["entete", "en-tête mince (téléphone)"],
  ])("la variante « %s » est montée — %s", (variante) => {
    expect(SOURCE_COQUILLE).toContain(`<MenuUtilisateur variante="${variante}" />`);
  });
});
