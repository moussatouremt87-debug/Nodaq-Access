/**
 * US-A8.1 — l'interface tient dans les conditions réelles du terrain.
 *
 * Ces gardes lisent la FEUILLE DE STYLE, pas un composant rendu : jsdom
 * n'applique ni les requêtes de média ni la mise en page, donc aucun test de
 * rendu ne peut prouver qu'un bouton fait 44 px sur un téléphone. Ce qui est
 * prouvable ici, et qui suffit, c'est que la règle EXISTE, qu'elle porte le
 * bon seuil, et qu'elle ne dépend d'aucun secteur.
 *
 * Ce qu'elles protègent :
 *   a. AC1 — les cibles tactiles montent à 44 px sur pointeur imprécis ;
 *   b. le point d'attention de la story — l'accommodation est GÉNÉRIQUE, pas
 *      réservée au bâtiment. C'est la question que la story pose vraiment ;
 *   c. AC3 — le contraste des jetons reste au-dessus du seuil AA, dans les
 *      DEUX thèmes. Il l'est aujourd'hui ; cette garde empêche qu'un réglage
 *      de couleur le fasse tomber sans que personne ne s'en aperçoive.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(resolve(import.meta.dirname, '../index.css'), 'utf8');

/** Seuil retenu pour un doigt ganté ou imprécis. */
const CIBLE_MINIMALE_PX = 44;

/** Seuil WCAG AA pour du texte de taille normale. */
const CONTRASTE_AA = 4.5;

// ── Extraction du bloc « pointeur grossier » ───────────────────────────────

/**
 * Le corps du `@media (pointer: coarse)`, accolades équilibrées.
 * Une regex non gloutonne s'arrêterait à la première accolade fermante, donc
 * au premier sélecteur — elle ne verrait jamais le reste du bloc.
 */
function blocPointeurGrossier(): string | null {
  const debut = CSS.search(/@media\s*\(\s*pointer\s*:\s*coarse\s*\)\s*\{/);
  if (debut === -1) return null;
  const ouvrante = CSS.indexOf('{', debut);
  let profondeur = 0;
  for (let i = ouvrante; i < CSS.length; i++) {
    if (CSS[i] === '{') profondeur++;
    else if (CSS[i] === '}') {
      profondeur--;
      if (profondeur === 0) return CSS.slice(ouvrante + 1, i);
    }
  }
  return null;
}

describe("a — AC1 : les cibles tactiles s'agrandissent sur pointeur imprécis", () => {
  test('la règle existe', () => {
    expect(
      blocPointeurGrossier(),
      "aucun bloc `@media (pointer: coarse)` dans index.css — l'AC1 n'est pas tenu",
    ).toBeTruthy();
  });

  test(`elle porte un seuil d'au moins ${CIBLE_MINIMALE_PX} px`, () => {
    const bloc = blocPointeurGrossier()!;
    const hauteurs = [...bloc.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
    const largeurs = [...bloc.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1]));

    expect(hauteurs.length, 'aucune `min-height` déclarée').toBeGreaterThan(0);
    expect(largeurs.length, 'aucune `min-width` déclarée').toBeGreaterThan(0);

    // Les remises à zéro (`min-height: 0`) sont les exceptions assumées — un
    // lien au fil du texte n'est pas une commande. Seules les valeurs qui
    // PRÉTENDENT dimensionner une cible sont soumises au seuil.
    for (const v of [...hauteurs, ...largeurs].filter((v) => v > 0)) {
      expect(v, `une cible déclarée à ${v}px passe sous le seuil`).toBeGreaterThanOrEqual(
        CIBLE_MINIMALE_PX,
      );
    }
  });

  test('les commandes ordinaires sont couvertes, pas seulement un composant', () => {
    const bloc = blocPointeurGrossier()!;
    // Si seul `button` était visé, un onglet, une case à cocher ou un champ
    // resteraient à 36 px — l'AC1 parle des « zones tactiles principales ».
    for (const selecteur of ['button', 'input', 'select', "[role='tab']"]) {
      expect(bloc, `« ${selecteur} » n'est pas couvert`).toContain(selecteur);
    }
  });
});

// ── b. Le point d'attention : généricité ───────────────────────────────────

