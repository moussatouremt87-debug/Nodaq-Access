/*
 * Facturer les échéances depuis l'écran des contrats — US-A2.3.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 * Une route de facturation récurrente que rien n'appelle ne facture rien. Le
 * défaut corrigé par la PR #178, re-signalé en #189 : une fonctionnalité
 * complète et inaccessible. Ces tests éprouvent le CHEMIN D'USAGE.
 *
 * Le plus important d'entre eux est le dernier : un retour à zéro DIT quelque
 * chose. Un bouton qui semble ne rien faire est lu comme une panne, et
 * l'utilisateur ressaisit à la main ce qui était déjà à jour.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Contrats from './contrats';

const envois: Array<{ url: string; methode?: string; corps: Record<string, unknown> | null }> = [];
const toasts: Array<{ title?: string; description?: string; variant?: string }> = [];

/** Ce que la route rend. Modifiable par test. */
let reponse: Record<string, unknown>;

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: (t: { title?: string }) => { toasts.push(t); } }),
}));

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    envois.push({
      url,
      methode: init?.method,
      corps: init?.body ? JSON.parse(init.body as string) : null,
    });
    return { ok: true, status: 201, json: async () => reponse } as Response;
  }),
}));

const CONTRAT = {
  id: 'c1', label: 'Maintenance annuelle', clientName: 'Cabinet Martin',
  cadence: 'mensuel', amountCents: 50_000, status: 'ACTIF',
  startDate: '2026-01-01', endDate: null, nextOccurrenceDate: '2026-09-01',
  notes: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

vi.mock('@workspace/api-client-react', async () => {
  const vraie = await vi.importActual<Record<string, unknown>>('@workspace/api-client-react');
  return {
    ...vraie,
    useListContrats: () => ({ data: [CONTRAT], isLoading: false, isError: false }),
    useUpdateContrat: () => ({ mutate: vi.fn() }),
    useDeleteContrat: () => ({ mutate: vi.fn() }),
    useCreateContrat: () => ({ mutate: vi.fn() }),
  };
});

function afficher() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Contrats />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  envois.length = 0;
  toasts.length = 0;
  reponse = { factures: [{}, {}, {}], creees: 3, dejaFacturees: 0, ecartes: [] };
});

describe('le bouton de facturation des échéances', () => {
  test('il existe sur l\'écran des contrats', async () => {
    // Le chercher ailleurs supposerait qu'on sache qu'il existe.
    afficher();
    expect(await screen.findByTestId('button-facturer-echeances')).toBeTruthy();
  });

  test('il appelle la route, sans restreindre à un contrat', async () => {
    afficher();
    await userEvent.click(await screen.findByTestId('button-facturer-echeances'));

    await waitFor(() => {
      const appel = envois.find((e) => e.url.includes('facturer-echeances'));
      expect(appel).toBeDefined();
      expect(appel!.methode).toBe('POST');
      expect(appel!.corps).toEqual({});
    });
  });

  test('il annonce le NOMBRE de factures créées', async () => {
    // « Opération réussie » ne dit pas si trois mois ont été rattrapés ou un.
    afficher();
    await userEvent.click(await screen.findByTestId('button-facturer-echeances'));
    await waitFor(() => expect(toasts.some((t) => t.title === '3 factures créées')).toBe(true));
  });

  test('il dit que rien n\'est ENVOYÉ', async () => {
    // Le point d'attention de la story, porté jusqu'à l'écran : quelqu'un qui
    // croit avoir envoyé trois factures ne les enverra jamais.
    afficher();
    await userEvent.click(await screen.findByTestId('button-facturer-echeances'));
    await waitFor(() => {
      const t = toasts.find((x) => x.title === '3 factures créées');
      expect(t?.description).toMatch(/brouillon/i);
      expect(t?.description).toMatch(/envoy/i);
    });
  });

  test('le singulier est respecté à une facture', async () => {
    reponse = { factures: [{}], creees: 1, dejaFacturees: 0, ecartes: [] };
    afficher();
    await userEvent.click(await screen.findByTestId('button-facturer-echeances'));
    await waitFor(() => expect(toasts.some((t) => t.title === '1 facture créée')).toBe(true));
  });
});

describe('un retour à zéro n\'est pas un silence', () => {
  test('rien à facturer le DIT, et sans alarmer', async () => {
    reponse = { factures: [], creees: 0, dejaFacturees: 2, ecartes: [] };
    afficher();
    await userEvent.click(await screen.findByTestId('button-facturer-echeances'));

    await waitFor(() => {
      const t = toasts.find((x) => x.title === 'Aucune échéance à facturer');
      expect(t).toBeDefined();
      expect(t!.description).toMatch(/à jour/);
      expect(t!.variant).toBeUndefined();   // ce n'est pas une erreur
    });
  });

  test('un contrat non facturable remonte SON motif, en alerte', async () => {
    reponse = {
      factures: [], creees: 0, dejaFacturees: 0,
      ecartes: [{ contratId: 'c1', motif: 'aucun montant sur le contrat — rien à facturer' }],
    };
    afficher();
    await userEvent.click(await screen.findByTestId('button-facturer-echeances'));

    await waitFor(() => {
      const t = toasts.find((x) => x.title === 'Rien n\'a pu être facturé');
      expect(t).toBeDefined();
      expect(t!.description).toMatch(/aucun montant/);
      expect(t!.variant).toBe('destructive');
    });
  });
});
