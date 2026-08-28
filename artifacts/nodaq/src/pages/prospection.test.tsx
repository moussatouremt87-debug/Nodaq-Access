/**
 * Les permis de particuliers, à l'écran.
 *
 * ── LE DÉFAUT QUE CES TESTS FIGENT ────────────────────────────────────────
 * La ligne était titrée par `nomDemandeur`. Or Sitadel ANONYMISE les
 * personnes physiques — 44 permis sur 100 mesurés n'en portent aucun. La
 * liste affichait donc, le plus souvent, une ligne vide surmontant une
 * seconde ligne en petits caractères : de loin, un écran cassé.
 *
 * L'adresse, elle, est publiée, et c'est ce dont l'artisan a besoin — il ne
 * peut pas appeler ce particulier, mais il passe devant le chantier. D'où le
 * cadrage : un SIGNAL DE CHANTIER, jamais une piste.
 *
 * ── ET CE QU'ILS EMPÊCHENT DE PERDRE ──────────────────────────────────────
 * La doctrine tient dans le dernier test : aucun moyen de contacter un
 * particulier ne doit apparaître ici, jamais. Le démarchage électronique à
 * froid d'un particulier sans consentement préalable est interdit
 * (art. L34-5 CPCE) — et la source ne publie de toute façon ni téléphone ni
 * e-mail. Une régression sur ce point ne se verrait pas à l'œil.
 *
 * ── SUR LES ASSERTIONS NÉGATIVES ──────────────────────────────────────────
 * Aucune n'est enveloppée dans un `waitFor` : l'attente s'arrêterait au
 * PREMIER rendu — celui du squelette de chargement, vide — et passerait au
 * vert sans avoir rien vu. On attend d'abord un signe POSITIF (la ligne est
 * là), puis on affirme le négatif dans la foulée.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const SOURCE = { label: 'Sitadel', url: 'https://exemple.test/sitadel' };

/** Le cas réel et majoritaire : le chantier est publié, la personne non. */
const PERMIS_ANONYME = {
  nomDemandeur: null,
  adresse: '12 chemin du Moulin',
  codePostal: '02120',
  commune: 'Marly-Gomont',
  dateOctroi: '2026-07-18',
  nature: 'Construction maison individuelle',
  superficieTerrain: 394,
  source: SOURCE,
};

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

/**
 * Les trois autres sections répondent VIDE, pas `{}`.
 *
 * L'écran déréférence `data.marches.length` : un `{}` fait lever le rendu
 * entier, et la section des permis — la seule qui nous intéresse — ne serait
 * jamais montée. Ce n'est pas un défaut du produit, c'est la forme la plus
 * creuse qui permet à l'écran d'arriver au bout de son rendu.
 */
const REPONSES: readonly (readonly [string, unknown])[] = [
  ['prospection/appels-offres', { marches: [] }],
  ['prospection/sous-traitance', { agregats: [], titulairesProfessionnels: [] }],
  ['prospection/syndics', { agregats: [], syndicsProfessionnels: [] }],
  ['prospection/permis', { pistesProfessionnelles: [], informationsParticuliers: [PERMIS_ANONYME] }],
];