describe("b — l'accommodation ne dépend d'aucun secteur", () => {
  test('la règle tactile ne mentionne aucun métier', () => {
    const bloc = blocPointeurGrossier()!;
    // Un `html[data-metier='batiment']` ici, et le cuisinier aux mains grasses
    // garderait des cibles de 32 px. C'est exactement le « dimensionnement
    // spécifique au bâtiment » que l'AC1 interdit.
    for (const secteur of [
      'batiment',
      'paysage',
      'restauration',
      'sante',
      'metier',
      'vertical',
    ]) {
      expect(
        bloc.toLowerCase(),
        `la règle tactile est conditionnée à « ${secteur} »`,
      ).not.toContain(secteur);
    }
  });

  test('le micro reste monté pour tous les secteurs', () => {
    // La seule accommodation terrain qui préexistait. La story demande de
    // vérifier sa généricité — elle se vérifie ici : il est dans la coquille
    // applicative, sans garde de secteur autour.
    const shell = readFileSync(
      resolve(import.meta.dirname, '../components/app-shell.tsx'),
      'utf8',
    );
    const ligne = shell.split('\n').find((l) => l.includes('<MicroFlottant'));
    expect(ligne, 'le micro flottant a disparu de la coquille').toBeTruthy();
    expect(ligne!, 'le micro est devenu conditionnel').not.toMatch(/vertical|metier|&&/);
  });
});

// ── c. AC3 : le contraste tient dans les deux thèmes ───────────────────────

/** `--jeton: H S% L%` → [H, S, L]. */
function jetons(portee: string): Map<string, [number, number, number]> {
  const table = new Map<string, [number, number, number]>();
  for (const m of portee.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
    table.set(m[1]!, [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  return table;
}

function versRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const hn = h / 360;
  const sn = s / 100;
  const ln = l / 100;
  const f = (n: number) => {
    const k = (n + hn * 12) % 12;
    const a = sn * Math.min(ln, 1 - ln);
    return ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

function luminance(rgb: [number, number, number]): number {
  const l = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(versRgb(a));
  const lb = luminance(versRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Les deux portées de jetons : `:root` (clair) puis `.dark`. Découpées sur la
 * position de `.dark` — chaque bloc redéfinit le même jeu de noms, donc une
 * seule table écraserait le thème clair par le thème sombre.
 */
function portees(): { clair: string; sombre: string } {
  const iSombre = CSS.search(/\.dark\s*\{/);
  expect(iSombre, 'aucun bloc `.dark` dans index.css').toBeGreaterThan(-1);
  return { clair: CSS.slice(0, iSombre), sombre: CSS.slice(iSombre) };
}

/** Couples texte/fond que l'utilisateur lit réellement. */
const COUPLES: readonly (readonly [string, string])[] = [
  ['foreground', 'background'],
  ['muted-foreground', 'background'],
  ['card-foreground', 'card'],
  ['muted-foreground', 'card'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['sidebar-foreground', 'sidebar'],
  ['accent-foreground', 'accent'],
];

describe('c — AC3 : le contraste des jetons reste lisible', () => {
  const { clair, sombre } = portees();

  for (const [nomTheme, portee] of [
    ['clair', clair],
    ['sombre', sombre],
  ] as const) {
    test(`thème ${nomTheme} : tous les couples passent AA`, () => {
      const table = jetons(portee);
      let verifies = 0;
      for (const [texte, fond] of COUPLES) {
        const a = table.get(texte);
        const b = table.get(fond);
        // Un jeton absent d'une portée (ex. un jeton propre au sombre) n'est
        // pas un échec ; un couple présent qui passe sous le seuil, si.
        if (!a || !b) continue;
        verifies++;
        expect(
          ratio(a, b),
          `thème ${nomTheme} — ${texte} sur ${fond} : contraste insuffisant`,
        ).toBeGreaterThanOrEqual(CONTRASTE_AA);
      }
      // Sans cela, une erreur d'extraction rendrait le test vert sans avoir
      // rien comparé — le pire des résultats.
      expect(verifies, 'aucun couple n’a pu être évalué').toBeGreaterThanOrEqual(5);
    });
  }
});
