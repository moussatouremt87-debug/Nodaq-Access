/**
 * Onboarding — l'écran secteur est le premier (US-A1.1).
 *
 * Avant US-A1.1, la première question de l'onboarding était la recherche
 * SIRET : un utilisateur hors bâtiment ne voyait jamais la question qui
 * détermine le vocabulaire du reste du produit. Ces tests couvrent
 * uniquement le nouvel écran — pas le reste du parcours, déjà en place.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OnboardingPage from "./onboarding";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const patchCalls: Array<{ url: string; body: unknown }> = [];

vi.mock("@/lib/auth", () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/votre-metier") && init?.method === "PATCH") {
      const body = JSON.parse(init.body as string);
      patchCalls.push({ url, body });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }),
}));

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OnboardingPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  patchCalls.length = 0;
});

describe("l'écran secteur est le premier écran affiché", () => {
  test("la question porte sur le secteur, pas sur le SIRET", async () => {
    monter();
    expect(await screen.findByText(/quel est votre secteur d'activité/i)).toBeTruthy();
    expect(screen.queryByText(/recherchez votre entreprise/i)).toBeNull();
  });

  test("les 9 secteurs minimum du backlog sont proposés", async () => {
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);
    for (const id of [
      "batiment", "retail", "restauration_chr", "services_personne",
      "professions_liberales", "artisanat_service", "services_entreprises",
      "transport", "sante_liberale",
    ]) {
      expect(screen.getByTestId(`option-secteur-${id}`)).toBeTruthy();
    }
  });

  test("choisir un secteur puis continuer l'enregistre et avance à l'écran suivant", async () => {
    const utilisateur = userEvent.setup();
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);

    await utilisateur.click(screen.getByTestId("option-secteur-professions_liberales"));
    await utilisateur.click(screen.getByRole("button", { name: /continuer/i }));

    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]!.body).toEqual({ metier: "professions_liberales" });

    // L'écran suivant (recherche SIRET) doit être affiché — preuve que la
    // navigation a bien avancé après la sauvegarde.
    await waitFor(() => expect(screen.queryByText(/quel est votre secteur d'activité/i)).toBeNull());
  });

  test('"Plus tard" avance sans enregistrer aucun secteur', async () => {
    const utilisateur = userEvent.setup();
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);

    await utilisateur.click(screen.getByRole("button", { name: /plus tard/i }));

    await waitFor(() => expect(screen.queryByText(/quel est votre secteur d'activité/i)).toBeNull());
    expect(patchCalls).toHaveLength(0);
  });
});
