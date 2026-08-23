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
 *
 * ── Pourquoi le cache est amorcé, et pas la requête attendue ──────────────
 * Première version de ce fichier : les cas négatifs faisaient
 * `await waitFor(() => expect(queryByTestId(…)).toBeNull())`. Ils passaient
 * TOUS, y compris avec la garde retirée — parce que le bandeau ne rend rien
 * tant que la requête n'a pas répondu, et que `waitFor` s'arrête à la
 * PREMIÈRE réussite. Ils vérifiaient l'écran vide du premier rendu, jamais la
 * garde. Éprouvés par injection, ils n'ont pas bronché.
 *
 * On amorce donc le cache : la donnée est là au premier rendu, l'assertion est
 * synchrone, et il n'y a plus d'instant vide à confondre avec un refus.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BanniereSiren } from './banniere-siren';

const CLE = ['/api/onboarding/qualification'];

let reponseReseau: unknown = { peutEmettre: false, messageSiren: 'Il manque le numéro SIRET.' };
let chemin = '/devis';

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => reponseReseau }) as Response),
}));

vi.mock('wouter', () => ({
  useLocation: () => [chemin, vi.fn()],
  // Les props sont propagées : un faux `Link` qui avale `data-testid` ferait
  // échouer le test pour une raison qui n'existe pas dans l'application.
  Link: ({ children, href, ...reste }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...reste}>{children}</a>
  ),
}));

/** Amorce le cache pour que le bandeau décide dès le premier rendu. */
function afficherAvec(donnees: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(CLE, donnees);
  return render(
    <QueryClientProvider client={client}>
      <BanniereSiren />
    </QueryClientProvider>,
  );
}

/** Le chemin réel, requête comprise — gardé pour au moins un cas. */
function afficherParLeReseau() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BanniereSiren />
    </QueryClientProvider>,
  );
}

const MANQUE = { peutEmettre: false, messageSiren: 'Il manque le numéro SIRET.' };

beforeEach(() => {
  localStorage.clear();
  chemin = '/devis';
  reponseReseau = { ...MANQUE };
});

describe('il explique avant que le refus tombe', () => {
  test('le texte affiché est celui du serveur', async () => {
    // Le seul cas qui traverse vraiment la requête : ici l'attente est saine,
    // puisqu'on attend l'APPARITION de quelque chose.
    afficherParLeReseau();
    await waitFor(() => expect(screen.getByTestId('banniere-siren')).toBeTruthy());
    expect(screen.getByTestId('banniere-siren').textContent).toContain(
      'Il manque le numéro SIRET.',
    );
    expect(screen.getByTestId('banniere-siren-lien')).toBeTruthy();
  });

  test('il se tait dès que le compte peut émettre', () => {
    afficherAvec({ peutEmettre: true, messageSiren: null });
    expect(screen.queryByTestId('banniere-siren')).toBeNull();
  });

  test('un message absent ne laisse pas un bandeau vide', () => {
    afficherAvec({ peutEmettre: false, messageSiren: null });
    expect(screen.queryByTestId('banniere-siren')).toBeNull();
  });
});

describe('il ne casse rien', () => {
  test('une réponse absente ne rend rien — et ne lève rien', () => {
    // La cicatrice : `data.peutEmettre` lu sur une réponse absente faisait
    // tomber toutes les pages à la fois, pas seulement le bandeau. C'est aussi
    // l'état du PREMIER rendu, avant toute réponse.
    afficherAvec(null);
    expect(screen.queryByTestId('banniere-siren')).toBeNull();
  });

  test('un « peutEmettre » absent ne déclenche pas le bandeau', () => {
    // `!== false`, et non `!x` : une forme de réponse inattendue ne doit pas
    // faire accuser un compte parfaitement en règle de manquer d'un SIRET.
    afficherAvec({ messageSiren: 'Il manque le numéro SIRET.' });
    expect(screen.queryByTestId('banniere-siren')).toBeNull();
  });
});

describe('il ne double pas le cockpit', () => {
  test('sur le cockpit, il se tait — l’appel y est déjà, avec ses actions', () => {
    chemin = '/';
    afficherAvec({ ...MANQUE });
    expect(screen.queryByTestId('banniere-siren')).toBeNull();
  });

  test('ailleurs, il parle — sans quoi le test précédent ne prouverait rien', () => {
    chemin = '/factures';
    afficherAvec({ ...MANQUE });
    expect(screen.getByTestId('banniere-siren')).toBeTruthy();
  });
});

describe('il se laisse taire', () => {
  test('fermé, il ne revient pas dans la session', async () => {
    // Un compte en cours d'immatriculation vivra des semaines avec ce
    // message : un bandeau qu'on ne peut pas taire devient du bruit.
    afficherAvec({ ...MANQUE });
    await userEvent.click(screen.getByLabelText('Masquer ce message'));
    expect(screen.queryByTestId('banniere-siren')).toBeNull();

    afficherAvec({ ...MANQUE });
    expect(screen.queryByTestId('banniere-siren')).toBeNull();
  });

  test('le masquage expire — il n’est pas une suppression', () => {
    localStorage.setItem(
      'nodaq.siren.masque-le',
      String(Date.now() - 8 * 24 * 60 * 60 * 1000),
    );
    afficherAvec({ ...MANQUE });
    expect(screen.getByTestId('banniere-siren')).toBeTruthy();
  });

  test('une date de masquage illisible ne masque pas', () => {
    localStorage.setItem('nodaq.siren.masque-le', 'hier');
    afficherAvec({ ...MANQUE });
    expect(screen.getByTestId('banniere-siren')).toBeTruthy();
  });
});
