/**
 * Le menu du compte — et surtout la sortie de session.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 * L'application a été livrée SANS aucun bouton de déconnexion : la route
 * `POST /api/auth/logout` existait depuis le premier lot, aucune interface ne
 * l'appelait. Le premier test est donc la garde qui empêche que ça se
 * reproduise — il échoue si le chemin disparaît de l'écran.
 *
 * Les trois autres protègent des façons plus discrètes de reproduire le même
 * défaut, c'est-à-dire de CROIRE qu'on est sorti sans l'être :
 *
 *   — une déconnexion qui n'appelle pas le serveur laisserait la session
 *     ouverte en base, donc réutilisable par le cookie ;
 *   — une déconnexion qui n'efface pas le cache laisserait les montants du
 *     compte précédent à l'écran, ce qui sur un téléphone prêté est
 *     exactement le problème qu'on prétendait régler ;
 *   — une déconnexion qui navigue MALGRÉ un échec réseau est la pire des
 *     trois : l'écran de connexion s'affiche, la session est intacte.
 *
 * ── Pourquoi le cache est amorcé ──────────────────────────────────────────
 * Même raison que `banniere-siren.test.tsx` : sans amorçage, l'identité
 * n'arrive qu'après la requête, et une assertion négative passerait sur
 * l'instant vide du premier rendu plutôt que sur ce qu'elle prétend vérifier.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuUtilisateur } from './menu-utilisateur';

const CLE_AUTH = ['auth-me'];

const IDENTITE_COMPLETE = {
  authenticated: true,
  mfaStatus: 'verified',
  userId: 'u1',
  email: 'patron@exemple.fr',
  nom: 'Karim Benali',
  tenantId: 't1',
  role: 'OWNER',
};

/** Une identité arrêtée à mi-parcours du second facteur : ni email ni nom. */
const IDENTITE_PARTIELLE = { authenticated: true, mfaStatus: 'verify_required' };

let reponseLogout: { ok: boolean } = { ok: true };

/**
 * Le faux serveur distingue les deux adresses, et ce n'est pas cosmétique :
 * `useAuth` reste monté pendant la déconnexion, donc il REFAIT sa requête
 * aussitôt le cache vidé. Un faux serveur qui répondrait `{ ok: true }` à
 * tout réécrirait une identité dans le cache et masquerait le vidage.
 * En vrai, le cookie ayant été effacé, `/api/auth/me` répond 401.
 */
const apiFetch = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url.includes('/api/auth/me')) {
    return { ok: false, status: 401, json: async () => ({}) } as Response;
  }
  return {
    ok: reponseLogout.ok,
    status: reponseLogout.ok ? 200 : 503,
    json: async () => ({ ok: true }),
  } as Response;
});

vi.mock('@/lib/auth', () => ({ apiFetch: (url: string, init?: RequestInit) => apiFetch(url, init) }));

const naviguer = vi.fn();
vi.mock('wouter', () => ({ useLocation: () => ['/', naviguer] }));

function afficher(identite: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(CLE_AUTH, identite);
  // Une donnée quelconque d'un AUTRE écran : c'est elle qui prouve que le
  // cache est bien vidé, et pas seulement l'identité.
  client.setQueryData(['factures'], [{ id: 'f1', montant: 123400 }]);
  const rendu = render(
    <QueryClientProvider client={client}>
      <MenuUtilisateur variante="barre" />
    </QueryClientProvider>,
  );
  return { ...rendu, client };
}

/** Ouvre le menu déroulant et rend l'élément de déconnexion. */
async function ouvrirEtTrouverSortie() {
  await userEvent.click(screen.getByTestId('menu-utilisateur'));
  return await screen.findByTestId('bouton-deconnexion');
}

beforeEach(() => {
  apiFetch.mockClear();
  naviguer.mockClear();
  reponseLogout = { ok: true };
});

describe('MenuUtilisateur', () => {
  test('offre une sortie de session — la garde du défaut d’origine', async () => {
    afficher(IDENTITE_COMPLETE);
    const sortie = await ouvrirEtTrouverSortie();
    expect(sortie).toHaveTextContent('Se déconnecter');
  });

  test('la sortie reste offerte même sans identité complète (second facteur en attente)', async () => {
    // Le compte bloqué à mi-parcours du second facteur est précisément celui
    // qui a besoin de sortir. Conditionner le bouton à la présence d'un email
    // l'enfermerait.
    afficher(IDENTITE_PARTIELLE);
    expect(await ouvrirEtTrouverSortie()).toBeInTheDocument();
  });

  test('appelle le serveur, vide le cache, puis va à l’écran de connexion', async () => {
    const { client } = afficher(IDENTITE_COMPLETE);
    await userEvent.click(await ouvrirEtTrouverSortie());

    await waitFor(() => expect(naviguer).toHaveBeenCalledWith('/login'));

    expect(apiFetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    // Vidé, pas invalidé : la donnée du compte quitté ne doit plus exister.
    expect(client.getQueryData(['factures'])).toBeUndefined();
    // `useAuth` étant toujours monté, il se rejoue aussitôt — et reçoit 401.
    // Ce qui compte n'est donc pas que la clé soit absente, mais que
    // l'identité, elle, ait disparu.
    await waitFor(() =>
      expect(client.getQueryData(CLE_AUTH)).toEqual({ authenticated: false }),
    );
  });

  test('un échec réseau ne fait pas semblant : pas de navigation, et on le dit', async () => {
    reponseLogout = { ok: false };
    const { client } = afficher(IDENTITE_COMPLETE);
    await userEvent.click(await ouvrirEtTrouverSortie());

    expect(await screen.findByRole('alert')).toHaveTextContent('Déconnexion impossible');
    expect(naviguer).not.toHaveBeenCalled();
    // La session est intacte côté serveur : le cache doit l'être aussi, sans
    // quoi l'écran se viderait en donnant l'illusion d'une déconnexion.
    expect(client.getQueryData(['factures'])).toBeDefined();
  });
});
