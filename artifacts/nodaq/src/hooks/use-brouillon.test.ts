/**
 * Le brouillon qui survit — ticket 4.20, lot D.
 *
 * Ce que ces tests protègent, dans l'ordre où ça compte :
 *
 *   a. une dictée interrompue se RETROUVE — c'est la raison d'être du hook,
 *      et le seul contenu du produit que l'utilisateur ne peut pas
 *      reconstituer ;
 *   b. un brouillon EXPLOITÉ disparaît — le ressusciter dans un devis suivant
 *      serait pire que de l'avoir perdu ;
 *   c. un brouillon PÉRIMÉ ne revient pas ;
 *   d. un stockage indisponible n'empêche JAMAIS l'écran de fonctionner.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBrouillon, lireBrouillon } from './use-brouillon';

const CLE = 'nodaq-brouillon:essai';

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a — une dictée interrompue se retrouve', () => {
  test('la valeur saisie est relue au montage suivant', () => {
    const premier = renderHook(() => useBrouillon('essai'));
    act(() => premier.result.current[1]('pose de cloison BA13, trente mètres carrés'));
    premier.unmount();

    // Nouveau montage : l'écran a été fermé, le navigateur a récupéré de la
    // mémoire, ou l'artisan a touché « Affaires » par erreur.
    const second = renderHook(() => useBrouillon('essai'));
    expect(second.result.current[0]).toBe('pose de cloison BA13, trente mètres carrés');
  });

  test('sans brouillon, la valeur initiale est respectée', () => {
    const { result } = renderHook(() => useBrouillon('essai', 'départ'));
    expect(result.current[0]).toBe('départ');
  });
});

describe('b — un brouillon exploité disparaît', () => {
  test('`oublier()` efface, et la frappe suivante ne le ressuscite pas', () => {
    const { result } = renderHook(() => useBrouillon('essai'));
    act(() => result.current[1]('du texte'));
    expect(localStorage.getItem(CLE)).toBeTruthy();

    act(() => result.current[2]());
    expect(localStorage.getItem(CLE)).toBeNull();

    // Le point : après « oublier », le hook ne doit plus rien réécrire — sinon
    // le texte déjà transformé en devis reviendrait au prochain passage.
    act(() => result.current[1]('encore'));
    expect(localStorage.getItem(CLE)).toBeNull();
  });

  test('vider la zone de texte efface le brouillon', () => {
    const { result } = renderHook(() => useBrouillon('essai'));
    act(() => result.current[1]('quelque chose'));
    act(() => result.current[1](''));
    expect(localStorage.getItem(CLE)).toBeNull();
  });
});

describe('c — un brouillon périmé ne revient pas', () => {
  test('au-delà d’un jour, il est effacé plutôt que restauré', () => {
    const hier = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem(CLE, JSON.stringify({ valeur: 'vieille dictée', ecritLe: hier }));

    // Restaurer une dictée de la semaine dernière dans un nouveau devis serait
    // pire que de l'avoir perdue : elle décrit un autre chantier.
    expect(lireBrouillon('essai')).toBeNull();
    expect(localStorage.getItem(CLE)).toBeNull();
  });

  test('dans la journée, il est restauré', () => {
    const toutALHeure = Date.now() - 60 * 60 * 1000;
    localStorage.setItem(CLE, JSON.stringify({ valeur: 'dictée du matin', ecritLe: toutALHeure }));
    expect(lireBrouillon('essai')).toBe('dictée du matin');
  });
});

describe('d — un stockage indisponible ne casse rien', () => {
  test('contenu illisible → aucune erreur, aucun brouillon', () => {
    localStorage.setItem(CLE, 'ceci n’est pas du JSON');
    expect(() => lireBrouillon('essai')).not.toThrow();
    expect(lireBrouillon('essai')).toBeNull();
  });

  test('écriture refusée (quota, navigation privée) → la saisie continue', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const { result } = renderHook(() => useBrouillon('essai'));
    // Perdre la reprise est acceptable ; empêcher l'écran de fonctionner ne
    // l'est pas — l'artisan doit pouvoir dicter, brouillon ou non.
    expect(() => act(() => result.current[1]('texte'))).not.toThrow();
    expect(result.current[0]).toBe('texte');
  });
});
