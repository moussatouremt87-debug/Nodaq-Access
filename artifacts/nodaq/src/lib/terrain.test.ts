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
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(resolve(import.meta.dirname, '../index.css'), 'utf8');

/** Toutes les sources `.tsx` du front, hors tests — lues, pas devinées. */
function fichiersTsx(): Array<{ chemin: string; contenu: string }> {
  const racine = resolve(import.meta.dirname, '..');
  const sortie: Array<{ chemin: string; contenu: string }> = [];
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = resolve(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin);
      else if (entree.name.endsWith('.tsx') && !entree.name.includes('.test.')) {
        sortie.push({ chemin: chemin.replace(racine + '/', ''), contenu: readFileSync(chemin, 'utf8') });
      }
    }
  };
  parcourir(racine);
  return sortie;
}

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

// ── d. La hauteur d'écran, sur un téléphone (ticket 4.20) ──────────────────

describe('hauteur de fenêtre — `min-h-screen` ment sur un téléphone', () => {
  /**
   * `100vh` vaut la hauteur de la fenêtre BARRE D'URL RÉTRACTÉE. Tant qu'elle
   * est déployée — c'est-à-dire à l'ouverture, donc au moment où l'écran de
   * connexion s'affiche — le contenu dépasse d'une centaine de pixels : le
   * bouton « Se connecter » se retrouve sous le pli, sur un écran qui semble
   * pourtant tenir. `100dvh` suit la hauteur RÉELLEMENT visible.
   *
   * La coquille applicative l'utilisait déjà ; les écrans hors coquille —
   * connexion, inscription, MFA, acceptation de devis — étaient restés en
   * arrière. Ce sont précisément les portes d'entrée.
   */
  const ECRANS = [
    'login', 'register', 'mfa', 'devis-accepter', 'onboarding', 'membre-accepter',
  ];

  test.each(ECRANS)('%s n’utilise pas min-h-screen', (nom) => {
    const source = readFileSync(
      resolve(import.meta.dirname, `../pages/${nom}.tsx`),
      'utf8',
    );
    expect(
      source,
      `${nom}.tsx utilise min-h-screen : sur un téléphone, la barre d'URL ` +
        `pousse le bas du contenu hors de l'écran. Utiliser min-h-[100dvh].`,
    ).not.toMatch(/min-h-screen/);
  });
});

// ── e. Lisibilité en extérieur (ticket 4.20) ───────────────────────────────

describe('lisibilité — le plein soleil, pas le bureau', () => {
  /**
   * Deux mesures, pour deux causes distinctes de disparition d'un texte
   * dehors : sa TAILLE, et son OPACITÉ.
   *
   * L'opacité mérite un mot : le contraste vérifié plus haut porte sur les
   * JETONS. Un `text-foreground/40` passe sous cette garantie — Tailwind
   * mélange la couleur au fond, et le ratio calculé sur les jetons ne dit
   * plus rien du résultat. C'est un trou qui ne se voit dans aucun test de
   * couleur.
   */
  test('un plancher de taille existe pour les pointeurs imprécis', () => {
    const bloc = blocPointeurGrossier();
    expect(bloc, 'le bloc `pointer: coarse` a disparu').toBeTruthy();
    // Les étiquettes de 10 et 11 px sont des repères qui portent du sens
    // (« proposé », « à compléter ») : illisibles dehors, elles ne portent
    // plus rien.
    expect(bloc!, 'aucun plancher de taille de texte').toMatch(/font-size:\s*1[23]px/);
  });

  test('aucun texte ne descend sous 60 % d’opacité', () => {
    const sources = fichiersTsx();
    expect(sources.length, 'aucune source lue').toBeGreaterThan(20);

    const faibles: string[] = [];
    for (const { chemin, contenu } of sources) {
      for (const m of contenu.matchAll(/text-[a-z-]+\/(\d{1,2})\b/g)) {
        if (Number(m[1]) < 60) faibles.push(`${chemin} → ${m[0]}`);
      }
    }

    expect(
      faibles,
      `Ces textes passent sous 60 % d'opacité : dehors, ils disparaissent. ` +
        `Le contraste vérifié sur les jetons ne les couvre pas — l'opacité ` +
        `s'applique après.\n  ${faibles.join('\n  ')}`,
    ).toEqual([]);
  });
});
