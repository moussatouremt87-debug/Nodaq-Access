/**
 * US-A8.2, AC1 et AC3 — chaque écran passe l'audit WCAG 2.1 AA.
 *
 * Le périmètre n'est pas décidé ici : il vient de `ECRANS_AUDITES`, et
 * `accessibilite-parite.test.ts` garantit que ce registre couvre bien toutes
 * les routes de `App.tsx`. Les deux fichiers ne valent que l'un par l'autre.
 *
 * ── Il faut attendre que l'écran soit là ─────────────────────────────────
 * Première version de ce fichier : `render` puis `axe.run` dans la foulée.
 * Les résultats CHANGEAIENT d'une exécution à l'autre — un écran rendait un
 * squelette de chargement ici, son contenu réel là. Un audit qui dépend de
 * l'ordonnancement ne dit rien, et un squelette ne viole évidemment rien :
 * la version instable était surtout trop indulgente.
 *
 * `stabiliser()` laisse donc les requêtes se résoudre avant de mesurer, et
 * `SUBSTANCE_MINIMALE` refuse d'auditer un écran resté vide. Sans ce second
 * garde-fou, un écran qui cesserait de se rendre passerait l'audit avec les
 * félicitations.
 *
 * ── Ce que jsdom ne peut pas dire ────────────────────────────────────────
 * jsdom ne calcule ni mise en page ni couleurs composées. Les règles qui en
 * dépendent — `color-contrast` au premier chef — ressortent en « incomplete »
 * et non en violation : axe dit qu'il n'a pas pu conclure, pas que c'est bon.
 * Le contraste est couvert ailleurs, sur les jetons, par `terrain.test.ts`
 * (US-A8.1). Ne pas croire cette suite exhaustive.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { ECRANS_AUDITES, SOCLE_CONNU, REGLES_WCAG } from './accessibilite';

/** En deçà, l'écran ne s'est pas rendu : on n'auditerait que du vide. */
const SUBSTANCE_MINIMALE = 8;

// ── Harnais générique, repris de `pages/onboarding.test.tsx` ───────────────
// Le réseau répond un objet vide : on audite la STRUCTURE de l'écran, pas ses
// données. Un écran dont l'accessibilité dépendrait des données aurait de
// toute façon un problème plus grave.
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

/**
 * Réponses minimales, par fragment d'URL.
 *
 * Le repli est `{}` : on audite la STRUCTURE d'un écran, pas ses données.
 * Mais un écran qui déréférence `data.marches.length` LÈVE sur `{}`, ne rend
 * rien, et passerait alors l'audit sans qu'aucune de ses commandes n'ait été
 * examinée. Ces entrées existent uniquement pour que ces écrans-là arrivent
 * jusqu'au bout de leur rendu — la forme la plus creuse qui y suffit, pas un
 * jeu de données réaliste.
 *
 * `SUBSTANCE_MINIMALE` reste le garde-fou : si un écran cesse de se rendre
 * parce qu'il attend désormais autre chose, l'audit échoue au lieu de
 * verdir.
 */
const REPONSES: readonly (readonly [string, unknown])[] = [
  // Sans une identité authentifiée, l'écran MFA renvoie vers /login et ne rend
  // qu'un chargement : on auditerait un spinner.
  ['auth/me', { authenticated: true, mfaStatus: 'ok', role: 'OWNER' }],
  ['mfa/status', { enabled: true, recoveryCodesRemaining: 8 }],
  ['journal-decisions', []],
  ['analytics/indicateurs', []],
  ['prospection/appels-offres', { marches: [] }],
  ['prospection/sous-traitance', { agregats: [], titulairesProfessionnels: [] }],
  ['prospection/syndics', { agregats: [], syndicsProfessionnels: [] }],
  ['prospection/permis', { pistesProfessionnelles: [], informationsParticuliers: [] }],
  ['pointages/recapitulatif-semaine', { semaine: { debut: '2026-08-17', fin: '2026-08-23' }, lignes: [] }],
  [
    'equipe/plannings',
    {
      horizonPhrase: 'Aucun engagement enregistré.',
      horizonSous: '',
      horizon: null,
      membres: [],
      journees: { etat: 'PARAMETRES_MANQUANTS' },
      coutJourCharge: 0,
    },
  ],
  ['equipe', []],
];

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async (url: string) => {
    const trouve = REPONSES.find(([fragment]) => url.includes(fragment));
    return new Response(JSON.stringify(trouve ? trouve[1] : {}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
  useIsOwner: () => ({ isOwner: true, isLoading: false }),
}));

// jsdom n'implémente pas le défilement. C'est un manque de l'environnement de
// test, pas un défaut du produit : sans ce bouchon, l'écran de discussion
// lèverait au montage et sortirait de l'audit par la porte de service.
beforeEach(() => {
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  cleanup();
});

afterEach(() => {
  cleanup();
});

function harnais(Page: React.ComponentType) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

/** Laisse les requêtes se résoudre et les effets se poser. */
async function stabiliser(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Les identifiants de règles violées sur un conteneur, triés. */
async function reglesViolees(element: HTMLElement): Promise<string[]> {
  const resultat = await axe.run(element, {
    runOnly: { type: 'tag', values: [...REGLES_WCAG] },
    resultTypes: ['violations'],
  });
  return [...new Set(resultat.violations.map((v) => v.id))].sort();
}

const auditables = ECRANS_AUDITES.filter((e) => e.charger);

describe('a — AC1 : les écrans respectent WCAG 2.1 AA', () => {
  for (const ecran of auditables) {
    test(
      `${ecran.chemin}`,
      async () => {
        const module = await ecran.charger!();
        const { container } = harnais(module.default);
        await stabiliser();

        expect(
          container.querySelectorAll('*').length,
          `${ecran.chemin} : l'écran ne s'est pas rendu — l'auditer ne prouverait rien. Soit le harnais ne lui suffit plus, soit il faut l'exempter en le justifiant.`,
        ).toBeGreaterThanOrEqual(SUBSTANCE_MINIMALE);

        const violees = await reglesViolees(container);
        const attendues = [...(SOCLE_CONNU[ecran.chemin] ?? [])].sort();

        // Égalité, pas inclusion. Une inclusion laisserait passer un socle
        // périmé : la ligne resterait après réparation, et la dette
        // paraîtrait plus grande qu'elle n'est — jusqu'à ce que plus
        // personne ne la relise.
        expect(
          violees,
          violees.length > attendues.length
            ? `${ecran.chemin} : nouvelle(s) violation(s) WCAG AA. Corriger l'écran — ou, si c'est délibéré, l'inscrire au socle de src/lib/accessibilite.ts en le justifiant.`
            : `${ecran.chemin} : le socle annonce des violations qui n'existent plus. Retirer les lignes réparées de SOCLE_CONNU.`,
        ).toEqual(attendues);
      },
      30_000,
    );
  }
});

describe("b — l'audit tourne réellement", () => {
  test('axe est bien câblé et sait détecter une violation', async () => {
    // Une garde qu'on n'a jamais vue se déclencher n'est pas une garde. Si
    // `axe.run` était mal branché, tous les tests ci-dessus rendraient une
    // liste vide et passeraient — le pire des faux verts.
    const { container } = render(
      <button>
        <img src="/x.png" />
      </button>,
    );
    const violees = await reglesViolees(container);
    expect(violees, "axe ne détecte pas une image sans alternative textuelle").toContain(
      'image-alt',
    );
  });

  test('le périmètre audité couvre bien l’essentiel des écrans', () => {
    expect(auditables.length).toBeGreaterThan(25);
  });
});
