/**
 * Aucun jargon dans ce que l'utilisateur LIT — ticket 4.29.
 *
 * ── Ce que cette garde protège ────────────────────────────────────────────
 * « Un artisan ne comprend pas le mot MRR. » — « "YTD" n'est pas compréhensible
 * pour un artisan. »
 *
 * L'utilisateur de ce produit pose des ardoises et relance des impayés. Un mot
 * qu'il doit traduire mentalement est un mot qui coûte, et « Depuis le
 * 1er janvier » dit exactement ce que « YTD » dit, sans rien perdre.
 *
 * ── Ce qu'elle regarde, et ce qu'elle ignore ──────────────────────────────
 * Uniquement le TEXTE AFFICHÉ : contenu de balises, `label`, `title`,
 * `placeholder`, `description`. Pas les noms de variables, pas les
 * commentaires, pas les identifiants d'API — `caYtdCents` reste un nom de
 * champ parfaitement légitime, il n'est jamais lu par personne.
 *
 * Cette distinction est le cœur de la garde : confondre les deux la rendrait
 * ingérable, et on la désactiverait au premier faux positif.
 */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { TERMES_INTERDITS } from "@nodaq/shared";

const RACINE_SRC = join(__dirname, "..");

function fichiersEcrans(): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) {
        if (entree !== "node_modules" && entree !== "ui") parcourir(chemin);
      } else if (entree.endsWith(".tsx") && !entree.includes(".test.")) {
        trouves.push(chemin);
      }
    }
  };
  parcourir(RACINE_SRC);
  return trouves;
}

/**
 * Le texte qu'un humain verra, extrait d'un fichier JSX.
 *
 * Deux sources : ce qui se trouve entre `>` et `<`, et la valeur des attributs
 * connus pour être affichés. Les commentaires JSX sont retirés d'abord —
 * expliquer POURQUOI « MRR » est banni ne doit pas déclencher la garde.
 */
function texteAffiche(source: string): string {
  const sansCommentaires = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

  // Les EXPRESSIONS JSX sont retirées avant d'extraire le texte. Sans ça,
  // un `>=` écrit dans une condition ouvre un faux « entre balises » et la
  // garde accuse du code — c'est arrivé sur `ytd.tauxRecouvrement >= 80`.
  // Six passes suffisent pour les accolades imbriquées rencontrées ici.
  let sansExpressions = sansCommentaires;
  for (let i = 0; i < 6; i++) {
    sansExpressions = sansExpressions.replace(/\{[^{}]*\}/g, " ");
  }

  const entreBalises = [...sansExpressions.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]!);
  const attributs = [
    ...sansExpressions.matchAll(
      /\b(?:label|title|placeholder|description|aria-label)=["']([^"']+)["']/g,
    ),
  ].map((m) => m[1]!);
  return [...entreBalises, ...attributs].join(" \n ");
}

describe("aucun terme interdit dans le texte affiché", () => {
  const fichiers = fichiersEcrans();

  test("la garde lit bien quelque chose", () => {
    expect(fichiers.length).toBeGreaterThan(20);
  });

  test.each(Object.keys(TERMES_INTERDITS).map((t) => [t] as const))(
    "« %s » n'apparaît nulle part",
    (terme) => {
      const motEntier = new RegExp(`\\b${terme}\\b`, "i");
      const fautifs = fichiers
        .filter((f) => motEntier.test(texteAffiche(readFileSync(f, "utf8"))))
        .map((f) => f.replace(RACINE_SRC, "src"))
        .sort();

      expect(
        fautifs,
        `« ${terme} » est affiché dans : ${fautifs.join(", ")}. ` +
          `Dire plutôt : ${TERMES_INTERDITS[terme]}`,
      ).toEqual([]);
    },
  );
});

describe("les comptes s'accordent en français", () => {
  test("aucun « les {n} » construit à la main dans les écrans", () => {
    // « Voir les 1 devis » était affiché tel quel. La faute vient toujours de
    // la même construction : un article figé collé à un compte variable.
    const fautifs = fichiersEcrans()
      .filter((f) => /\bles \{[^}]*(?:count|nombre|total|length)[^}]*\}/i.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(RACINE_SRC, "src"))
      .sort();

    expect(
      fautifs,
      `Article figé devant un compte variable — utiliser \`articleEtNom\` : ${fautifs.join(", ")}`,
    ).toEqual([]);
  });
});
