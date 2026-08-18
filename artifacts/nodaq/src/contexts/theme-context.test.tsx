/**
 * US-A8.1, AC3 — le thème suit le système tant que l'utilisateur n'a pas
 * tranché, et les DEUX décideurs sont d'accord.
 *
 * ── Pourquoi évaluer le script de `index.html` ───────────────────────────
 * Le thème est décidé à deux endroits, et il ne peut pas en être autrement :
 * le script anti-flash s'exécute avant que le bundle n'existe, donc avant que
 * `readTheme` ne puisse rien dire. Le premier rendu vient de l'un, la suite de
 * l'autre.
 *
 * Un désaccord entre les deux ne casse aucun test classique — il produit un
 * BASCULEMENT visible : l'écran s'affiche sombre, puis passe au clair. Le
 * seul moyen de l'attraper est de faire tourner le vrai script et de comparer
 * son verdict à celui de `readTheme`, sur la même matrice d'entrées. C'est ce
 * que fait ce fichier ; il lit `index.html`, il ne le recopie pas.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/contexts/theme-context';

const STORAGE_KEY = 'nodaq-theme';

/** Le corps du script anti-flash, extrait de `index.html`. */
function scriptAntiFlash(): string {
  const html = readFileSync(resolve(import.meta.dirname, '../../index.html'), 'utf8');
  const m = html.match(/<script>([\s\S]*?nodaq-theme[\s\S]*?)<\/script>/);
  expect(m, "le script anti-flash a disparu de index.html").toBeTruthy();
  return m![1]!;
}

/** Installe `matchMedia` : `clair` dit ce que le système préfère. */
function systemePrefere(clair: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-color-scheme: light') ? clair : !clair,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  // `readTheme` interroge `window.matchMedia`, le script `matchMedia` global.
  // En jsdom les deux désignent le même objet, mais on ne le suppose pas.
  (window as unknown as { matchMedia: unknown }).matchMedia = globalThis.matchMedia;
}

/** Le verdict du script anti-flash : `true` s'il applique le sombre. */
function verdictScript(): boolean {
  document.documentElement.classList.remove('dark');
  new Function(scriptAntiFlash())();
  return document.documentElement.classList.contains('dark');
}

/** Le verdict de `readTheme`, lu à travers le contexte qui l'utilise. */
function verdictContexte(): boolean {
  const { result, unmount } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
  const sombre = result.current.theme === 'dark';
  unmount();
  return sombre;
}

/** (choix stocké, préférence système clair) → sombre attendu ? */
const MATRICE: readonly (readonly [string | null, boolean, boolean, string])[] = [
  [null, false, true, 'rien de stocké, système sombre → sombre'],
  [null, true, false, 'rien de stocké, système clair → clair'],
  ['dark', true, true, 'choix sombre explicite, système clair → sombre'],
  ['light', false, false, 'choix clair explicite, système sombre → clair'],
  ['nimporte-quoi', true, false, 'valeur stockée illisible → on retombe sur le système'],
];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('a — AC3 : le système décide tant que l’utilisateur n’a pas tranché', () => {
  for (const [stocke, systemeClair, sombreAttendu, libelle] of MATRICE) {
    test(libelle, () => {
      if (stocke !== null) localStorage.setItem(STORAGE_KEY, stocke);
      systemePrefere(systemeClair);
      expect(verdictContexte()).toBe(sombreAttendu);
    });
  }
});

describe('b — les deux décideurs tranchent pareil', () => {
  for (const [stocke, systemeClair, sombreAttendu, libelle] of MATRICE) {
    test(`${libelle} — script anti-flash et contexte d’accord`, () => {
      if (stocke !== null) localStorage.setItem(STORAGE_KEY, stocke);
      systemePrefere(systemeClair);

      const script = verdictScript();
      const contexte = verdictContexte();

      expect(script, 'le script anti-flash a changé de verdict').toBe(sombreAttendu);
      expect(
        contexte,
        `désaccord : le premier rendu serait ${script ? 'sombre' : 'clair'} puis basculerait`,
      ).toBe(script);
    });
  }
});

describe('c — un choix explicite survit', () => {
  test('basculer écrit la préférence, et elle gagne sur le système', () => {
    systemePrefere(true); // système clair
    const { result, unmount } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.theme).toBe('light');
    result.current.toggle();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    unmount();

    // Le système n'a pas changé ; le choix, lui, doit tenir.
    expect(verdictContexte()).toBe(true);
    expect(verdictScript()).toBe(true);
  });
});
