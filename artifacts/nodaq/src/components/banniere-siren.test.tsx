/**
 * Le bandeau « il vous manque votre numéro SIREN » — ticket 4.36, lot A.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 * Le premier est une cicatrice : un bandeau de cette famille a déjà fait
 * tomber le cockpit ENTIER parce qu'il lisait un champ d'une réponse qui
 * n'était pas encore arrivée. Un composant monté dans la coquille est monté
 * sur toutes les pages : son plantage n'est jamais local.
 *
 * Le second est le doublon. Le cockpit porte déjà l'appel « compléter le
 * profil », déclenché par la MÊME condition (SIRET absent). Deux messages
 * identiques à dix centimètres d'écart apprennent au lecteur à ignorer les
 * deux.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BanniereSiren } from './banniere-siren';

let reponse: unknown = { peutEmettre: false, messageSiren: 'Il manque le numéro SIRET.' };
let ok = true;
let chemin = '/devis';

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => reponse }) as Response),
}));

vi.mock('wouter', () => ({
  useLocation: () => [chemin, vi.fn()],
  // Les props sont propagées : un faux `Link` qui avale `data-testid` ferait
  // échouer le test pour une raison qui n'existe pas dans l'application.
  Link: ({ children, href, ...reste }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...reste}>{children}</a>
  ),
}));

function afficher() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BanniereSiren />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  ok = true;
  chemin = '/devis';
  reponse = { peutEmettre: false, messageSiren: 'Il manque le numéro SIRET.' };
});

describe('il explique avant que le refus tombe', () => {
  test('le texte affiché est celui du serveur', async () => {
    afficher();
    await waitFor(() => expect(screen.getByTestId('banniere-siren')).toBeTruthy());
    expect(screen.getByTestId('banniere-siren').textContent).toContain(
      'Il manque le numéro SIRET.',
    );
    expect(screen.getByTestId('banniere-siren-lien')).toBeTruthy();
  });

  test('il se tait dès que le compte peut émettre', async () => {
    reponse = { peutEmettre: true, messageSiren: null };
    afficher();
    await waitFor(() => expect(screen.queryByTestId('banniere-siren')).toBeNull());
  });
});

describe('il ne casse rien', () => {
  test('une réponse vide ne rend rien — et ne lève rien', async () => {
    // La cicatrice : `data.peutEmettre` lu sur `undefined` faisait tomber
    // toutes les pages à la fois, pas seulement le bandeau.
    reponse = undefined;
    afficher();
    await waitFor(() => expect(screen.queryByTestId('banniere-siren')).toBeNull());
  });

  test('une réponse en erreur ne rend rien', async () => {
    ok = false;
    afficher();
    await waitFor(() => expect(screen.queryByTestId('banniere-siren')).toBeNull());
  });

  test('un « peutEmettre » absent ne déclenche pas le bandeau', async () => {
    // `!== false`, et non `!x` : une forme de réponse inattendue ne doit pas
    // faire accuser un compte parfaitement en règle de manquer d'un SIRET.
    reponse = { messageSiren: 'Il manque le numéro SIRET.' };
    afficher();
    await waitFor(() => expect(screen.queryByTestId('banniere-siren')).toBeNull());
  });
});

describe('il ne double pas le cockpit', () => {
  test('sur le cockpit, il se tait — l’appel y est déjà, avec ses actions', async () => {
    chemin = '/';
    afficher();
    await waitFor(() => expect(screen.queryByTestId('banniere-siren')).toBeNull());
  });
});

describe('il se laisse taire', () => {
  test('fermé, il ne revient pas dans la session', async () => {
    // Un compte en cours d'immatriculation vivra des semaines avec ce
    // message : un bandeau qu'on ne peut pas taire devient du bruit.
    afficher();
    await waitFor(() => expect(screen.getByTestId('banniere-siren')).toBeTruthy());
    await userEvent.click(screen.getByLabelText('Masquer ce message'));
    expect(screen.queryByTestId('banniere-siren')).toBeNull();

    afficher();
    await waitFor(() => expect(screen.queryByTestId('banniere-siren')).toBeNull());
  });

  test('le masquage expire — il n’est pas une suppression', async () => {
    localStorage.setItem(
      'nodaq.siren.masque-le',
      String(Date.now() - 8 * 24 * 60 * 60 * 1000),
    );
    afficher();
    await waitFor(() => expect(screen.getByTestId('banniere-siren')).toBeTruthy());
  });
});
