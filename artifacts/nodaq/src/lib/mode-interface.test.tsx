/**
 * US-A8.4 — mode simplifié.
 *
 * Ce que ces tests protègent :
 *   a. AC1 — en mode simplifié, il ne reste que l'essentiel, et l'essentiel
 *      contient bien ce que la story nomme : devis, facture, planning ;
 *   b. AC2 — « afficher tout » rend visible exactement le complément, et rien
 *      n'a jamais été supprimé du registre ;
 *   c. AC3 — basculer ne perd aucune donnée ni configuration ;
 *   d. LE POINT D'ATTENTION, en garde structurelle — « un habillage de
 *      l'interface existante, pas une version de l'application à maintenir
 *      séparément ». C'est le seul critère qui ne se lit pas dans le
 *      comportement : il se lit dans la FORME du code, et il se perd
 *      silencieusement le jour où quelqu'un recopiera une liste d'écrans.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAV_SECTIONS, MOBILE_NAV } from './nav';
import { visibleDansMode, lireMode } from '@/contexts/mode-interface';

const STORAGE_KEY = 'nodaq-mode-interface';

const toutesLesEntrees = NAV_SECTIONS.flatMap((s) => s.items);
const visibles = (mode: 'simplifie' | 'complet', afficherTout = false) =>
  toutesLesEntrees.filter((i) => visibleDansMode(i, mode, afficherTout)).map((i) => i.href);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

// ── a. AC1 ─────────────────────────────────────────────────────────────────

describe("a — AC1 : le mode simplifié ne laisse que l'essentiel", () => {
  test('le menu réduit est nettement plus court', () => {
    const reduit = visibles('simplifie');
    const complet = visibles('complet');
    expect(complet.length).toBeGreaterThan(20);
    // Sans marge nette, un « mode simplifié » qui masque deux entrées sur
    // trente ne rendrait pas service à l'utilisateur visé.
    expect(reduit.length).toBeLessThan(complet.length / 2);
  });

  test('les fonctions que la story nomme sont conservées', () => {
    const reduit = visibles('simplifie');
    // « devis/proposition, facture, planning basique » — AC1, mot pour mot.
    for (const href of ['/devis', '/factures', '/pointages']) {
      expect(reduit, `« ${href} » doit rester visible en mode simplifié`).toContain(href);
    }
  });

  test('les fonctions avancées sont bien masquées', () => {
    const reduit = visibles('simplifie');
    for (const href of ['/marge', '/compte-resultat', '/journal-decisions', '/reprise']) {
      expect(reduit, `« ${href} » n'a rien à faire dans un menu simplifié`).not.toContain(href);
    }
  });

  test("une entrée sans drapeau est avancée — le défaut ne réouvre pas le menu", () => {
    // Le sens du défaut est le cœur du dispositif : une entrée ajoutée demain
    // sans que personne n'ait tranché reste MASQUÉE. L'inverse ferait
    // repousser le menu complet par inadvertance.
    expect(visibleDansMode({}, 'simplifie', false)).toBe(false);
    expect(visibleDansMode({ essentiel: true }, 'simplifie', false)).toBe(true);
  });
});

// ── b. AC2 ─────────────────────────────────────────────────────────────────

describe('b — AC2 : rien n’est supprimé, tout reste atteignable', () => {
  test('« afficher tout » rend exactement le menu complet', () => {
    expect(visibles('simplifie', true).sort()).toEqual(visibles('complet').sort());
  });

  test('le registre lui-même ne perd jamais d’entrée', () => {
    // Le mode est un FILTRE d'affichage. S'il retirait des entrées de
    // `NAV_SECTIONS`, « afficher tout » ne pourrait plus rien restaurer.
    const avant = toutesLesEntrees.length;
    visibles('simplifie');
    visibles('complet', true);
    expect(NAV_SECTIONS.flatMap((s) => s.items).length).toBe(avant);
  });
});

// ── c. AC3 ─────────────────────────────────────────────────────────────────

describe('c — AC3 : la transition ne perd rien', () => {
  test('seule sa propre clé est écrite ; le thème et le reste sont intacts', () => {
    localStorage.setItem('nodaq-theme', 'light');
    localStorage.setItem('autre-reglage', 'valeur');

    localStorage.setItem(STORAGE_KEY, 'simplifie');
    expect(lireMode()).toBe('simplifie');
    localStorage.setItem(STORAGE_KEY, 'complet');
    expect(lireMode()).toBe('complet');

    expect(localStorage.getItem('nodaq-theme')).toBe('light');
    expect(localStorage.getItem('autre-reglage')).toBe('valeur');
  });

  test('une valeur illisible retombe sur le mode complet, jamais sur simplifié', () => {
    // Personne ne doit se retrouver en interface réduite sans l'avoir demandé.
    localStorage.setItem(STORAGE_KEY, 'nimporte-quoi');
    expect(lireMode()).toBe('complet');
    localStorage.removeItem(STORAGE_KEY);
    expect(lireMode()).toBe('complet');
  });
});

// ── d. Le point d'attention, en garde structurelle ─────────────────────────

describe("d — un habillage, pas une seconde application", () => {
  const SRC = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  test("le contexte de mode ne connaît AUCUN écran", () => {
    // Une liste de chemins ici serait le premier pas vers les deux
    // interfaces que la story refuse : deux endroits à tenir d'accord, dont
    // un que personne ne relit.
    const src = SRC('contexts/mode-interface.tsx');
    const corps = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const chemins: string[] = corps.match(/['"]\/[a-z-]+['"]/g) ?? [];
    expect(
      chemins,
      "des chemins d'écran sont écrits en dur dans mode-interface.tsx — ce qui est essentiel se déclare sur NavItem.essentiel",
    ).toEqual([]);
  });

  test("la coquille ne liste pas non plus les écrans du mode", () => {
    const src = SRC('components/app-shell.tsx');
    const clause = src.slice(src.indexOf('const peutVoir'), src.indexOf('return ('));
    const corps = clause.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    // `/cabinet` est l'exception documentée d'US-A5.2, antérieure et sans
    // rapport avec le mode ; toute autre serait une liste qui commence.
    const trouves: string[] = corps.match(/['"]\/[a-z-]+['"]/g) ?? [];
    const chemins = trouves.filter((c) => !c.includes('cabinet'));
    expect(chemins, 'la clause de visibilité énumère des écrans').toEqual([]);
  });

  test("l'essentiel est déclaré sur les entrées, une seule fois", () => {
    const essentiels = toutesLesEntrees.filter((i) => i.essentiel).map((i) => i.href);
    expect(essentiels.length).toBeGreaterThan(0);
    expect(new Set(essentiels).size, 'un href essentiel déclaré deux fois').toBe(essentiels.length);
  });
});

// ── e. Les deux menus restent d'accord ─────────────────────────────────────

describe('e — menu latéral et menu mobile ne divergent pas', () => {
  test('un href essentiel d’un côté l’est de l’autre', () => {
    const essentielsLateral = new Set(
      toutesLesEntrees.filter((i) => i.essentiel).map((i) => i.href),
    );
    for (const item of MOBILE_NAV) {
      // Seuls les href présents des DEUX côtés sont comparables : le menu
      // mobile est plus court, il ne porte pas toutes les entrées.
      if (!toutesLesEntrees.some((i) => i.href === item.href)) continue;
      expect(
        Boolean(item.essentiel),
        `« ${item.href} » : essentiel d'un côté, pas de l'autre — les deux menus divergent`,
      ).toBe(essentielsLateral.has(item.href));
    }
  });
});
