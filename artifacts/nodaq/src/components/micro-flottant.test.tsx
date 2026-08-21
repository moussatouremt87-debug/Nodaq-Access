/**
 * L'écran de validation vocale — le montant que la voix ne porte pas.
 *
 * Ticket 4.21, lot 4. Le serveur produit des opérations dont un champ est
 * VIDE par construction : le prix d'un article de catalogue, le montant d'une
 * charge ou d'un contrat. Ni le modèle (il n'a pas le droit de fixer un prix)
 * ni le serveur (il n'a rien à calculer, c'est une décision commerciale) ne
 * peuvent le fournir.
 *
 * ── Le défaut que ces tests auraient attrapé ──────────────────────────────
 * L'écran ne rendait que les champs `!= null`. Un champ laissé vide ne
 * s'affichait donc PAS : la validation restait bloquée par le serveur, sur un
 * champ que l'utilisateur ne pouvait même pas voir. C'est le compilateur qui a
 * signalé le type manquant ; ce filtre-là, lui, n'aurait rien signalé.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MicroFlottant } from './micro-flottant';

const executions: Array<{ url: string; corps: unknown }> = [];

/** Le plan que le serveur renverra au prochain appel. Modifiable par test. */
let planCourant: unknown;

/** Le plan que le serveur renvoie pour « ajoute au catalogue la pose de placo ». */
const PLAN_CATALOGUE = {
  planId: 'plan-1',
  operations: [
    {
      type: 'creer_article_catalogue',
      libelle: 'Ajouter au catalogue « Pose de placo » — prix à saisir',
      certitude: 'aucune_resolution',
      champs: { libelle: 'Pose de placo', unite: 'm2', prixUnitaireHtCents: null },
      aCompleter: ['prixUnitaireHtCents'],
    },
  ],
  questions: [],
  nonCompris: [],
};

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const corps = init?.body ? JSON.parse(init.body as string) : null;
    executions.push({ url, corps });
    const charge = url.includes('/voix/executer')
      ? { applique: true, nbOperations: 1 }
      : planCourant;
    return new Response(JSON.stringify(charge), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

/**
 * La dictée est remplacée par un appel direct : ces tests portent sur l'écran
 * de validation, pas sur le micro. `demarrer` joue le rôle du relâchement du
 * bouton et livre la transcription.
 */
vi.mock('@/hooks/use-dictee', () => ({
  useDictee: (interpreter: (texte: string) => void) => ({
    enregistre: false,
    transcrit: false,
    demarrer: () => interpreter('ajoute au catalogue la pose de placo'),
    arreter: () => {},
  }),
}));

// `window.location.reload` est appelé après une validation réussie.
beforeEach(() => {
  executions.length = 0;
  planCourant = PLAN_CATALOGUE;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

/**
 * Ouvre la feuille de validation avec le plan courant.
 *
 * Le micro est un appui LONG (`onPointerDown`), pas un clic : `userEvent.click`
 * ne le déclenche pas. C'est `pointerDown` qui lance la dictée, comme le doigt
 * sur un chantier.
 */
async function ouvrirLePlan(): Promise<void> {
  render(<MicroFlottant />);
  fireEvent.pointerDown(screen.getByTestId('bouton-micro-flottant'));
  await waitFor(() => expect(screen.getByTestId('liste-operations')).toBeInTheDocument());
}

describe('a — un champ vide est AFFICHÉ, pas escamoté', () => {
  test('le prix réclamé apparaît, vide, alors que les autres champs ont une valeur', async () => {
    await ouvrirLePlan();

    const prix = screen.getByTestId('correction-0-prixUnitaireHtCents');
    // Le défaut d'origine : le filtre `!= null` l'écartait, et l'utilisateur
    // voyait un bouton grisé sans savoir quoi remplir.
    expect(prix).toBeInTheDocument();
    expect(prix).toHaveValue('');
    expect(prix).toHaveAttribute('aria-invalid');

    // Les champs dictés, eux, arrivent renseignés.
    expect(screen.getByTestId('correction-0-libelle')).toHaveValue('Pose de placo');
  });
});

describe('b — la validation est bloquée tant que le montant manque', () => {
  test('bouton désactivé, et la raison est écrite', async () => {
    await ouvrirLePlan();

    expect(screen.getByRole('button', { name: /valider/i })).toBeDisabled();
    // Un bouton grisé sans motif est une impasse.
    expect(screen.getByTestId('montant-a-saisir')).toBeInTheDocument();
    expect(executions.filter((e) => e.url.includes('/voix/executer'))).toHaveLength(0);
  });

  test('des espaces ne débloquent pas — ce n’est pas un prix', async () => {
    await ouvrirLePlan();
    await userEvent.type(screen.getByTestId('correction-0-prixUnitaireHtCents'), '   ');

    expect(screen.getByRole('button', { name: /valider/i })).toBeDisabled();
  });
});

describe('c — le prix saisi débloque, et part au serveur', () => {
  test('la correction voyage dans le corps de la requête', async () => {
    await ouvrirLePlan();
    await userEvent.type(screen.getByTestId('correction-0-prixUnitaireHtCents'), '4500');

    const valider = screen.getByRole('button', { name: /valider/i });
    await waitFor(() => expect(valider).toBeEnabled());
    expect(screen.queryByTestId('montant-a-saisir')).not.toBeInTheDocument();

    await userEvent.click(valider);

    await waitFor(() => {
      const appel = executions.find((e) => e.url.includes('/voix/executer'));
      expect(appel).toBeDefined();
      expect(appel!.corps).toMatchObject({
        planId: 'plan-1',
        corrections: { 0: { prixUnitaireHtCents: '4500' } },
      });
    });
  });
});

describe('d — un plan d’avant le lot 4 continue de fonctionner', () => {
  test('sans `aCompleter`, rien n’est réclamé et la validation reste ouverte', async () => {
    // Les plans vivent une heure en base : un plan construit AVANT ce lot est
    // relu après son déploiement. L'absence du champ ne doit pas bloquer sa
    // validation — sans quoi la mise en production gèlerait les plans en vol.
    planCourant = {
      planId: 'plan-ancien',
      operations: [
        {
          type: 'creer_affaire',
          libelle: "Créer l'affaire « Carrelage Dupont »",
          certitude: 'aucune_resolution',
          champs: { label: 'Carrelage Dupont', ville: 'Rouen' },
        },
      ],
      questions: [],
      nonCompris: [],
    };

    await ouvrirLePlan();

    expect(screen.queryByTestId('montant-a-saisir')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /valider/i })).toBeEnabled();
  });
});
