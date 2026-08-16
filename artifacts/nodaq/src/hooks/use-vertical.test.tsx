/**
 * `useVertical` — `delaiPaiementUsuelJours` (US-A3.1) reflète bien
 * `verticalPack(vertical).delaiPaiementUsuelJours`, pour deux verticaux
 * contrastés. Régression : ce champ vient d'un pack isomorphe déjà chargé
 * côté client (pas d'appel réseau supplémentaire) — un test qui l'oublierait
 * dans le retour du hook ne serait détecté qu'en recette visuelle.
 */
import { describe, test, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useVertical } from "./use-vertical";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useVertical — delaiPaiementUsuelJours", () => {
  test("retail → 0 (encaissement comptant)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ metier: "retail" })));

    const { result } = renderHook(() => useVertical(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.delaiPaiementUsuelJours).toBe(0);

    vi.unstubAllGlobals();
  });

  test("batiment → 30 (délai B2B standard)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ metier: "batiment" })));

    const { result } = renderHook(() => useVertical(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.delaiPaiementUsuelJours).toBe(30);

    vi.unstubAllGlobals();
  });
});
