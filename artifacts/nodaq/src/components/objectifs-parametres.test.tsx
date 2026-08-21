/**
 * Répartition de marge par catégorie (US-A3.3) — le formulaire replié par
 * défaut (taux unique inchangé), la bascule vers la répartition, et surtout
 * la garde côté sauvegarde : désactiver le mode doit effacer une
 * répartition existante, pas la laisser active en silence côté serveur.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ObjectifsParametres } from "./objectifs-parametres";

const appelsApi: Array<{ url: string; corps: unknown }> = [];

vi.mock("@/lib/auth", () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const corps = init?.body ? JSON.parse(init.body as string) : null;
    appelsApi.push({ url, corps });
    if (init?.method === "PATCH") {
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-vertical", () => ({
  useVertical: () => ({ words: { singular: "chantier", plural: "chantiers" } }),
}));

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ObjectifsParametres />
    </QueryClientProvider>,
  );
}

const patchsEnvoyes = () => appelsApi.filter((a) => a.url.endsWith("/parametres") && a.corps);

beforeEach(() => {
  appelsApi.length = 0;
});

describe("mode replié par défaut", () => {
  test("le taux unique est affiché, la répartition par catégorie ne l'est pas", async () => {
    monter();
    await waitFor(() => expect(screen.getByLabelText(/Taux de marge sur coûts variables/i)).toBeTruthy());
    expect(screen.queryByTestId("repartition-categories")).toBeNull();
  });
});

describe("bascule vers la répartition par catégorie", () => {
  test("cocher la case fait disparaître le taux unique, apparaître les catégories", async () => {
    const utilisateur = userEvent.setup();
    monter();
    await waitFor(() => expect(screen.getByLabelText(/Taux de marge sur coûts variables/i)).toBeTruthy());

    await utilisateur.click(screen.getByText(/Mes marges varient selon mes produits/i));

    expect(screen.queryByLabelText(/Taux de marge sur coûts variables/i)).toBeNull();
    expect(screen.getByTestId("repartition-categories")).toBeTruthy();
  });

  test("l'aperçu du taux pondéré se met à jour en direct, sans appel réseau", async () => {
    const utilisateur = userEvent.setup();
    monter();
    await waitFor(() => expect(screen.getByLabelText(/Taux de marge sur coûts variables/i)).toBeTruthy());
    await utilisateur.click(screen.getByText(/Mes marges varient selon mes produits/i));

    const appelsAvant = appelsApi.length;
    const libelles = screen.getAllByPlaceholderText("ex. Alimentaire");
    const marges = screen.getAllByPlaceholderText("20");
    const parts = screen.getAllByPlaceholderText("60");

    await utilisateur.type(libelles[0]!, "Alimentaire");
    await utilisateur.type(marges[0]!, "20");
    await utilisateur.type(parts[0]!, "60");
    await utilisateur.type(libelles[1]!, "Bazar");
    await utilisateur.type(marges[1]!, "50");
    await utilisateur.type(parts[1]!, "40");

    // (20×60 + 50×40) / 100 = 32 %.
    await waitFor(() => expect(screen.getByTestId("echo-taux-pondere")).toHaveTextContent("32"));
    // Aucun appel réseau pour cet aperçu — purement local.
    expect(appelsApi.length).toBe(appelsAvant);
  });
});

describe("sauvegarde — désactiver la répartition l'efface côté serveur", () => {
  test("mode replié : envoie le taux unique ET repartition_marge_json vide", async () => {
    const utilisateur = userEvent.setup();
    monter();
    await waitFor(() => expect(screen.getByLabelText(/Charges fixes annuelles/i)).toBeTruthy());

    await utilisateur.type(screen.getByLabelText(/Charges fixes annuelles/i), "120000");
    await utilisateur.type(screen.getByLabelText(/Taux de marge sur coûts variables/i), "35");
    await utilisateur.click(screen.getByRole("button", { name: /Enregistrer/i }));

    await waitFor(() => expect(patchsEnvoyes()).toHaveLength(1));
    const corps = patchsEnvoyes()[0]!.corps as Record<string, string>;
    expect(corps["objectifs.taux_marge_bp"]).toBe("3500");
    expect(corps["objectifs.repartition_marge_json"]).toBe("[]");
  });

  test("mode déplié : envoie la répartition, pas le taux unique", async () => {
    const utilisateur = userEvent.setup();
    monter();
    await waitFor(() => expect(screen.getByLabelText(/Charges fixes annuelles/i)).toBeTruthy());
    await utilisateur.type(screen.getByLabelText(/Charges fixes annuelles/i), "120000");
    await utilisateur.click(screen.getByText(/Mes marges varient selon mes produits/i));

    const libelles = screen.getAllByPlaceholderText("ex. Alimentaire");
    const marges = screen.getAllByPlaceholderText("20");
    const parts = screen.getAllByPlaceholderText("60");
    await utilisateur.type(libelles[0]!, "Alimentaire");
    await utilisateur.type(marges[0]!, "20");
    await utilisateur.type(parts[0]!, "60");

    await utilisateur.click(screen.getByRole("button", { name: /Enregistrer/i }));

    await waitFor(() => expect(patchsEnvoyes()).toHaveLength(1));
    const corps = patchsEnvoyes()[0]!.corps as Record<string, string>;
    expect(corps).not.toHaveProperty("objectifs.taux_marge_bp");
    const repartition = JSON.parse(corps["objectifs.repartition_marge_json"]!) as Array<{ libelle: string }>;
    expect(repartition).toHaveLength(1);
    expect(repartition[0]!.libelle).toBe("Alimentaire");
  });
});
