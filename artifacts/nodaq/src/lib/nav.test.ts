/**
 * Garde de navigation — cohérence entre les routes et les menus.
 *
 * POURQUOI ELLE EXISTE. Les écrans « Devis dicté » et « Envoi » ont été livrés
 * avec leur route dans `App.tsx` et leur entrée dans `NAV_SECTIONS`, mais
 * ABSENTS de `MOBILE_NAV` — la barre réellement affichée sous 768 px. Résultat :
 * sur téléphone, la fonction principale du produit n'était atteignable qu'en
 * tapant l'URL à la main. Rien n'échouait ; l'écran existait, simplement
 * personne ne pouvait y aller.
 *
 * Cette garde lit les fichiers source plutôt que d'importer les modules :
 * `App.tsx` tire toute l'application (react-query, wouter, les pages), ce qui
 * demanderait un environnement DOM pour un contrôle qui est purement textuel.
 * Même approche que les gardes structurelles de l'API.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RACINE = join(__dirname, "..");
const SOURCE_NAV = readFileSync(join(RACINE, "lib", "nav.ts"), "utf8");
const SOURCE_APP = readFileSync(join(RACINE, "App.tsx"), "utf8");

/** Routes déclarées dans App.tsx, hors routes publiques et paramétrées. */
function routesDeclarees(): string[] {
  const trouvees = [...SOURCE_APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]!);
  return trouvees.filter(
    (r) =>
      // Les routes à paramètre ne s'affichent pas dans un menu.
      !r.includes(":") &&
      // Écrans hors application authentifiée.
      // "/mfa" (ticket 4.15) : atteignable via le lien dédié "Sécurité du
      // compte" du pied de la barre latérale (app-shell.tsx), volontairement
      // hors de NAV_SECTIONS/MOBILE_NAV — ce n'est pas une section métier.
      !["/login", "/register", "/mfa"].includes(r),
  );
}

/** Extrait les `href` d'un bloc nommé du fichier nav.ts. */
function hrefsDe(nomDuBloc: string): string[] {
  const debut = SOURCE_NAV.indexOf(`export const ${nomDuBloc}`);
  if (debut === -1) {
    throw new Error(
      `${nomDuBloc} introuvable dans nav.ts. Cette garde le lit textuellement — ` +
        `si le bloc a été renommé, mettez la garde à jour plutôt que de la contourner.`,
    );
  }
  const fin = SOURCE_NAV.indexOf("export ", debut + 10);
  const bloc = SOURCE_NAV.slice(debut, fin === -1 ? undefined : fin);
  return [...bloc.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]!);
}

const NAV_SECTIONS_HREFS = hrefsDe("NAV_SECTIONS");
const MOBILE_NAV_HREFS = hrefsDe("MOBILE_NAV");

describe("navigation — cohérence avec les routes", () => {
  test("les deux listes sont lues et non vides", () => {
    expect(NAV_SECTIONS_HREFS.length).toBeGreaterThan(0);
    expect(MOBILE_NAV_HREFS.length).toBeGreaterThan(0);
    expect(routesDeclarees().length).toBeGreaterThan(0);
  });

  test("aucune entrée de menu ne pointe vers une route inexistante", () => {
    const routes = new Set(routesDeclarees());
    const orphelines = [...new Set([...NAV_SECTIONS_HREFS, ...MOBILE_NAV_HREFS])]
      .filter((href) => !routes.has(href))
      .sort();

    expect(
      orphelines,
      `Ces entrées de navigation mènent à une route absente de App.tsx : ${orphelines.join(", ")}`,
    ).toEqual([]);
  });

  test("aucune route n'est absente des DEUX listes de navigation", () => {
    // Une route qui n'apparaît nulle part n'est atteignable qu'en tapant l'URL.
    const dansUnMenu = new Set([...NAV_SECTIONS_HREFS, ...MOBILE_NAV_HREFS]);
    const inatteignables = routesDeclarees()
      .filter((route) => !dansUnMenu.has(route))
      .sort();

    expect(
      inatteignables,
      `Ces routes n'apparaissent dans AUCUN menu — elles ne sont atteignables ` +
        `qu'en tapant l'URL : ${inatteignables.join(", ")}`,
    ).toEqual([]);
  });
});

describe("navigation mobile — les fonctions principales sont atteignables", () => {
  // Le trou d'origine, nommé explicitement : ces deux écrans étaient dans
  // NAV_SECTIONS et absents de MOBILE_NAV.
  test("le devis dicté figure dans la barre mobile", () => {
    expect(
      MOBILE_NAV_HREFS,
      "Le devis dicté est la fonction principale, et son utilisateur est sur un chantier avec son téléphone.",
    ).toContain("/devis/dictee");
  });

  test("le devis dicté est en DEUXIÈME position, pas en fin de liste", () => {
    expect(MOBILE_NAV_HREFS[1]).toBe("/devis/dictee");
  });

  test("le paramétrage d'envoi figure explicitement dans les menus", () => {
    expect(NAV_SECTIONS_HREFS).toContain("/parametres/envoi");
  });
});
