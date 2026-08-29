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

/** Ce que l'utilisateur dicte. Modifiable par test. */
let phraseDictee = 'ajoute au catalogue la pose de placo';

/** Ce que l'assistant répondra sur /chat/messages. Modifiable par test. */
let reponseChat: { statut: number; corps: unknown } = {
  statut: 200,
  corps: {
    conversationId: 'conv-1',
    message: { content: 'Oui — nodaq établit et envoie vos factures.' },
    actions_proposees: [],
  },
};

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
    if (url.includes('/chat/messages')) {
      return new Response(JSON.stringify(reponseChat.corps), {
        status: reponseChat.statut,
        headers: { 'Content-Type': 'application/json' },
      });
    }
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
    demarrer: () => interpreter(phraseDictee),
    arreter: () => {},
  }),
}));

// `window.location.reload` est appelé après une validation réussie.
beforeEach(() => {
  executions.length = 0;
  planCourant = PLAN_CATALOGUE;
  phraseDictee = 'ajoute au catalogue la pose de placo';
  localStorage.clear();
  reponseChat = {
    statut: 200,
    corps: {
      conversationId: 'conv-1',
      message: { content: 'Oui — nodaq établit et envoie vos factures.' },
      actions_proposees: [],
    },
  };
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


/*
 * ── PARLER NORMALEMENT AU PRODUIT ────────────────────────────────────────
 *
 * Constaté le 29/08/2026 sur le déploiement : à « Est-ce que l'outil
 * fonctionne pour envoyer des factures ? » — transcrite PARFAITEMENT — nodaq
 * répondait « Je n'ai pas compris ».
 *
 * La dictée n'avait qu'une destination : l'extracteur d'opérations. Tout ce
 * qui n'en produisait aucune était déclaré incompris. Or facturer est la
 * raison d'être du produit, et l'assistant — présent sur le même écran —
 * savait répondre. Même famille que l'incident du 22/08 qui a fait écrire la
 * règle 3 bis : un garde-fou écrit pour un extracteur finit par attraper le
 * cœur du métier dès qu'on parle normalement.
 */
const PLAN_SANS_OPERATION = { planId: null, operations: [], questions: [], nonCompris: ["Est-ce que l'outil fonctionne pour envoyer des factures ?"] };

describe('une question dictée reçoit une RÉPONSE, pas un constat d’échec', () => {
  async function dicterUneQuestion() {
    planCourant = PLAN_SANS_OPERATION;
    phraseDictee = "Est-ce que l'outil fonctionne pour envoyer des factures ?";
    render(<MicroFlottant />);
    fireEvent.pointerDown(screen.getByTestId('bouton-micro-flottant'));
    return waitFor(() => screen.getByTestId('reponse-agent'));
  }

  test("la question part à l'assistant et sa réponse s'affiche", async () => {
    const reponse = await dicterUneQuestion();

    expect(reponse).toHaveTextContent(/nodaq établit et envoie vos factures/);
    const versChat = executions.find((e) => e.url.includes('/chat/messages'));
    expect(versChat, "la question n'a pas été envoyée à l'assistant").toBeDefined();
    expect((versChat!.corps as { content: string }).content).toBe(
      "Est-ce que l'outil fonctionne pour envoyer des factures ?",
    );
  });

  test("« Je n'ai pas compris » ne s'affiche plus sur une phrase claire", async () => {
    await dicterUneQuestion();          // signe POSITIF d'abord

    // LA garde. Le libellé exact qui a fait croire que le produit était cassé.
    expect(screen.queryByTestId('non-compris')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/Je n.ai pas compris/);
    // Et le vocabulaire du moteur ne fuit pas non plus à l'écran.
    expect(document.body.textContent ?? '').not.toMatch(/Aucune opération à appliquer/);
  });

  test('la phrase entendue est montrée, pour qu’on voie ce qui a été transcrit', async () => {
    await dicterUneQuestion();
    expect(screen.getByTestId('reponse-agent-bloc')).toHaveTextContent(
      "Est-ce que l'outil fonctionne pour envoyer des factures ?",
    );
  });

  /*
   * La question doit atterrir dans la MÊME conversation que ce qu'on tape :
   * deux fils parallèles au même assistant, et l'utilisateur ne retrouve
   * jamais ce qu'il a dicté.
   */
  test('l’échange rejoint la conversation de l’écran de discussion', async () => {
    localStorage.setItem('nodaq.chat.conversationId', 'conv-existante');
    await dicterUneQuestion();

    const versChat = executions.find((e) => e.url.includes('/chat/messages'))!;
    expect((versChat.corps as { conversationId: string }).conversationId).toBe('conv-existante');
    expect(localStorage.getItem('nodaq.chat.conversationId')).toBe('conv-1');
  });

  /*
   * Si l'assistant échoue, on le DIT. Retomber en silence sur « je n'ai pas
   * compris » ferait porter à la phrase un défaut qui n'est pas le sien.
   */
  test('un assistant indisponible est annoncé comme tel', async () => {
    reponseChat = { statut: 503, corps: { error: "L'assistant n'est pas configuré sur ce déploiement." } };
    planCourant = PLAN_SANS_OPERATION;
    phraseDictee = "Est-ce que l'outil fonctionne pour envoyer des factures ?";
    render(<MicroFlottant />);
    fireEvent.pointerDown(screen.getByTestId('bouton-micro-flottant'));

    const bloc = await waitFor(() => screen.getByTestId('reponse-agent'));
    expect(bloc).toHaveTextContent(/assistant n.a pas pu répondre/i);
    expect(document.body.textContent ?? '').not.toMatch(/Je n.ai pas compris/);
  });
});

describe('le cas MIXTE — une action et un reste', () => {
  const PLAN_MIXTE = {
    ...PLAN_CATALOGUE,
    nonCompris: ['et est-ce que je peux envoyer une facture ensuite ?'],
  };

  test('l’action reste à valider, et le reste peut être posé à l’assistant', async () => {
    planCourant = PLAN_MIXTE;
    render(<MicroFlottant />);
    fireEvent.pointerDown(screen.getByTestId('bouton-micro-flottant'));

    await waitFor(() => expect(screen.getByTestId('liste-operations')).toBeInTheDocument());
    const reste = screen.getByTestId('non-compris');
    // Le mot « incompris » a disparu : c'est un RESTE, pas un échec.
    expect(reste.textContent ?? '').not.toMatch(/Je n.ai pas compris/);

    // Rien n'est parti tout seul : une phrase qui porte une action reste
    // sous contrôle de l'utilisateur.
    expect(executions.some((e) => e.url.includes('/chat/messages'))).toBe(false);

    await userEvent.click(screen.getByTestId('demander-assistant'));
    await waitFor(() => expect(screen.getByTestId('reponse-agent')).toBeInTheDocument());

    const versChat = executions.find((e) => e.url.includes('/chat/messages'))!;
    expect((versChat.corps as { content: string }).content).toBe(
      'et est-ce que je peux envoyer une facture ensuite ?',
    );
  });
});
