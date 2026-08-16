/**
 * Régression — US-A6.2 : le panneau "Actions à valider" ne doit jamais
 * confondre un échec de chargement avec une liste réellement vide.
 *
 * `usePendingActions()` n'avait aucune gestion d'erreur : une requête en
 * échec laissait `data` à `undefined` pour toujours (le QueryClient global
 * de l'app désactive `retry` et `refetchOnWindowFocus` — App.tsx), et
 * `cockpit.tsx` rendait alors le même état "Rien à valider" qu'un vide
 * légitime. Ce test protège la couche donnée : `isError` doit bien
 * remonter `true` quand le fetch échoue, pour que le panneau puisse
 * l'afficher distinctement (voir cockpit.tsx, bandeau dédié).
 */
import { describe, test, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePendingActions } from "./use-cockpit";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  // retry:false ICI n'annule pas le retry:2 posé par usePendingActions() —
  // une option de query explicite l'emporte toujours sur les défauts du
  // QueryClient, exactement le comportement que ce hook exploite en prod
  // pour survivre à un échec transitoire sans dépendre du retry global.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("usePendingActions — erreur distincte d'un vide réel", () => {
  test("data vide légitime → isError reste false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));

    const { result } = renderHook(() => usePendingActions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([]);

    vi.unstubAllGlobals();
  });

  test("échec de la requête → isError devient true (pas juste data vide)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "panne simulée" }, 500)),
    );

    const { result } = renderHook(() => usePendingActions(), { wrapper });

    // Le hook retente 2 fois (retry:2, posé dans use-cockpit.ts) avant de
    // se stabiliser en erreur — délai généreux pour couvrir le backoff.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 10_000 });
    expect(result.current.data).toBeUndefined();
  }, 15_000);
});
