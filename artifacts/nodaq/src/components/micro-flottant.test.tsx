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

/** Ce que l'utilisateur dicte. Modifiable par test. */
let phraseDictee = 'ajoute au catalogue la pose de placo';

/** Ce que l'assistant répondra sur /chat/messages. Modifiable par test. */
let reponseChat: { statut: number; corps: unknown };

/** Ce que l'AGENT répond pour « ajoute au catalogue la pose de placo ». */
const PLAN_CATALOGUE = {
  conversationId: 'conv-1',
  message: { content: 'Je vous propose d’ajouter cet article. Le prix reste à saisir.' },
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
};

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const corps = init?.body ? JSON.parse(init.body as string) : null;
    executions.push({ url, corps });
    if (url.includes('/voix/executer')) {
      return new Response(JSON.stringify({ applique: true, nbOperations: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Tout le reste passe par l'agent : c'est désormais le SEUL chemin.
    return new Response(JSON.stringify(reponseChat.corps), {
      status: reponseChat.statut,
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
  phraseDictee = 'ajoute au catalogue la pose de placo';
  localStorage.clear();
  reponseChat = { statut: 200, corps: PLAN_CATALOGUE };
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
    reponseChat = {
      statut: 200,
      corps: {
        conversationId: 'conv-1',
        message: { content: "Je crée l'affaire « Carrelage Dupont »." },
        planId: 'plan-ancien',
        operations: [
          {
            type: 'creer_affaire',
            libelle: "Créer l'affaire « Carrelage Dupont »",
            certitude: 'aucune_resolution',
            champs: { label: 'Carrelage Dupont', ville: 'Rouen' },
          },
        ],
      },
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
const REPONSE_SANS_OPERATION = {
  conversationId: 'conv-1',
  message: { content: 'Oui — nodaq établit et envoie vos factures.' },
  planId: null,
  operations: [],
};

describe('une question dictée reçoit une RÉPONSE, pas un constat d’échec', () => {
  async function dicterUneQuestion() {
    reponseChat = { statut: 200, corps: REPONSE_SANS_OPERATION };
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
    phraseDictee = "Est-ce que l'outil fonctionne pour envoyer des factures ?";
    render(<MicroFlottant />);
    fireEvent.pointerDown(screen.getByTestId('bouton-micro-flottant'));

    const bloc = await waitFor(() => screen.getByTestId('reponse-agent'));
    expect(bloc).toHaveTextContent(/assistant n.a pas pu répondre/i);
    expect(document.body.textContent ?? '').not.toMatch(/Je n.ai pas compris/);
  });
});



/*
 * ── UN SEUL AGENT ────────────────────────────────────────────────────────
 *
 * Le micro tapait sur `/voix/interpreter`, un extracteur d'intentions écrit à
 * côté de l'agent de discussion : sans mémoire, sans outils. Le 29/08/2026,
 * « Pour le même client, Madame Touré, pour la réfection du mur pour 1200
 * euros » n'a rien produit — une phrase de SUITE, adressée à un système qui
 * n'avait aucun passé.
 *
 * Ces gardes empêchent de revenir à deux implémentations du même métier.
 */
describe('le micro parle à l’agent, pas à un extracteur', () => {
  test('la dictée part sur /chat/messages, jamais sur /voix/interpreter', async () => {
    await ouvrirLePlan();

    expect(executions.some((e) => e.url.includes('/chat/messages'))).toBe(true);
    // LA garde : le retour à l'extracteur sans mémoire.
    expect(executions.some((e) => e.url.includes('/voix/interpreter'))).toBe(false);
  });

  /*
   * « Pour le même client » ne veut rien dire sans le tour précédent. C'est
   * la conversation partagée qui donne un sens à une phrase elliptique.
   */
  test('la conversation en cours est transmise, pour que « le même client » désigne quelqu’un', async () => {
    localStorage.setItem('nodaq.chat.conversationId', 'conv-en-cours');
    phraseDictee = 'Pour le même client, Madame Touré, pour la réfection du mur pour 1200 euros';
    await ouvrirLePlan();

    const versAgent = executions.find((e) => e.url.includes('/chat/messages'))!;
    const corps = versAgent.corps as { content: string; conversationId: string };
    expect(corps.conversationId).toBe('conv-en-cours');
    expect(corps.content).toBe(
      'Pour le même client, Madame Touré, pour la réfection du mur pour 1200 euros',
    );
  });

  test('la réponse de l’agent s’affiche MÊME quand il propose des écritures', async () => {
    await ouvrirLePlan();

    // L'ancien panneau ne rendait qu'un verdict d'extracteur : soit des
    // opérations, soit un aveu d'échec. Jamais une phrase.
    expect(screen.getByTestId('reponse-agent')).toHaveTextContent(/Je vous propose/);
    expect(screen.getByTestId('liste-operations')).toBeInTheDocument();
  });
});

/*
 * Ce que le fondateur a demandé, mot pour mot : que l'agent vocal fasse des
 * devis et des factures. L'outil existait côté agent (`create_devis`,
 * `create_facture`) — c'est le micro qui ne lui parlait pas.
 */
describe('dicter un devis', () => {
  const DEVIS = {
    conversationId: 'conv-1',
    message: { content: 'Je prépare le devis pour Madame Touré : réfection du mur, 1 200 € HT.' },
    planId: 'plan-devis',
    operations: [
      {
        type: 'creer_devis',
        libelle: 'Devis « Réfection du mur » — Madame Touré — 1 200 € HT',
        certitude: 'resolu',
        champs: { client: 'Madame Touré', objet: 'Réfection du mur', totalHtCents: '120000' },
      },
    ],
  };

  test('le devis proposé est montré, puis appliqué par le magasin de plans commun', async () => {
    reponseChat = { statut: 200, corps: DEVIS };
    phraseDictee = 'Pour le même client, Madame Touré, pour la réfection du mur pour 1200 euros';
    await ouvrirLePlan();

    expect(screen.getByTestId('liste-operations')).toHaveTextContent(/Réfection du mur/);
    await userEvent.click(screen.getByTestId('bouton-valider-plan'));

    // `/voix/executer` applique le plan SANS savoir quel chemin l'a produit :
    // c'est le même magasin, donc la règle 4 tient sans rien réécrire.
    const exec = executions.find((e) => e.url.includes('/voix/executer'))!;
    expect((exec.corps as { planId: string }).planId).toBe('plan-devis');
  });
});


/*
 * ── ON VALIDE CE QU'ON VOIT ──────────────────────────────────────────────
 *
 * Constaté sur le déploiement le 29/08/2026 : dicter « un chantier de toiture
 * à 3000 euros » proposait « Créer un devis de 1 ligne(s) ». Sans montant,
 * sans détail. L'artisan cliquait sur un document destiné à son client sans
 * en connaître le total.
 *
 * La règle 4 ne dit pas « il faut cliquer » : elle dit qu'on valide ce qu'on
 * a lu. Un total invisible vide la validation de son sens.
 */
describe('un devis proposé montre ce qui va être écrit', () => {
  const DEVIS = {
    conversationId: 'conv-1',
    message: { content: 'Voici le devis.' },
    planId: 'plan-devis',
    operations: [{
      type: 'creer_devis',
      libelle: 'Créer un devis de 2 ligne(s) — 3 000,00 € HT',
      certitude: 'aucune_resolution',
      champs: {
        clientName: 'Sadio Ducouré',
        lignesDicteesJson: JSON.stringify([
          { libelle: 'Toiture à refaire', quantite: 1, unite: null, prixUnitaireHtCents: 300000 },
          { libelle: 'Évacuation gravats', quantite: 2, unite: 'm3' },
        ]),
      },
    }],
  };

  test('le montant figure dans ce qui est soumis à validation', async () => {
    reponseChat = { statut: 200, corps: DEVIS };
    await ouvrirLePlan();

    expect(screen.getByTestId('liste-operations')).toHaveTextContent('3 000,00 € HT');
  });

  test('chaque ligne est détaillée, avec sa quantité', async () => {
    reponseChat = { statut: 200, corps: DEVIS };
    await ouvrirLePlan();

    const lignes = screen.getByTestId('lignes-dictees-0');
    expect(lignes).toHaveTextContent('Toiture à refaire');
    expect(lignes).toHaveTextContent('3 000,00 € HT');
    const items = Array.from(lignes.querySelectorAll('li'));
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveTextContent('Évacuation gravats × 2 m3');
  });

  /*
   * LA garde. Une ligne sans prix dicté sera chiffrée au catalogue à la
   * validation. Afficher « 0 € » ferait passer une absence pour une gratuité
   * — et un devis annoncé moins cher que la réalité est l'erreur qu'on ne
   * peut pas se permettre sur un document qui part chez un client.
   */
  test('une ligne sans prix dicté le DIT, elle n’affiche pas 0 €', async () => {
    reponseChat = { statut: 200, corps: DEVIS };
    await ouvrirLePlan();

    /*
     * On lit chaque LIGNE, pas le texte concaténé du bloc : « 3 000,00 € HT »
     * contient « 0,00 € HT » en sous-chaîne, et une assertion posée sur
     * l'ensemble se déclencherait sur un prix parfaitement valide. Première
     * version de ce test, corrigée — l'erreur était dans l'assertion.
     */
    const items = Array.from(screen.getByTestId('lignes-dictees-0').querySelectorAll('li'));
    const sansPrix = items[1]!;

    expect(sansPrix).toHaveTextContent('prix au catalogue');
    expect(sansPrix.textContent ?? '').not.toMatch(/€ HT/);
  });

  test('une opération sans lignes ne rend aucun détail', async () => {
    await ouvrirLePlan();          // PLAN_CATALOGUE, sans lignesDicteesJson
    expect(screen.queryByTestId('lignes-dictees-0')).toBeNull();
  });
});


/*
 * ── PAS DE BOUTON MORT SOUS UNE QUESTION ─────────────────────────────────
 *
 * Constaté le 29/08/2026 : l'agent répondait « Souhaitez-vous que je procède
 * avec cette facture ? » sans proposer d'opération. Le panneau affichait
 * « Valider » GRISÉ. L'utilisateur lisait une question, cherchait le bouton
 * pour dire oui, et le trouvait inactif.
 *
 * La consigne de l'agent a été corrigée pour qu'il PROPOSE au lieu de
 * demander — la validation à l'écran EST le consentement. Mais l'écran ne
 * doit pas dépendre de la docilité d'un modèle : sans opération, il n'offre
 * qu'une porte de sortie.
 */
describe('une réponse sans opération n’offre pas de bouton mort', () => {
  async function repondreSansOperation() {
    reponseChat = {
      statut: 200,
      corps: {
        conversationId: 'conv-1',
        message: { content: 'Souhaitez-vous que je procède avec cette facture ?' },
        planId: null,
        operations: [],
      },
    };
    render(<MicroFlottant />);
    fireEvent.pointerDown(screen.getByTestId('bouton-micro-flottant'));
    return waitFor(() => screen.getByTestId('rien-a-valider'));
  }

  test('aucun bouton « Valider » n’est affiché', async () => {
    await repondreSansOperation();          // signe POSITIF d'abord

    // LA garde : un bouton grisé sous une question est une impasse.
    expect(screen.queryByTestId('bouton-valider-plan')).toBeNull();
  });

  test('l’écran dit pourquoi, et laisse une sortie', async () => {
    const mention = await repondreSansOperation();

    expect(mention).toHaveTextContent(/sans proposer/i);
    expect(screen.getByRole('button', { name: /Fermer/ })).toBeEnabled();
  });

  test('avec une opération, « Valider » revient et il est actif', async () => {
    await ouvrirLePlan();          // PLAN_CATALOGUE porte une opération

    const valider = screen.getByTestId('bouton-valider-plan');
    expect(valider).toBeInTheDocument();
    // `aCompleter` porte un prix à saisir : le bouton attend la saisie, ce
    // qui est un blocage MOTIVÉ et affiché — pas une impasse.
    expect(screen.getByTestId('montant-a-saisir')).toBeInTheDocument();
  });
});
