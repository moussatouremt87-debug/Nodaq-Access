/**
 * Les écrans de qualification — ticket 4.36, lot A, côté écran.
 *
 * ── Ce que ces tests protègent ────────────────────────────────────────────
 * Le lot A avait sa table, sa route, ses règles partagées et ses tests
 * d'isolation — et aucun écran ne posait les questions. La colonne `stade`
 * était structurellement impossible à remplir : la fonctionnalité était
 * annoncée livrée et n'existait pas.
 *
 * Trois propriétés sont vérifiées ici, parce qu'aucune n'est visible depuis un
 * test de route :
 *   1. UNE réponse par envoi — un parcours abandonné garde ce qui précède ;
 *   2. « Plus tard » n'écrit rien et avance quand même ;
 *   3. la fin du parcours affiche l'action choisie par le SERVEUR, jamais une
 *      action recalculée ici.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  EcranStade, EcranEffectif, EcranGestion, EcranIrritant, EcranPremiereAction,
} from './onboarding-qualification';

const envois: Array<{ url: string; methode?: string; corps: Record<string, unknown> | null }> = [];

/** Ce que `GET /onboarding/qualification` renverra. Modifiable par test. */
let reponseLecture: unknown = {
  premiereAction: { cle: 'relancer', titre: 'Enregistrez une facture impayée', chemin: '/factures' },
  messageSiren: null,
};

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    envois.push({
      url,
      methode: init?.method,
      corps: init?.body ? JSON.parse(init.body as string) : null,
    });
    return { ok: true, status: 200, json: async () => reponseLecture } as Response;
  }),
}));

beforeEach(() => {
  envois.length = 0;
  reponseLecture = {
    premiereAction: { cle: 'relancer', titre: 'Enregistrez une facture impayée', chemin: '/factures' },
    messageSiren: null,
  };
});

describe('une réponse par envoi', () => {
  test('le stade part seul, et il est rendu à l’appelant', async () => {
    // Rendu à l'appelant parce qu'il fait SAUTER la recherche SIREN : c'est
    // la seule réponse dont l'effet est immédiat sur le parcours lui-même.
    const onNext = vi.fn();
    render(<EcranStade onNext={onNext} onSkip={vi.fn()} />);

    await userEvent.click(screen.getByTestId('stade-EN_PROJET'));
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]!.methode).toBe('PATCH');
    expect(envois[0]!.corps).toEqual({ stade: 'EN_PROJET' });
    expect(onNext).toHaveBeenCalledWith('EN_PROJET');
  });

  test('l’outil quitté accompagne la gestion actuelle, sans écran de plus', async () => {
    render(<EcranGestion onNext={vi.fn()} onSkip={vi.fn()} />);

    await userEvent.click(screen.getByTestId('gestion-AUTRE_LOGICIEL'));
    await userEvent.type(screen.getByTestId('gestion-logiciel'), 'Batappli');
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]!.corps).toEqual({
      gestionActuelle: 'AUTRE_LOGICIEL',
      logicielActuel: 'Batappli',
    });
  });

  test('le champ « lequel ? » n’apparaît que pour un autre logiciel', async () => {
    render(<EcranGestion onNext={vi.fn()} onSkip={vi.fn()} />);
    await userEvent.click(screen.getByTestId('gestion-PAPIER_TABLEUR'));
    expect(screen.queryByTestId('gestion-logiciel')).toBeNull();
  });

  test('l’irritant « autre » emporte le verbatim', async () => {
    render(<EcranIrritant onNext={vi.fn()} onSkip={vi.fn()} />);
    await userEvent.click(screen.getByTestId('irritant-AUTRE'));
    await userEvent.type(screen.getByTestId('irritant-verbatim'), 'les devis me prennent la nuit');
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }));

    await waitFor(() => expect(envois).toHaveLength(1));
    expect(envois[0]!.corps).toEqual({
      irritant: 'AUTRE',
      irritantVerbatim: 'les devis me prennent la nuit',
    });
  });
});

describe('aucun écran ne bloque', () => {
  test('« Plus tard » avance sans rien écrire', async () => {
    // Un onboarding bloquant est un onboarding qu'on abandonne. Le test le
    // vérifie sur l'effectif, mais le pied de page est partagé par les quatre.
    const onSkip = vi.fn();
    render(<EcranEffectif onNext={vi.fn()} onSkip={onSkip} />);

    await userEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(onSkip).toHaveBeenCalled();
    expect(envois).toHaveLength(0);
  });

  test('« Continuer » reste inerte tant que rien n’est choisi', async () => {
    const onNext = vi.fn();
    render(<EcranEffectif onNext={onNext} onSkip={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }));
    expect(onNext).not.toHaveBeenCalled();
    expect(envois).toHaveLength(0);
  });
});

describe('la fin du parcours', () => {
  test('elle propose l’action choisie par le serveur, pas le cockpit', async () => {
    const onAller = vi.fn();
    render(<EcranPremiereAction onAller={onAller} />);

    await waitFor(() =>
      expect(screen.getByText('Enregistrez une facture impayée')).toBeTruthy(),
    );
    await userEvent.click(screen.getByTestId('onboarding-premiere-action'));
    expect(onAller).toHaveBeenCalledWith('/factures');

    // Le parcours est daté, même si tout a été passé.
    expect(envois.some((e) => e.methode === 'PATCH' && e.corps?.['terminee'] === true)).toBe(true);
  });

  test('le manque de SIREN est expliqué avec le texte du serveur', async () => {
    reponseLecture = {
      premiereAction: { cle: 'devis_dicte', titre: 'Dictez votre premier devis', chemin: '/chat' },
      messageSiren: 'Vous pouvez tout préparer en attendant de créer votre entreprise.',
    };
    render(<EcranPremiereAction onAller={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('onboarding-siren-manquant')).toBeTruthy());
    // Recopier ce texte ici ferait deux vérités : celle qui bloque l'émission
    // et celle qui l'explique.
    expect(screen.getByTestId('onboarding-siren-manquant').textContent).toContain(
      'Vous pouvez tout préparer en attendant de créer votre entreprise.',
    );
  });

  test('une réponse illisible ne casse pas l’écran de fin', async () => {
    reponseLecture = {};
    render(<EcranPremiereAction onAller={vi.fn()} />);

    // Pas d'action devinée, pas d'écran blanc : une porte de sortie.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Accéder au cockpit' })).toBeTruthy(),
    );
    expect(screen.queryByTestId('onboarding-premiere-action')).toBeNull();
  });
});
