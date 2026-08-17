/**
 * Vocabulaire de la modale affaire (US-A4.1, oubli résiduel) — le titre, la
 * description et le bouton de soumission doivent suivre le mot du métier
 * (`useVertical`), pas rester figés sur "affaire" comme avant ce correctif.
 */
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AffaireDialog } from "./affaire-dialog";

const useVerticalMock = vi.fn();

vi.mock("@/hooks/use-vertical", () => ({
  useVertical: () => useVerticalMock(),
}));

vi.mock("@/hooks/use-affaires", () => ({
  useCreateAffaireMutation: () => ({ createAffaire: vi.fn(), isPending: false }),
  useUpdateAffaireMutation: () => ({ updateAffaire: vi.fn(), isPending: false }),
}));

const WORDS_BATIMENT = {
  singular: "chantier",
  plural: "chantiers",
  indefinite: "un chantier",
  definite: "le chantier",
  newLabel: "Nouveau chantier",
  noneLabel: "Aucun chantier",
};

const WORDS_SERVICES_PROJET = {
  singular: "mission",
  plural: "missions",
  indefinite: "une mission",
  definite: "la mission",
  newLabel: "Nouvelle mission",
  noneLabel: "Aucune mission",
};

describe("création — le mot du métier remplace \"affaire\" partout", () => {
  test("vertical bâtiment : chantier", () => {
    useVerticalMock.mockReturnValue({ words: WORDS_BATIMENT });
    render(<AffaireDialog open onOpenChange={() => {}} />);

    expect(screen.getByText("Nouveau chantier")).toBeTruthy();
    expect(screen.getByText("Renseignez les informations pour créer un chantier.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Créer un chantier" })).toBeTruthy();
  });

  test("vertical services_projet : mission", () => {
    useVerticalMock.mockReturnValue({ words: WORDS_SERVICES_PROJET });
    render(<AffaireDialog open onOpenChange={() => {}} />);

    expect(screen.getByText("Nouvelle mission")).toBeTruthy();
    expect(screen.getByText("Renseignez les informations pour créer une mission.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Créer une mission" })).toBeTruthy();
  });
});

describe("édition — le titre et la description suivent aussi le mot du métier", () => {
  test("vertical bâtiment : chantier", () => {
    useVerticalMock.mockReturnValue({ words: WORDS_BATIMENT });
    render(
      <AffaireDialog
        open
        onOpenChange={() => {}}
        affaire={{ id: "a1", label: "Toiture Dupont" } as never}
      />,
    );

    expect(screen.getByText("Modifier le chantier")).toBeTruthy();
    expect(screen.getByText("Mettez à jour le chantier.")).toBeTruthy();
    // Le bouton reste "Enregistrer" en édition, neutre quel que soit le métier.
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeTruthy();
  });
});

describe("habilitations requises (US-A4.4)", () => {
  test("ajout en texte libre : la puce apparaît", async () => {
    const utilisateur = userEvent.setup();
    useVerticalMock.mockReturnValue({ words: WORDS_BATIMENT, vertical: "batiment" });
    render(<AffaireDialog open onOpenChange={() => {}} />);

    await utilisateur.type(screen.getByTestId("input-habilitation-libre"), "Carte pro sécurité");
    await utilisateur.click(screen.getByTestId("button-ajouter-habilitation"));

    expect(screen.getByText("Carte pro sécurité")).toBeTruthy();
    // Le champ se vide après ajout, prêt pour une nouvelle saisie.
    expect(screen.getByTestId("input-habilitation-libre")).toHaveValue("");
  });

  test("une puce se retire", async () => {
    const utilisateur = userEvent.setup();
    useVerticalMock.mockReturnValue({ words: WORDS_BATIMENT, vertical: "batiment" });
    render(<AffaireDialog open onOpenChange={() => {}} />);

    await utilisateur.type(screen.getByTestId("input-habilitation-libre"), "Carte pro sécurité");
    await utilisateur.click(screen.getByTestId("button-ajouter-habilitation"));
    expect(screen.getByText("Carte pro sécurité")).toBeTruthy();

    await utilisateur.click(screen.getByLabelText("Retirer Carte pro sécurité"));
    expect(screen.queryByText("Carte pro sécurité")).toBeNull();
  });

  test("un clic sur Ajouter avec un champ vide ne plante pas et n'ajoute rien", async () => {
    const utilisateur = userEvent.setup();
    useVerticalMock.mockReturnValue({ words: WORDS_BATIMENT, vertical: "batiment" });
    render(<AffaireDialog open onOpenChange={() => {}} />);

    await utilisateur.click(screen.getByTestId("button-ajouter-habilitation"));
    expect(screen.queryByRole("button", { name: /Retirer/ })).toBeNull();
  });

  test("ajouter deux fois le même texte ne crée pas de doublon", async () => {
    const utilisateur = userEvent.setup();
    useVerticalMock.mockReturnValue({ words: WORDS_BATIMENT, vertical: "batiment" });
    render(<AffaireDialog open onOpenChange={() => {}} />);

    await utilisateur.type(screen.getByTestId("input-habilitation-libre"), "Carte pro");
    await utilisateur.click(screen.getByTestId("button-ajouter-habilitation"));
    await utilisateur.type(screen.getByTestId("input-habilitation-libre"), "Carte pro");
    await utilisateur.click(screen.getByTestId("button-ajouter-habilitation"));

    expect(screen.getAllByText("Carte pro")).toHaveLength(1);
  });

  test("une affaire existante pré-remplit ses habilitations requises", () => {
    useVerticalMock.mockReturnValue({ words: WORDS_BATIMENT, vertical: "batiment" });
    render(
      <AffaireDialog
        open
        onOpenChange={() => {}}
        affaire={{ id: "a1", label: "Toiture Dupont", habilitationsRequises: ["habilitation_electrique"] } as never}
      />,
    );
    // "habilitation_electrique" est une suggestion connue du vertical bâtiment :
    // la puce affiche son libellé lisible, pas la clé technique.
    const puce = screen.getByTestId("badge-habilitation-requise");
    expect(puce.textContent).toContain("Habilitation électrique");
  });
});
