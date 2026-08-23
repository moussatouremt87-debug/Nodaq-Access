/*
 * Facturer le temps depuis l'écran des heures — US-A2.4, US-B5.4.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 * La PR précédente a livré la route et ses tests, et l'a dit clairement :
 * « l'écran n'est pas branché, rien ne l'appelle encore ». C'est le défaut
 * que la PR #178 avait corrigé ailleurs — une fonctionnalité complète et
 * inaccessible — et il ne devait pas revenir.
 *
 * Ces tests éprouvent le CHEMIN D'USAGE : décocher une heure, la voir sortir
 * de ce qui part au serveur, et déclencher la facturation depuis les heures
 * qu'elle facture.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Pointages from './pointages';

const envois: Array<{ url: string; methode?: string; corps: Record<string, unknown> | null }> = [];

/** Le récapitulatif que le serveur rend. Modifiable par test. */
let recap: unknown;

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    envois.push({
      url,
      methode: init?.method,
      corps: init?.body ? JSON.parse(init.body as string) : null,
    });
    if (url.includes('/factures/depuis-heures')) {
      return {
        ok: true, status: 201,
        json: async () => ({ totalHeures: 7, ecartes: [] }),
      } as Response;
    }
    if (init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ ecrits: 1 }) } as Response;
    }
    return { ok: true, status: 200, json: async () => recap } as Response;
  }),
}));

const LIGNE = {
  membreId: 'm1', membreNom: 'Thomas',
  affaireId: 'a1', affaireLabel: 'Mission conseil',
  clientId: null, clientLabel: null,
  date: '2026-03-02', heures: 7, facturable: true, origine: 'pointe' as const,
};

function afficher() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Pointages />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  envois.length = 0;
  recap = {
    semaine: { debut: '2026-03-02', fin: '2026-03-08' },
    lignes: [LIGNE],
    chantiersDisponibles: [],
    parAffaire: [{ affaireId: 'a1', affaireLabel: 'Mission conseil', heures: 7 }],
    parClient: [],
    totalHeures: 7,
  };
});

describe('le temps non facturable se décoche', () => {
  test('la case reflète ce que le SERVEUR dit, pas un défaut local', async () => {
    // Repartir de `true` à chaque chargement refacturerait ce qu'on venait
    // d'écarter — le pire des défauts pour cette case, parce qu'il est muet.
    recap = { ...(recap as object), lignes: [{ ...LIGNE, facturable: false }] };
    afficher();
    const groupe = await screen.findByText('Mission conseil');
    await userEvent.click(groupe);
    const cases = await screen.findAllByRole('checkbox');
    expect(cases[0]).not.toBeChecked();
  });

  test('décocher retire ces heures de ce qui part au serveur', async () => {
    afficher();
    await userEvent.click(await screen.findByText('Mission conseil'));
    await userEvent.click((await screen.findAllByRole('checkbox'))[0]!);
    await userEvent.click(screen.getByRole('button', { name: /Confirmer la semaine/ }));

    await waitFor(() => {
      const conf = envois.find((e) => e.url.includes('confirmer'));
      expect(conf).toBeDefined();
      expect((conf!.corps as { lignes: { facturable: boolean }[] }).lignes[0]!.facturable).toBe(false);
    });
  });
});

describe('facturer le temps', () => {
  test('le bouton vit SOUS les heures qu\'il facture', async () => {
    // Le chercher ailleurs supposerait qu'on sache qu'il existe.
    afficher();
    expect(await screen.findByTestId('facturer-temps')).toBeTruthy();
    expect(screen.getByTestId('facturer-affaire:a1')).toBeTruthy();
  });

  test('il appelle la route avec l\'affaire et les bornes de la semaine', async () => {
    afficher();
    await userEvent.click(await screen.findByTestId('facturer-affaire:a1'));

    await waitFor(() => {
      const appel = envois.find((e) => e.url.includes('/factures/depuis-heures'));
      expect(appel).toBeDefined();
      expect(appel!.corps).toEqual({ affaireId: 'a1', du: '2026-03-02', au: '2026-03-08' });
    });
  });

  test('aucun bouton pour un rattachement CLIENT — la route n\'est pas appelée à vide', async () => {
    // L'écran groupe par rattachement ; un groupe client n'a pas d'affaireId
    // à envoyer, et proposer le bouton produirait un 400 systématique.
    recap = {
      semaine: { debut: '2026-03-02', fin: '2026-03-08' },
      lignes: [{ ...LIGNE, affaireId: null, affaireLabel: null, clientId: 'c1', clientLabel: 'Cabinet Martin' }],
      chantiersDisponibles: [], parAffaire: [], parClient: [], totalHeures: 7,
    };
    afficher();
    await screen.findByText('Cabinet Martin');
    expect(screen.queryByTestId('facturer-temps')).toBeNull();
  });
});
