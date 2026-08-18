/**
 * US-A8.1, AC2 — la dictée demande un micro traité, sur tous les chemins.
 *
 * ── Ce que ce fichier NE prouve PAS ──────────────────────────────────────
 * Il ne prouve pas que la transcription est fiable dans une cuisine. L'AC2
 * demande une fiabilité « comparable à celle mesurée sur chantier » : aucune
 * mesure de ce genre n'existe dans ce dépôt — ni taux d'erreur, ni corpus
 * audio, ni relevé — donc il n'y a aucune référence à laquelle comparer.
 * Fabriquer un seuil ici donnerait un vert qui ne signifierait rien.
 *
 * Ce qui est prouvable, et qui est prouvé ici : le produit DEMANDE un
 * traitement du signal, partout, au lieu de laisser chaque navigateur en
 * décider seul.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { useDictee, CONTRAINTES_AUDIO } from '@/hooks/use-dictee';

// ── Le micro, bouchonné ────────────────────────────────────────────────────

const getUserMedia = vi.fn();

class FauxRecorder {
  static isTypeSupported = () => true;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: MediaStream, _o: unknown) {}
  start() {}
  stop() {
    this.onstop?.();
  }
}

beforeEach(() => {
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: () => {} }] });
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', FauxRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a — AC2 : le micro est demandé traité, pas brut', () => {
  test('`demarrer` passe les contraintes de réduction de bruit', async () => {
    const { result } = renderHook(() => useDictee(() => {}));
    await act(async () => {
      await result.current.demarrer();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const contraintes = getUserMedia.mock.calls[0]![0] as MediaStreamConstraints;

    // `{ audio: true }` laisserait chaque navigateur décider — c'est le
    // défaut qu'on corrige, et il passerait un test qui se contenterait de
    // vérifier qu'un micro a été demandé.
    expect(contraintes.audio, "le micro est demandé sans aucune contrainte").not.toBe(true);
    const audio = contraintes.audio as MediaTrackConstraints;
    expect(audio.noiseSuppression).toBe(true);
    expect(audio.echoCancellation).toBe(true);
    expect(audio.autoGainControl).toBe(true);
  });

  test('la constante exportée porte les trois traitements', () => {
    const audio = CONTRAINTES_AUDIO.audio as MediaTrackConstraints;
    expect(audio.noiseSuppression).toBe(true);
    expect(audio.echoCancellation).toBe(true);
    expect(audio.autoGainControl).toBe(true);
  });
});

// ── b. Garde à sortie unique ───────────────────────────────────────────────

/**
 * Modelée sur `llm-single-exit.test.ts` : le défaut qu'on répare n'est pas
 * l'absence de contraintes à un endroit, c'est qu'il y avait DEUX captations
 * indépendantes (`use-dictee.ts` et `use-chat.ts`) alors que l'en-tête de
 * `use-dictee.ts` annonçait avoir extrait la mécanique pour éviter
 * précisément cela. Corriger les deux sans garde laisserait la troisième
 * copie arriver dans six mois, muette.
 */
function fichiersSource(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const complet = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(e.name)) continue;
      out = out.concat(fichiersSource(complet));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      if (statSync(complet).isFile()) out.push(complet);
    }
  }
  return out;
}

describe('b — toute captation passe par la constante partagée', () => {
  const RACINE = resolve(import.meta.dirname, '..');

  test('aucun `getUserMedia` avec un audio nu', () => {
    const fautifs: string[] = [];
    for (const f of fichiersSource(RACINE)) {
      const src = readFileSync(f, 'utf8');
      // `{ audio: true }` — la forme exacte qui délègue au navigateur.
      if (/getUserMedia\(\s*\{[^)]*audio\s*:\s*true/.test(src)) {
        fautifs.push(f.replace(RACINE, 'src'));
      }
    }
    expect(
      fautifs,
      'ces fichiers captent le micro sans contraintes — importer CONTRAINTES_AUDIO depuis @/hooks/use-dictee',
    ).toEqual([]);
  });

  test('chaque appel à getUserMedia utilise CONTRAINTES_AUDIO', () => {
    const appelants: string[] = [];
    for (const f of fichiersSource(RACINE)) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('getUserMedia(')) continue;
      appelants.push(f.replace(RACINE, 'src'));
      expect(src, `${f} appelle getUserMedia sans la constante partagée`).toContain(
        'getUserMedia(CONTRAINTES_AUDIO)',
      );
    }
    // Les deux chemins connus : le micro flottant et la discussion. Si ce
    // compte tombe à un, c'est qu'un chemin a disparu — ou que la collecte de
    // fichiers ne voit plus rien, auquel cas la boucle ci-dessus ne prouvait
    // déjà plus rien.
    expect(appelants.length, `chemins de captation trouvés : ${appelants.join(', ')}`)
      .toBeGreaterThanOrEqual(2);
  });
});