vi.mock('@/lib/auth', () => ({
  apiFetch: vi.fn(async (url: string) => {
    const trouve = REPONSES.find(([fragment]) => url.includes(fragment));
    const corps = trouve ? trouve[1] : {};
    return new Response(JSON.stringify(corps), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
  useIsOwner: () => ({ isOwner: true, isLoading: false }),
}));

beforeEach(() => {
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  cleanup();
});

afterEach(() => cleanup());

async function afficher() {
  const { default: Prospection } = await import('./prospection');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <Prospection />
    </QueryClientProvider>,
  );
  // Le signe POSITIF qui prouve que l'écran a fini de charger.
  return waitFor(() => screen.getByTestId('permis-particulier-0'));
}

describe('un permis de particulier est un signal de chantier', () => {
  test("la ligne est nommée par l'ADRESSE, pas par un demandeur absent", async () => {
    const ligne = await afficher();

    // LA garde : titrer par `nomDemandeur` rendrait ici une chaîne vide.
    expect(ligne).toHaveTextContent('12 chemin du Moulin');
    expect(ligne.textContent?.trim().length).toBeGreaterThan(20);
  });

  test("la ligne annonce l'ampleur du chantier, pas seulement son existence", async () => {
    const ligne = await afficher();

    expect(ligne).toHaveTextContent('Construction maison individuelle');
    // La superficie distingue une véranda d'une maison entière : c'est elle
    // qui décide si le déplacement vaut la peine.
    expect(ligne).toHaveTextContent('394 m² de terrain');
  });

  test('le panneau ouvre le détail et cite sa source, même sans piste professionnelle', async () => {
    const ligne = await afficher();
    await userEvent.click(ligne);

    const champs = await screen.findByTestId('champs-piste');
    expect(champs).toHaveTextContent('12 chemin du Moulin');
    expect(champs).toHaveTextContent('02120 Marly-Gomont');
    expect(champs).toHaveTextContent('394 m² de terrain');

    // La source voyage avec la LIGNE. Elle se rabattait auparavant sur celle
    // de la première piste professionnelle — absente en production, où
    // `PERMIS_AFFICHER_PISTES_PRO` est désactivé : le lien pointait vers une
    // URL vide, sous le mot « Source ».
    const lien = screen.getByRole('link', { name: /Sitadel/ });
    expect(lien).toHaveAttribute('href', SOURCE.url);
  });

  test("un demandeur absent ne laisse AUCUNE ligne vide dans le détail", async () => {
    const ligne = await afficher();
    await userEvent.click(ligne);
    await screen.findByTestId('champs-piste');

    // Le champ n'est pas rendu du tout : « Demandeur — » ferait croire à une
    // donnée perdue alors que la source ne la publie pas.
    expect(screen.queryByText('Demandeur')).toBeNull();
  });

  test("aucun moyen de contacter le particulier n'est proposé, et le panneau le dit", async () => {
    const ligne = await afficher();
    await userEvent.click(ligne);

    const mention = await screen.findByTestId('mention-piste');
    expect(mention).toHaveTextContent(/PAS une piste à démarcher/);

    expect(screen.queryByRole('button', { name: /appeler|contacter|e-mail|envoyer/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^mailto:|^tel:/i })).toBeNull();

    /*
     * Et AUCUNE coordonnée affichée, actionnable ou non.
     *
     * Cette assertion a d'abord été écrite sur `mailto:` et `tel:` seulement.
     * Éprouvée par injection (règle 7), elle a laissé passer une ligne
     * « Contact — contact@exemple.test » ajoutée exprès dans le panneau : un
     * texte brut n'est pas un lien. La garde se lisait plus forte qu'elle
     * n'était. Elle porte désormais sur la FORME de la donnée, pas sur son
     * caractère cliquable — c'est afficher la coordonnée qui est refusé.
     */
    const valeurs = Array.from(
      screen.getByTestId('champs-piste').querySelectorAll('dd'),
    ).map((dd) => dd.textContent ?? '');

    /*
     * On lit les VALEURS, une par une — pas le `textContent` du panneau.
     *
     * Première version : la concaténation. `textContent` colle l'étiquette à
     * la valeur (« Téléphone06 12 34 56 78 »), et il n'y a alors AUCUNE
     * frontière de mot entre le « e » et le « 0 » : le motif ne se
     * déclenchait pas. Éprouvée par injection, la garde laissait passer un
     * numéro affiché en clair. Le défaut était dans l'assertion, pas dans
     * l'écran — mais une garde qui ne se déclenche pas ne protège rien.
     */
    for (const v of valeurs) {
      expect(v).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(v).not.toMatch(/(?:\+33|0)[\s.-]?[1-9](?:[\s.-]?\d{2}){4}/);
    }
    expect(document.body.innerHTML).not.toMatch(/mailto:|tel:\+/);
  });
});
