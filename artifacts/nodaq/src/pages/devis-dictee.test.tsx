/**
 * Devis dicté — le devis ne perd JAMAIS de ligne en silence.
 *
 * Le défaut d'origine, relevé à l'usage : cinq ouvrages dictés, trois chiffrés
 * par le catalogue, deux « à compléter ». Après clic sur « Créer — Devis », le
 * document enregistré contenait TROIS lignes. Le message affiché disait
 * « Devis créé — relisez-le avant de l'envoyer ». Rien ne signalait la perte.
 *
 * Ce test existe parce qu'aucun test de logique pure ne pouvait le voir : c'est
 * un défaut de CHEMIN D'USAGE. Il faut cliquer pour le reproduire.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DevisDictee from "./devis-dictee";

// ── Simulacres ────────────────────────────────────────────────────────────────

const appelsApi: Array<{ url: string; corps: unknown }> = [];

vi.mock("@/lib/auth", () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const corps = init?.body ? JSON.parse(init.body as string) : null;
    appelsApi.push({ url, corps });

    if (url.includes("/devis/dictee/proposer")) {
      // Cinq ouvrages : trois chiffrés, deux sans prix.
      return new Response(
        JSON.stringify({
          lignes: [
            { libelle: "Cloison BA13", quantite: 30, unite: "m2", prixUnitaireHtCents: 4500, tauxTva: 20, provenance: "catalogue", catalogueLigneId: "a" },
            { libelle: "Peinture murs", quantite: 50, unite: "m2", prixUnitaireHtCents: 2200, tauxTva: 10, provenance: "catalogue", catalogueLigneId: "b" },
            { libelle: "Ragréage sol", quantite: 20, unite: "m2", prixUnitaireHtCents: 1800, tauxTva: 10, provenance: "catalogue", catalogueLigneId: "c" },
            { libelle: "Remplacement du vélux du fond", quantite: 1, unite: "u", prixUnitaireHtCents: null, tauxTva: null, provenance: "a_completer", catalogueLigneId: null },
            { libelle: "Reprise des joints de carrelage", quantite: 1, unite: "u", prixUnitaireHtCents: null, tauxTva: null, provenance: "a_completer", catalogueLigneId: null },
          ],
          totalHtCents: 281_000,
          lignesChiffrees: 3,
          lignesACompleter: 2,
          decoupageIllisible: false,
          catalogueVide: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ id: "devis-1", reference: "DEV-2026-0001" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/devis/dictee", vi.fn()] }));

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DevisDictee />
    </QueryClientProvider>,
  );
}

/** Appels de création de devis effectivement partis. */
const postsDevis = () => appelsApi.filter((a) => a.url.endsWith("/devis"));

beforeEach(() => {
  appelsApi.length = 0;
});

describe("le devis ne perd pas de ligne en silence", () => {
  test("5 lignes dont 2 sans prix : aucun POST /devis tant que ce n'est pas confirmé", async () => {
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.type(screen.getByRole("textbox", { name: "" }) ?? screen.getByPlaceholderText(/Dictez/i), "cloison");
    await utilisateur.click(screen.getByRole("button", { name: /Proposer les lignes/i }));
    await screen.findByDisplayValue("Cloison BA13");

    await utilisateur.type(screen.getByPlaceholderText(/Nom du client/i), "Madame Martin");
    await utilisateur.click(screen.getByRole("button", { name: /^Créer — Devis$/i }));

    // La confirmation s'ouvre et NOMME les deux ouvrages perdus.
    const dialogue = await screen.findByRole("alertdialog");
    expect(dialogue).toHaveTextContent("Remplacement du vélux du fond");
    expect(dialogue).toHaveTextContent("Reprise des joints de carrelage");

    // AUCUN devis n'a été créé à ce stade.
    expect(postsDevis()).toHaveLength(0);
  });

  test("après acceptation, le corps envoyé contient EXACTEMENT les 3 lignes chiffrées", async () => {
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.type(screen.getByPlaceholderText(/Dictez/i), "cloison");
    await utilisateur.click(screen.getByRole("button", { name: /Proposer les lignes/i }));
    await screen.findByDisplayValue("Cloison BA13");
    await utilisateur.type(screen.getByPlaceholderText(/Nom du client/i), "Madame Martin");
    await utilisateur.click(screen.getByRole("button", { name: /^Créer — Devis$/i }));

    await screen.findByRole("alertdialog");
    await utilisateur.click(screen.getByRole("button", { name: /Créer — Devis sans ces 2 lignes/i }));

    await waitFor(() => expect(postsDevis()).toHaveLength(1));

    const corps = postsDevis()[0]!.corps as { clientName: string; lines: Array<{ description: string }> };
    expect(corps.lines).toHaveLength(3);
    expect(corps.lines.map((l) => l.description)).toEqual([
      "Cloison BA13",
      "Peinture murs",
      "Ragréage sol",
    ]);
    // Et surtout : aucun total n'est envoyé — le serveur seul fait foi.
    expect(corps).not.toHaveProperty("totalHTCents");
  });

  test("« Revenir les compléter » ferme sans rien créer", async () => {
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.type(screen.getByPlaceholderText(/Dictez/i), "cloison");
    await utilisateur.click(screen.getByRole("button", { name: /Proposer les lignes/i }));
    await screen.findByDisplayValue("Cloison BA13");
    await utilisateur.type(screen.getByPlaceholderText(/Nom du client/i), "Madame Martin");
    await utilisateur.click(screen.getByRole("button", { name: /^Créer — Devis$/i }));

    await screen.findByRole("alertdialog");
    await utilisateur.click(screen.getByRole("button", { name: /Revenir les compléter/i }));

    expect(postsDevis()).toHaveLength(0);
  });
});

describe("relecture — le montant de chaque ligne est visible", () => {
  test("chaque ligne chiffrée affiche son montant, pas seulement le prix unitaire", async () => {
    const utilisateur = userEvent.setup();
    monter();

    await utilisateur.type(screen.getByPlaceholderText(/Dictez/i), "cloison");
    await utilisateur.click(screen.getByRole("button", { name: /Proposer les lignes/i }));
    await screen.findByDisplayValue("Cloison BA13");

    // Posé à la main : 30 × 45,00 € = 1 350,00 €. Sans cet affichage, l'artisan
    // devait faire le calcul de tête, cinq fois, sur le seul écran fait pour
    // relire avant signature.
    expect(screen.getByText(/1\s*350,00/)).toBeTruthy();
    // 50 × 22,00 € = 1 100,00 €
    expect(screen.getByText(/1\s*100,00/)).toBeTruthy();
    // L'étiquette du prix unitaire reste visible même le champ rempli.
    expect(screen.getAllByText("PU HT").length).toBeGreaterThan(0);
  });
});
