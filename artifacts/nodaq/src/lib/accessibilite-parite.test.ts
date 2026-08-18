/**
 * US-A8.2, AC2 — l'audit d'accessibilité fait partie de « terminé ».
 *
 * C'est LE test de cette story. L'audit lui-même
 * (`accessibilite-audit.test.tsx`) vérifie les écrans qu'on lui donne ; celui-ci
 * vérifie qu'on les lui donne TOUS. Sans lui, livrer un écran sectoriel sans
 * l'inscrire passerait sans bruit, et l'audit continuerait de rendre du vert
 * sur le périmètre d'hier — exactement le défaut que le contexte de la story
 * décrit : « un audit mené sur les seuls écrans bâtiment ne garantit rien sur
 * les futurs écrans sectoriels ».
 *
 * Lecture du SOURCE de `App.tsx` plutôt qu'import, comme
 * `app-routes.test.ts` : importer tirerait toute l'application dans un test
 * qui ne fait que comparer des chaînes.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ECRANS_AUDITES, SOCLE_CONNU, REGLES_WCAG } from './accessibilite';

const SOURCE_APP = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');

/** Tous les `path="…"` déclarés dans `App.tsx`. */
function cheminsDeclares(): string[] {
  const trouves = [...SOURCE_APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]!);
  expect(
    trouves.length,
    'aucune route lue dans App.tsx — la garde ne compare plus rien',
  ).toBeGreaterThan(20);
  return trouves;
}

const cheminsRegistre = ECRANS_AUDITES.map((e) => e.chemin);

describe("a — AC2 : aucun écran ne se livre hors du périmètre d'audit", () => {
  test("tout écran déclaré dans App.tsx figure au registre d'accessibilité", () => {
    const manquants = cheminsDeclares().filter((c) => !cheminsRegistre.includes(c));
    expect(
      manquants,
      "ces écrans sont livrés sans être audités — ajouter une entrée dans src/lib/accessibilite.ts, avec `charger` si l'écran se rend seul, sinon `exempt` et la raison",
    ).toEqual([]);
  });

  test('le registre ne décrit pas des écrans qui ont disparu', () => {
    // Un chemin resté au registre après suppression de la route donnerait un
    // audit qui tourne dans le vide, et un compteur d'écrans couverts faux.
    const declares = cheminsDeclares();
    const fantomes = cheminsRegistre.filter((c) => !declares.includes(c));
    expect(fantomes, 'ces chemins ne sont plus routés dans App.tsx').toEqual([]);
  });

  test('aucun doublon au registre', () => {
    expect(new Set(cheminsRegistre).size).toBe(cheminsRegistre.length);
  });
});

describe('b — une entrée dit clairement si elle est auditée', () => {
  test('`charger` ou `exempt`, jamais les deux, jamais aucun', () => {
    for (const e of ECRANS_AUDITES) {
      const audite = Boolean(e.charger);
      const dispense = Boolean(e.exempt);
      expect(
        audite !== dispense,
        `« ${e.chemin} » : une entrée doit soit se charger, soit porter une exemption motivée`,
      ).toBe(true);
    }
  });

  test('une exemption porte une raison, pas un mot', () => {
    // Une exemption est un trou dans la garde. Elle doit se lire comme tel, et
    // pouvoir être contestée en relecture — donc dire ce qui empêche l'audit.
    for (const e of ECRANS_AUDITES) {
      if (!e.exempt) continue;
      expect(
        e.exempt.trim().length,
        `« ${e.chemin} » : exemption sans justification lisible`,
      ).toBeGreaterThan(60);
    }
  });

  test('la majorité des écrans est réellement auditée', () => {
    // Sans ce garde-fou, exempter tout le monde rendrait la suite verte tout en
    // ne vérifiant plus rien — la forme la plus coûteuse de faux vert.
    const audites = ECRANS_AUDITES.filter((e) => e.charger).length;
    expect(
      audites / ECRANS_AUDITES.length,
      `seulement ${audites} écrans audités sur ${ECRANS_AUDITES.length}`,
    ).toBeGreaterThan(0.8);
  });
});

describe('c — le socle reste rattaché à des écrans réels', () => {
  test('toute clé du socle est un chemin du registre', () => {
    const orphelines = Object.keys(SOCLE_CONNU).filter((c) => !cheminsRegistre.includes(c));
    expect(orphelines, 'ces entrées de socle ne correspondent à aucun écran').toEqual([]);
  });

  test("le socle ne couvre aucun écran exempté", () => {
    // Un écran non audité ne peut pas avoir de violations constatées : la ligne
    // serait une affirmation que rien ne produit.
    const exemptes = ECRANS_AUDITES.filter((e) => e.exempt).map((e) => e.chemin);
    for (const chemin of Object.keys(SOCLE_CONNU)) {
      expect(exemptes, `« ${chemin} » est exempté mais figure au socle`).not.toContain(chemin);
    }
  });

  test('aucune règle inscrite deux fois pour un même écran', () => {
    for (const [chemin, regles] of Object.entries(SOCLE_CONNU)) {
      expect(new Set(regles).size, `doublon de règle sur « ${chemin} »`).toBe(regles.length);
    }
  });
});

describe("d — la page hôte n'empêche pas d'agrandir", () => {
  // L'audit de `accessibilite-audit.test.tsx` rend des COMPOSANTS : il ne voit
  // jamais le `<head>` de `index.html`. Cette règle-là ne peut donc être tenue
  // qu'ici. Elle valait le détour : `maximum-scale=1` y bloquait le zoom, sur
  // tous les écrans à la fois — trouvé en faisant tourner axe dans un vrai
  // navigateur, pas en jsdom.
  const HTML = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

  test('la balise viewport existe', () => {
    expect(HTML).toMatch(/<meta\s+name="viewport"/);
  });

  test("elle ne verrouille pas l'échelle", () => {
    const meta = HTML.match(/<meta\s+name="viewport"[^>]*>/)![0];
    expect(meta, 'WCAG 1.4.4 : la page doit pouvoir être agrandie').not.toMatch(
      /maximum-scale|user-scalable\s*=\s*no/,
    );
  });
});

describe('e — le périmètre de règles reste celui de l’obligation', () => {
  test('les quatre étiquettes WCAG A/AA, et rien de plus', () => {
    // `best-practice` glissé ici transformerait une obligation légale en
    // préférence d'équipe, et la première discussion sur une règle discutable
    // ferait désarmer la garde entière.
    expect([...REGLES_WCAG].sort()).toEqual(['wcag21a', 'wcag21aa', 'wcag2a', 'wcag2aa'].sort());
  });
});
