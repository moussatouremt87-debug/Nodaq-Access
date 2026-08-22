/**
 * Tout montant se saisit dans `CurrencyInput` — ticket 4.28.
 *
 * ── Ce que cette garde protège ────────────────────────────────────────────
 * « Quand je veux saisir le P.U HT, je dois manuellement effacer tous les 0
 * pour ensuite saisir le montant, c'est chiant pour les users. »
 *
 * `CurrencyInput` règle quatre défauts d'un coup : le curseur qui saute à
 * chaque frappe (taper « 3200 » donnait « 3,00 »), les incréments du champ
 * `type="number"` (« 45 » devenait « 4,01 »), le zéro qu'il faut effacer, et
 * la virgule décimale française refusée.
 *
 * Un écran qui recompose sa propre saisie de montant à coups de
 * `<Input type="number">` reperd les quatre. La correction ne tient donc que
 * si personne ne recommence — d'où cette garde, qui lit les sources plutôt que
 * de rendre chaque écran.
 */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const RACINE_SRC = join(__dirname, "..");

/** Tous les `.tsx` de l'application, hors tests. */
function fichiersEcrans(): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) {
        if (entree !== "node_modules") parcourir(chemin);
      } else if (entree.endsWith(".tsx") && !entree.includes(".test.")) {
        trouves.push(chemin);
      }
    }
  };
  parcourir(RACINE_SRC);
  return trouves;
}

/**
 * Un `<Input type="number">` dont la valeur porte un nom d'argent.
 *
 * On cherche le nom de la variable liée, pas le libellé affiché : c'est le nom
 * qui dit ce que le champ transporte, et il survit à une traduction.
 */
const CHAMP_MONETAIRE =
  /<Input[^>]*type="number"[^>]*value=\{[^}]*(?:[Cc]ents|montant|Montant|prix|Prix|amount|Amount|tarif|Tarif)[^}]*\}/;

describe("aucun montant ne se saisit dans un champ à incréments", () => {
  const fichiers = fichiersEcrans();

  test("la garde lit bien quelque chose", () => {
    // Sans ça, une erreur de chemin rendrait cette garde silencieusement vraie.
    expect(fichiers.length).toBeGreaterThan(20);
  });

  test("aucun `<Input type=\"number\">` lié à une valeur monétaire", () => {
    const fautifs = fichiers
      .filter((f) => CHAMP_MONETAIRE.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(RACINE_SRC, "src"))
      .sort();

    expect(
      fautifs,
      `Ces écrans saisissent un montant dans un champ à incréments au lieu ` +
        `d'utiliser CurrencyInput : ${fautifs.join(", ")}`,
    ).toEqual([]);
  });
});

describe("le composant reste le point de passage unique", () => {
  test("CurrencyInput porte bien les quatre protections", () => {
    const src = readFileSync(join(RACINE_SRC, "components", "currency-input.tsx"), "utf8");
    // `type="text"` : c'est ce qui retire les incréments du champ nombre.
    expect(src).toContain('type="text"');
    // Clavier numérique sur téléphone, sans revenir à `type="number"`.
    expect(src).toContain('inputMode="decimal"');
    // La virgule française est acceptée.
    expect(src).toContain("replace(',', '.')");
    // Le filigrane remplace le zéro à effacer.
    expect(src).toContain('placeholder="0,00"');
  });
});
