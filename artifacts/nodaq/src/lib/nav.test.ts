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
import { routeOuverteAuComptable } from '@nodaq/shared';
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { NAV_SECTIONS, destinationsMobiles } from "./nav";

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

/**
 * Les routes qui ne font que REDIRIGER, lues dans la source.
 *
 * Reconnues à leur forme `<Route path="…">{() => <Redirect …/>}</Route>` : pas
 * de `component=`, donc pas d'écran. Elles gardent en vie une adresse qui a pu
 * être mise en favori, sans mériter une entrée de menu.
 */
function routesRedirigees(): string[] {
  return [...SOURCE_APP.matchAll(/<Route\s+path="([^"]+)"\s*>\s*\{\s*\(\)\s*=>\s*<Redirect/g)]
    .map((m) => m[1]!);
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
    // Une route de REDIRECTION n'est pas un écran : elle existe pour qu'une
    // adresse mise en favori continue de mener quelque part, pas pour être
    // proposée dans un menu. L'exiger dans la navigation reviendrait à
    // remettre l'entrée qu'on vient de retirer (ticket 4.24).
    const redirections = new Set(routesRedirigees());
    const inatteignables = routesDeclarees()
      .filter((route) => !dansUnMenu.has(route) && !redirections.has(route))
      .sort();

    expect(
      inatteignables,
      `Ces routes n'apparaissent dans AUCUN menu — elles ne sont atteignables ` +
        `qu'en tapant l'URL : ${inatteignables.join(", ")}`,
    ).toEqual([]);
  });
});

describe("navigation mobile — les fonctions principales sont atteignables", () => {
  // ── L'écran « Devis dicté » a été SUPPRIMÉ (ticket 4.24) ────────────────
  //
  // Cette garde exigeait sa présence en deuxième position dans la barre
  // mobile, et elle avait raison à l'époque : l'écran existait sans être
  // atteignable. La décision produit a changé — la voix est portée par l'agent
  // unique, qui comprend l'intention quel que soit le sujet.
  //
  // La garde est donc RETOURNÉE, pas retirée : elle interdit maintenant que
  // l'écran réapparaisse à moitié. Un menu qui pointe vers une route
  // redirigée envoie l'utilisateur ailleurs que là où l'étiquette promet.
  test("le devis dicté n'est plus proposé nulle part dans les menus", () => {
    expect(MOBILE_NAV_HREFS).not.toContain("/devis/dictee");
    expect(NAV_SECTIONS_HREFS).not.toContain("/devis/dictee");
  });

  test("l'agent, qui le remplace, est bien atteignable au doigt", () => {
    // Ce que l'écran supprimé assurait doit être assuré par son remplaçant,
    // sinon on a retiré une fonction au lieu de la déplacer.
    expect(
      MOBILE_NAV_HREFS,
      "La voix passe désormais par l'agent : s'il n'est pas dans la barre mobile, la fonction est perdue sur téléphone.",
    ).toContain("/chat");
  });

  test("le paramétrage d'envoi figure explicitement dans les menus", () => {
    expect(NAV_SECTIONS_HREFS).toContain("/parametres/envoi");
  });
});

// ── Parité mobile ↔ bureau (ticket 4.20) ───────────────────────────────────

describe("parité mobile — un téléphone atteint TOUT ce qu'un bureau atteint", () => {
  // Le trou que ce ticket ferme : la garde d'origine se contentait qu'une
  // route figure dans l'UN des deux menus. Trente-trois destinations vivaient
  // donc au bureau seulement, sans que rien n'échoue — atteignables en tapant
  // l'URL, c'est-à-dire pas atteignables.
  test("aucune destination du bureau n'est hors de portée sur mobile", () => {
    const mobiles = new Set(destinationsMobiles());
    const inatteignables = NAV_SECTIONS_HREFS.filter((href) => !mobiles.has(href)).sort();

    expect(
      inatteignables,
      `Ces écrans figurent au menu du bureau et pas sur mobile : ` +
        `${inatteignables.join(", ")}. La feuille « Plus » rend NAV_SECTIONS ; ` +
        `si elle ne les couvre plus, c'est que la coquille a divergé.`,
    ).toEqual([]);
  });

  test("la barre du pouce reste COURTE — quatre entrées, pas quatorze", () => {
    // Une bande qu'il faut faire défiler horizontalement n'est pas une
    // navigation : on n'y trouve que ce qu'on savait déjà chercher. La
    // découverte passe par « Plus », qui ouvre le menu complet.
    expect(MOBILE_NAV_HREFS.length).toBeLessThanOrEqual(4);
  });

  test("`destinationsMobiles` couvre la barre ET la feuille", () => {
    // La garde ci-dessus ne vaut que si cette fonction dit la vérité sur ce
    // que la coquille rend. Elle est exportée pour ça, et lue par les deux.
    const toutes = destinationsMobiles();
    for (const href of MOBILE_NAV_HREFS) expect(toutes).toContain(href);
    for (const href of NAV_SECTIONS_HREFS) expect(toutes).toContain(href);
  });
});

describe("prospection — masquée hors des verticaux exposés aux travaux", () => {
  const prospection = NAV_SECTIONS
    .flatMap((section) => section.items)
    .find((item) => item.href === "/prospection")!;

  test("l'entrée existe et porte un prédicat de vertical", () => {
    expect(prospection).toBeDefined();
    expect(prospection.visibleForVertical).toBeTypeOf("function");
  });

  test("visible pour un vertical bâtiment", () => {
    expect(prospection.visibleForVertical!("batiment")).toBe(true);
  });

  test("masquée pour un vertical sans exposition travaux (restauration)", () => {
    expect(prospection.visibleForVertical!("restauration_chr")).toBe(false);
  });

  test("visible tant que le vertical n'est pas encore chargé (jamais masquée à tort)", () => {
    expect(prospection.visibleForVertical!(undefined)).toBe(true);
  });
});


/*
 * ── LE MENU DU COMPTABLE ──────────────────────────────────────────────────
 *
 * Ce filtre n'est PAS la protection : elle est côté serveur
 * (`PERIMETRE_API_PAR_ROLE`), parce qu'une URL reste tapable quoi qu'affiche
 * le menu. Il évite seulement d'offrir un lien qui répondrait 403.
 *
 * Le fondateur a constaté le 29/08/2026 que son comptable voyait « Envoi des
 * documents » — l'écran qui porte le mot de passe SMTP.
 */
describe('les routes ouvertes au comptable', () => {
  test('sa matière comptable lui est ouverte', () => {
    for (const r of ['/factures', '/avoirs', '/compte-resultat', '/classeur', '/rapports']) {
      expect(routeOuverteAuComptable(r), r).toBe(true);
    }
  });

  test('la marge et le prévisionnel aussi — il conseille', () => {
    expect(routeOuverteAuComptable('/marge')).toBe(true);
    expect(routeOuverteAuComptable('/previsionnel-tresorerie')).toBe(true);
  });

  /*
   * LA garde née du constat, et les commandes de l'entreprise avec elle.
   */
  test('les paramètres, l’envoi et la prospection lui sont fermés', () => {
    for (const r of ['/parametres', '/parametres/envoi', '/prospection', '/prospects', '/equipe', '/connecteurs']) {
      expect(routeOuverteAuComptable(r), r).toBe(false);
    }
  });

  test('une route inconnue est fermée par DÉFAUT — liste blanche', () => {
    expect(routeOuverteAuComptable('/un-ecran-de-demain')).toBe(false);
  });
});
