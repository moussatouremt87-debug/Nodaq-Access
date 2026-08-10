/**
 * Garde — une route PUBLIQUE ne se rend jamais dans l'AppShell.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Les routes publiques étaient rendues À L'INTÉRIEUR de l'AppShell. Le    ║
 * ║  client de l'artisan, sans aucune session, voyait donc la barre de       ║
 * ║  navigation complète du logiciel — Cockpit, Affaires, Factures, Marge,   ║
 * ║  Fiscal, Équipe, Connecteurs, Paramètres — et le sélecteur de thème.     ║
 * ║                                                                           ║
 * ║  Constaté à l'écran, en 390 px, sans session.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Deux dégâts. Le client croit être entré dans le logiciel de quelqu'un
 * d'autre, sur la page même où on lui demande de s'engager. Et quiconque
 * détient un lien de devis obtient la carte complète des fonctions du produit.
 *
 * Effet de bord du même défaut : `AppShell` appelle `useIsOwner()`, donc
 * `GET /api/auth/me`. La page publique émettait une requête authentifiée et
 * recevait 401 dans la console du client.
 *
 * Cette garde lit le SOURCE plutôt que d'importer `App.tsx`, qui tirerait
 * toute l'application. Même approche que la garde de navigation voisine.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE_APP = readFileSync(join(__dirname, "..", "App.tsx"), "utf8");

/**
 * Extrait le contenu du bloc `<AppShell> … </AppShell>`.
 *
 * Par appariement de balises, et non par une paresse de regex : l'AppShell
 * contient d'autres composants, et une expression non gourmande s'arrêterait
 * à la première balise fermante venue.
 */
function contenuAppShell(): string {
  const debut = SOURCE_APP.indexOf("<AppShell>");
  expect(debut, "<AppShell> introuvable dans App.tsx — la garde doit être mise à jour").toBeGreaterThan(-1);
  const fin = SOURCE_APP.indexOf("</AppShell>", debut);
  expect(fin, "</AppShell> introuvable").toBeGreaterThan(debut);
  return SOURCE_APP.slice(debut, fin);
}

/** Les chemins déclarés publics, lus depuis la constante d'App.tsx. */
function routesPubliques(): string[] {
  const bloc = /ROUTES_PUBLIQUES\s*=\s*\[([^\]]*)\]/.exec(SOURCE_APP);
  expect(
    bloc,
    "ROUTES_PUBLIQUES introuvable dans App.tsx. Cette garde la lit textuellement — " +
      "si la constante a été renommée, mettez la garde à jour plutôt que de la contourner.",
  ).not.toBeNull();
  return [...bloc![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe("routes publiques — hors de la coquille applicative", () => {
  test("la liste des routes publiques est lue et non vide", () => {
    const publiques = routesPubliques();
    expect(publiques.length).toBeGreaterThan(0);
    expect(publiques).toContain("/devis/accepter/:token");
  });

  test("AUCUNE route publique n'est rendue dans l'AppShell", () => {
    const shell = contenuAppShell();
    const fautives = routesPubliques().filter((chemin) => shell.includes(`"${chemin}"`));

    expect(
      fautives,
      `Ces routes publiques sont rendues DANS l'AppShell : ${fautives.join(", ")}.\n` +
        `Le client de l'artisan y verrait la navigation interne complète, et la page ` +
        `émettrait GET /api/auth/me. Montez-les au-dessus, dans le Switch de AppRouter.`,
    ).toEqual([]);
  });

  test("la page d'acceptation est bien montée AVANT l'AppShell", () => {
    const positionRoute = SOURCE_APP.indexOf('"/devis/accepter/:token"');
    const positionShell = SOURCE_APP.indexOf("<AppShell>");
    expect(positionRoute).toBeGreaterThan(-1);
    expect(
      positionRoute < positionShell,
      "La route d'acceptation doit être déclarée avant l'AppShell.",
    ).toBe(true);
  });

  test("l'AppShell contient bien les routes MÉTIER — la garde n'est pas vide", () => {
    // Sans cette assertion, supprimer tout le contenu de l'AppShell ferait
    // passer la garde précédente au vert pour la pire des raisons.
    const shell = contenuAppShell();
    expect(shell).toContain('"/factures"');
    expect(shell).toContain('"/affaires"');
  });
});
