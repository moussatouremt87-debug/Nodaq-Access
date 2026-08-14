/**
 * Régression UAT — la fiche affaire ne se rafraîchissait pas après
 * modification.
 *
 * `useUpdateAffaireMutation` invalidait la liste, les stats et le cockpit,
 * mais jamais la clé de requête de LA FICHE elle-même
 * (`getGetAffaireQueryKey(id)`, indépendante de celle de la liste). Un
 * composant abonné à `useAffaire(id)` — la page `/affaires/:id` — continuait
 * donc d'afficher les anciennes valeurs après "Enregistrer", alors que
 * l'écriture avait bien réussi côté serveur : il fallait recharger la page à
 * la main pour voir le changement.
 */
import { describe, test, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAffaire, useUpdateAffaireMutation } from "./use-affaires";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const AFFAIRE_ID = "affaire-test-1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Harness() {
  const { data } = useAffaire(AFFAIRE_ID);
  const { updateAffaire } = useUpdateAffaireMutation();
  return (
    <div>
      <span data-testid="statut">{data?.status ?? "…"}</span>
      <button
        onClick={() => updateAffaire(AFFAIRE_ID, { status: "EN_COURS" })}
      >
        Enregistrer
      </button>
    </div>
  );
}

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("useUpdateAffaireMutation invalide aussi la fiche détail", () => {
  test("le composant affiche le nouveau statut sans remontage manuel", async () => {
    let statutServeur = "ACCEPTEE";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith(`/api/affaires/${AFFAIRE_ID}`) && method === "GET") {
        return jsonResponse({ id: AFFAIRE_ID, label: "Test", status: statutServeur });
      }
      if (url.endsWith(`/api/affaires/${AFFAIRE_ID}`) && method === "PATCH") {
        statutServeur = "EN_COURS";
        return jsonResponse({ id: AFFAIRE_ID, label: "Test", status: statutServeur });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    monter();

    await screen.findByText("ACCEPTEE");

    screen.getByRole("button", { name: "Enregistrer" }).click();

    // Sans l'invalidation de la fiche détail, ce texte resterait "ACCEPTEE"
    // indéfiniment — la mutation réussit, mais rien ne redemande cette clé.
    await waitFor(() => expect(screen.getByTestId("statut").textContent).toBe("EN_COURS"));

    vi.unstubAllGlobals();
  });
});
