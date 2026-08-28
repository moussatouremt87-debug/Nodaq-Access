/**
 * Le panneau de détail d'une piste de prospection.
 *
 * ── CE QUE CES TESTS PROTÈGENT ────────────────────────────────────────────
 * Le premier est le plus important, et il n'a rien d'esthétique : une ligne
 * de piste doit être un VRAI bouton. Un `div` avec `onClick` s'ouvre à la
 * souris et reste inatteignable au clavier — la liste entière deviendrait
 * inutilisable pour qui n'utilise pas de souris, sans qu'aucun test de
 * comportement ne s'en aperçoive.
 *
 * Les autres tiennent la doctrine du produit là où elle se joue vraiment :
 * dans le détail qu'on ouvre au moment de décider d'appeler.
 *
 *   — un champ vide n'est pas rendu : une ligne « — » ferait croire à une
 *     donnée manquante alors que la source ne la publie pas ;
 *   — la source est citée DANS le panneau, pas seulement dans la liste ;
 *   — la mention d'un demandeur particulier est affichée, et le panneau
 *     n'offre aucun moyen de le contacter.
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanneauPiste, LignePiste, type PisteDetail } from './piste-detail';

const PISTE: PisteDetail = {
  titre: 'CABINET LAMBERT',
  sousTitre: 'Syndic de copropriété',
  champs: [
    { libelle: 'Commune', valeur: 'NANTES' },
    { libelle: 'Code postal', valeur: '44300' },
    // Ceux-ci ne doivent PAS apparaître.
    { libelle: 'Téléphone', valeur: null },
    { libelle: 'Courriel', valeur: '   ' },
  ],
  source: { label: 'RNIC', url: 'https://exemple.test/rnic' },
};

describe('LignePiste', () => {
  test("est un vrai bouton, donc atteignable au clavier", async () => {
    const ouvrir = vi.fn();
    render(<LignePiste onClick={ouvrir} testId="ligne">CABINET LAMBERT</LignePiste>);

    const ligne = screen.getByTestId('ligne');
    // LA garde : un `div` échouerait ici.
    expect(ligne.tagName).toBe('BUTTON');

    // Et il s'active à la touche Entrée, ce qu'un `div` ne fait pas.
    ligne.focus();
    await userEvent.keyboard('{Enter}');
    expect(ouvrir).toHaveBeenCalledTimes(1);
  });
});

describe('PanneauPiste', () => {
  test('fermé, il ne rend rien', () => {
    render(<PanneauPiste piste={null} onClose={() => {}} />);
    expect(screen.queryByTestId('champs-piste')).toBeNull();
  });

  test('ouvert, il montre les champs renseignés — et seulement eux', () => {
    render(<PanneauPiste piste={PISTE} onClose={() => {}} />);

    expect(screen.getByText('CABINET LAMBERT')).toBeInTheDocument();
    expect(screen.getByText('NANTES')).toBeInTheDocument();
    expect(screen.getByText('44300')).toBeInTheDocument();

    // Un champ vide n'apparaît pas, même par son libellé : afficher
    // « Téléphone — » ferait croire à une donnée perdue.
    expect(screen.queryByText('Téléphone')).toBeNull();
    expect(screen.queryByText('Courriel')).toBeNull();
  });

  test('la source est citée dans le panneau', () => {
    render(<PanneauPiste piste={PISTE} onClose={() => {}} />);
    const lien = screen.getByRole('link', { name: /RNIC/ });
    expect(lien).toHaveAttribute('href', 'https://exemple.test/rnic');
  });

  test("un particulier porte sa mention, et aucun moyen de le contacter", () => {
    render(
      <PanneauPiste
        piste={{
          ...PISTE,
          titre: 'DUPONT',
          mention: "Information publique portée par le permis — ce n'est PAS une piste à démarcher.",
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId('mention-piste')).toHaveTextContent("PAS une piste à démarcher");
    // Aucun bouton d'action : le seul lien est celui de la source.
    expect(screen.queryByRole('button', { name: /appeler|contacter|e-mail/i })).toBeNull();
  });
});
