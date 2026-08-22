/**
 * Le pouce sous une production de l'agent — ticket 4.36, lot C, côté écran.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 * Le lot C avait sa route, sa table, ses tests serveur et sa restitution —
 * mais aucun écran ne l'appelait. Toute la chaîne était verte et la
 * fonctionnalité inexistante : aucune ligne ne pouvait entrer en base parce
 * que personne ne pouvait cliquer. C'est exactement ce qu'un test de route ne
 * voit pas.
 *
 * Le second défaut visé est plus discret : le verbatim est envoyé APRÈS le
 * pouce, dans un second appel. Si l'écran cessait de l'envoyer, rien ne
 * casserait — on recueillerait juste des pouces en bas sans jamais savoir
 * pourquoi.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RetourAgent } from './retour-agent';

const envois: Array<{ url: string; corps: Record<string, unknown> | null }> = [];

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    envois.push({ url, corps: init?.body ? JSON.parse(init.body as string) : null });
    return { ok: true, status: 204, json: async () => ({}) } as Response;
  }),
}));

beforeEach(() => { envois.length = 0; });

describe('un clic suffit', () => {
  test('le pouce en haut part seul, sans rien demander de plus', async () => {
    render(<RetourAgent typeProduction="reponse_chat" referenceId="m-1" />);
    await userEvent.click(screen.getByLabelText('Ce résultat me va'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]!.url).toContain('/agent/feedback');
    expect(envois[0]!.corps).toMatchObject({
      typeProduction: 'reponse_chat',
      referenceId: 'm-1',
      note: 'POUCE_HAUT',
    });
    // Aucun champ libre ne s'ouvre : un « très bien » n'a rien à expliquer.
    expect(screen.queryByTestId('retour-agent-verbatim')).toBeNull();
    expect(screen.getByTestId('retour-agent-merci')).toBeTruthy();
  });

  test('le pouce en bas est enregistré AVANT le champ libre', async () => {
    // C'est ce qui rend le champ facultatif pour de vrai : si l'utilisateur
    // ferme l'onglet, le signal est déjà parti.
    render(<RetourAgent typeProduction="plan_vocal" referenceId="p-1" />);
    await userEvent.click(screen.getByLabelText('Ce résultat ne me va pas'));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]!.corps).toMatchObject({ note: 'POUCE_BAS' });
    expect(envois[0]!.corps).not.toHaveProperty('verbatim');
    expect(screen.getByTestId('retour-agent-verbatim')).toBeTruthy();
  });
});

describe('le verbatim', () => {
  test('il part dans un SECOND envoi, avec la même référence', async () => {
    // Même référence : c'est ce qui permet au serveur de retrouver la ligne
    // du pouce et d'y attacher le commentaire au lieu d'en créer une seconde.
    render(<RetourAgent typeProduction="plan_vocal" referenceId="p-1" />);
    await userEvent.click(screen.getByLabelText('Ce résultat ne me va pas'));
    await userEvent.type(screen.getByTestId('retour-agent-verbatim'), 'il a inventé un montant');
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }));

    await waitFor(() => expect(envois).toHaveLength(2));
    expect(envois[1]!.corps).toMatchObject({
      typeProduction: 'plan_vocal',
      referenceId: 'p-1',
      note: 'POUCE_BAS',
      verbatim: 'il a inventé un montant',
    });
  });

  test('« Passer » n’envoie rien de plus — le pouce reste acquis', async () => {
    render(<RetourAgent typeProduction="plan_vocal" referenceId="p-1" />);
    await userEvent.click(screen.getByLabelText('Ce résultat ne me va pas'));
    await waitFor(() => expect(envois).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'Passer' }));
    expect(envois).toHaveLength(1);
    expect(screen.getByTestId('retour-agent-merci')).toBeTruthy();
  });
});

/*
 * ── Une garde volontairement SANS test, et pourquoi ───────────────────────
 * `envoyer()` termine par `.catch(() => {})`. Ce qu'il protège, c'est le rejet
 * non géré qui remonterait au navigateur pour un avis raté.
 *
 * Deux tentatives de le prouver ont échoué, et il faut le dire plutôt que le
 * cacher :
 *   1. « l'écran affiche quand même merci » — passe avec ET sans le `.catch`,
 *      puisque `setEnvoye(true)` est synchrone et n'a jamais rien à voir avec
 *      l'envoi. Test vacant ;
 *   2. observer le rejet — dans cet environnement (vitest + jsdom), un rejet
 *      non géré ne déclenche ni `process.on('unhandledRejection')`, ni
 *      `window.onunhandledrejection`, ni le rapporteur de vitest. Vérifié par
 *      une sonde : un `Promise.reject` nu passe totalement inaperçu.
 *
 * Le `.catch` reste — il est juste, et il compte dans un vrai navigateur. Mais
 * il n'est PAS couvert, et un test vert qui l'aurait laissé croire aurait été
 * pire que ce commentaire.
 */
