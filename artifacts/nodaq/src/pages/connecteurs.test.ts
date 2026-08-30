/**
 * Connecter ses outils sans manipuler les secrets de la plateforme.
 *
 * Ces tests mêlent deux gardes :
 * - les gardes de source empêchent un champ technique de réapparaître dans le
 *   parcours ordinaire ;
 * - les tests rendus prouvent que les vrais boutons appellent les vraies
 *   routes et que les états affichés ne promettent pas une automatisation qui
 *   n'existe pas encore.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ConnecteursPage from "./connecteurs";

const { apiFetchMock, toastMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ apiFetch: apiFetchMock }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

const SOURCE = readFileSync(join(__dirname, "connecteurs.tsx"), "utf8");

type ConnectorStatus = "NON_CONNECTE" | "CONNECTE" | "ERREUR";
type TestConnector = {
  id: string;
  type: string;
  label: string;
  description: string;
  status: ConnectorStatus;
  config: Record<string, string | boolean>;
  lastSyncAt: string | null;
  createdAt: string;
  connectionMode?: "OAUTH" | "ADVANCED";
  available?: boolean;
};

type TestInvitationResponse = {
  envoye: boolean;
  motifEchec: string | null;
  lienInvitation: string;
  supplementInvitation: { prixMensuelCents: number } | null;
};

const LABELS: Record<string, string> = {
  BANQUE: "Banque",
  PENNYLANE: "Pennylane",
  STRIPE: "Stripe",
  GOOGLE_DRIVE: "Google Drive",
  SLACK: "Slack",
  ZAPIER: "Zapier",
};
const CONNECTION_ID = "22222222-2222-4222-8222-222222222222";
const EXTERNAL_REVOCATION_ID = "33333333-3333-4333-8333-333333333333";

function connector(
  type: string,
  status: ConnectorStatus = "NON_CONNECTE",
  available = true,
): TestConnector {
  return {
    id: `connector-${type}`,
    type,
    label: LABELS[type] ?? type,
    description: "Description technique historique",
    status,
    config: status === "CONNECTE" ? { connectionId: CONNECTION_ID } : {},
    lastSyncAt: status === "CONNECTE" ? "2026-08-30T10:00:00.000Z" : null,
    createdAt: "2026-08-30T09:00:00.000Z",
    ...(type === "BANQUE"
      ? {}
      : { connectionMode: type === "ZAPIER" ? "ADVANCED" as const : "OAUTH" as const, available }),
  };
}

let connectors: TestConnector[];
let invitationResponse: TestInvitationResponse;
let disconnectExternalActionRequired: boolean;
let disconnectResponseConfig: Record<string, string | boolean> | undefined;
const calls: Array<{ url: string; method?: string; body: unknown }> = [];

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function showPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ConnecteursPage),
    ),
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/connecteurs");
  connectors = [
    connector("BANQUE"),
    connector("PENNYLANE"),
    connector("STRIPE"),
    connector("GOOGLE_DRIVE"),
    connector("SLACK"),
    connector("ZAPIER"),
  ];
  invitationResponse = {
    envoye: true,
    lienInvitation: "https://nodaq.test/membres/accepter/token-test",
    motifEchec: null,
    supplementInvitation: null,
  };
  disconnectExternalActionRequired = false;
  disconnectResponseConfig = undefined;
  calls.length = 0;
  toastMock.mockReset();
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init?.method, body });

    if (url === "/api/connecteurs" && !init?.method) {
      return response({
        connectors,
        connected: connectors.filter((item) => item.status === "CONNECTE").length,
        withError: connectors.filter((item) => item.status === "ERREUR").length,
        total: connectors.length,
      });
    }
    if (url.endsWith("/autorisation") && init?.method === "POST") {
      // Une navigation vers un fragment est prise en charge par jsdom et
      // suffit à vérifier le passage de relais sans simuler le fournisseur.
      return response({ url: "#autorisation-externe" });
    }
    if (url === "/api/connecteurs/banque/session" && init?.method === "POST") {
      return response({ url: "#gestion-bancaire" });
    }
    if (url.endsWith("/avance") && init?.method === "POST") return response({ status: "CONNECTE" });
    if (url === "/api/membres/inviter" && init?.method === "POST") {
      return response(invitationResponse, 201);
    }
    if (init?.method === "PATCH") {
      return response({
        status: "NON_CONNECTE",
        externalActionRequired: disconnectExternalActionRequired,
        ...(disconnectResponseConfig ? { config: disconnectResponseConfig } : {}),
      });
    }
    throw new Error(`Appel inattendu : ${init?.method ?? "GET"} ${url}`);
  });
});

afterEach(() => cleanup());

describe("le parcours ordinaire ne demande aucun secret", () => {
  test.each([
    "Secret key Stripe",
    "Webhook secret",
    "Client ID",
    "Client secret",
    "Webhook URL",
  ])("le libellé technique « %s » a disparu", (label) => {
    expect(SOURCE).not.toContain(label);
  });

  test("Pennylane, Stripe, Google Drive et Slack passent par l'autorisation hébergée", async () => {
    showPage();

    await userEvent.click(await screen.findByRole("button", { name: "Se connecter à Pennylane" }));

    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/connecteurs/PENNYLANE/autorisation",
        method: "POST",
        body: null,
      });
    });
    expect(screen.queryByLabelText(/clé api|client secret|secret key|webhook/i)).toBeNull();
    for (const label of ["Stripe", "Google Drive", "Slack"]) {
      expect(screen.getByRole("button", { name: `Se connecter à ${label}` })).toBeEnabled();
    }
  });

  test("un fournisseur non configuré est annoncé avant le clic", async () => {
    connectors = connectors.map((item) => item.type === "SLACK" ? { ...item, available: false } : item);
    showPage();

    const card = await screen.findByTestId("recette-SLACK");
    expect(within(card).getByText("Bientôt disponible")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Se connecter à Slack" })).toBeDisabled();
  });

  test("un retour OAuth refusé rassure puis disparaît de l'adresse", async () => {
    window.history.replaceState({}, "", "/connecteurs?erreur=SLACK");
    showPage();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "La connexion n'a pas abouti",
        description: "Rien n'a été enregistré dans nodaq. Vérifiez les connexions autorisées dans les réglages du fournisseur avant de réessayer.",
        variant: "destructive",
      });
    });
    expect(new URLSearchParams(window.location.search).has("erreur")).toBe(false);
  });

  test("un droit externe restant après un échec donne l'action à faire", async () => {
    window.history.replaceState({}, "", "/connecteurs?erreur=AUTORISATION_A_RETIRER");
    showPage();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "La connexion n'a pas été enregistrée",
        description: "Rien n'a été enregistré dans nodaq. Retirez l'accès depuis les réglages du fournisseur avant de réessayer.",
        variant: "destructive",
      });
    });
    expect(new URLSearchParams(window.location.search).has("erreur")).toBe(false);
  });

  test("l'écran ne promet aucune synchronisation non observée", () => {
    expect(SOURCE).not.toMatch(/synchronis/i);
  });
});

describe("le mode avancé reste un repli borné", () => {
  test("seuls Pennylane et Zapier sont proposés dans les options avancées", async () => {
    showPage();
    await screen.findByText("Que voulez-vous automatiser ?");

    expect(screen.getByRole("button", { name: "Utiliser un jeton Pennylane" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Configurer Zapier" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /mode avancé.*Stripe/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mode avancé.*Google/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mode avancé.*Slack/i })).toBeNull();
  });

  test("le jeton Pennylane avancé part vers la route chiffrée dédiée", async () => {
    showPage();
    await userEvent.click(await screen.findByRole("button", { name: "Utiliser un jeton Pennylane" }));
    await userEvent.type(screen.getByLabelText("Jeton d'accès Pennylane"), "pyl_jeton_de_test_123");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer cette connexion" }));

    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/connecteurs/PENNYLANE/avance",
        method: "POST",
        body: { apiToken: "pyl_jeton_de_test_123" },
      });
    });
  });
});

describe("les recettes décrivent l'état réel", () => {
  test("un outil autorisé est Prêt, jamais annoncé Actif sans moteur d'automatisation", async () => {
    connectors = connectors.map((item) => item.type === "PENNYLANE" ? connector("PENNYLANE", "CONNECTE") : item);
    showPage();

    const ready = await screen.findByTestId("recette-PENNYLANE");
    expect(within(ready).getByText("Prête")).toBeTruthy();
    expect(within(ready).queryByText("Active")).toBeNull();
    expect(within(ready).getByText("Autorisation seulement — aucun échange automatique actif")).toBeTruthy();

    const waiting = screen.getByTestId("recette-STRIPE");
    expect(within(waiting).getByText("À connecter")).toBeTruthy();
    expect(within(waiting).queryByText("Active")).toBeNull();
  });

  test.each([
    "Pennylane reçoit",
    "Stripe rapproche",
    "Google Drive garde",
    "Slack informe",
  ])("le bénéfice futur n'est pas présenté comme déjà actif : %s", (falsePromise) => {
    expect(SOURCE).not.toContain(falsePromise);
  });

  test("une révocation distante incomplète indique l'action restant chez le fournisseur", async () => {
    disconnectExternalActionRequired = true;
    connectors = connectors.map((item) => item.type === "PENNYLANE" ? connector("PENNYLANE", "CONNECTE") : item);
    showPage();

    const card = await screen.findByTestId("recette-PENNYLANE");
    await userEvent.click(within(card).getByRole("button", { name: "Déconnecter" }));

    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/connecteurs/PENNYLANE",
        method: "PATCH",
        body: { status: "NON_CONNECTE", config: {}, connectionId: CONNECTION_ID },
      });
      expect(toastMock).toHaveBeenCalledWith({
        title: "Outil déconnecté",
        description: "La connexion a été remise à zéro dans nodaq. Pour couper aussi l'accès chez le fournisseur, ouvrez ses réglages de connexions.",
      });
    });
  });

  test("une autorisation en erreur se réinitialise avant toute nouvelle connexion", async () => {
    connectors = connectors.map((item) => item.type === "PENNYLANE"
      ? { ...connector("PENNYLANE", "ERREUR"), config: { authMode: "OAUTH" } }
      : item);
    showPage();

    const card = await screen.findByTestId("recette-PENNYLANE");
    expect(within(card).getByText(
      "La connexion doit être reprise. Réinitialisez-la avant de recommencer et vérifiez les autorisations chez le fournisseur.",
    )).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Se connecter à Pennylane" })).toBeNull();
    await userEvent.click(within(card).getByRole("button", { name: "Réinitialiser Pennylane" }));

    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/connecteurs/PENNYLANE",
        method: "PATCH",
        body: { status: "NON_CONNECTE", config: {} },
      });
      expect(toastMock).toHaveBeenCalledWith({
        title: "Connexion réinitialisée",
        description: "La connexion a été remise à zéro dans nodaq. Vérifiez aussi les autorisations dans les réglages du fournisseur.",
      });
    });
  });

  test("une vérification en échange peut être annulée sans ouvrir une seconde connexion", async () => {
    connectors = connectors.map((item) => item.type === "STRIPE"
      ? {
          ...connector("STRIPE"),
          config: { connectionInProgress: true, connectionAttemptCancelable: true },
        }
      : item);
    showPage();

    const card = await screen.findByTestId("recette-STRIPE");
    expect(within(card).getByText(
      "Connexion en cours de vérification. Attendez son résultat avant de recommencer.",
    )).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Se connecter à Stripe" })).toBeNull();

    const cancel = within(card).getByRole("button", { name: "Annuler la vérification" });
    expect(cancel).toBeEnabled();
    await userEvent.click(cancel);

    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/connecteurs/STRIPE",
        method: "PATCH",
        body: { status: "NON_CONNECTE", config: {} },
      });
    });
  });

  test("une finalisation déjà lancée reste visible mais ne peut plus être annulée", async () => {
    connectors = connectors.map((item) => item.type === "STRIPE"
      ? {
          ...connector("STRIPE"),
          config: { connectionInProgress: true, connectionAttemptCancelable: false },
        }
      : item);
    showPage();

    const card = await screen.findByTestId("recette-STRIPE");
    expect(within(card).getByText(
      "Connexion en cours de vérification. Attendez son résultat avant de recommencer.",
    )).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Finalisation en cours…" })).toBeDisabled();
    expect(within(card).queryByRole("button", { name: "Se connecter à Stripe" })).toBeNull();
    expect(calls.some((call) => call.url === "/api/connecteurs/STRIPE" && call.method === "PATCH")).toBe(false);
  });

  test("une révocation incertaine reste visible après rechargement jusqu'à confirmation", async () => {
    connectors = connectors.map((item) => item.type === "GOOGLE_DRIVE"
      ? { ...connector("GOOGLE_DRIVE"), config: {
          externalActionRequired: true,
          externalRevocationId: EXTERNAL_REVOCATION_ID,
        } }
      : item);
    showPage();

    const card = await screen.findByTestId("recette-GOOGLE_DRIVE");
    expect(within(card).getByText(
      "Une autorisation peut encore être active chez le fournisseur. Retirez-la dans ses réglages, puis confirmez ici.",
    )).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Se connecter à Google Drive" })).toBeNull();
    await userEvent.click(within(card).getByRole("button", { name: "Confirmer le retrait de Google Drive" }));

    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/connecteurs/GOOGLE_DRIVE",
        method: "PATCH",
        body: {
          status: "NON_CONNECTE",
          config: {},
          externalRevocationConfirmed: true,
          externalRevocationId: EXTERNAL_REVOCATION_ID,
        },
      });
      expect(toastMock).toHaveBeenCalledWith({
        title: "Retrait confirmé",
        description: "Vous pouvez maintenant reconnecter cet outil à nodaq.",
      });
    });
  });

  test("une confirmation reçue pendant la finalisation explique pourquoi il faut encore attendre", async () => {
    disconnectResponseConfig = { connectionInProgress: true };
    connectors = connectors.map((item) => item.type === "GOOGLE_DRIVE"
      ? { ...connector("GOOGLE_DRIVE"), config: {
          externalActionRequired: true,
          externalRevocationId: EXTERNAL_REVOCATION_ID,
        } }
      : item);
    showPage();

    const card = await screen.findByTestId("recette-GOOGLE_DRIVE");
    await userEvent.click(within(card).getByRole("button", { name: "Confirmer le retrait de Google Drive" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Retrait enregistré",
        description: "Nodaq attend la fin de la vérification déjà lancée avant toute nouvelle connexion.",
      });
    });
  });
});

describe("inviter son comptable sans quitter le parcours", () => {
  test("la vraie invitation ACCOUNTANT conserve le lien si l'e-mail n'est pas parti", async () => {
    invitationResponse = {
      envoye: false,
      motifEchec: "Serveur d'envoi indisponible",
      lienInvitation: "https://nodaq.test/membres/accepter/secours",
      supplementInvitation: { prixMensuelCents: 1500 },
    };
    showPage();

    await userEvent.click(await screen.findByRole("button", { name: "Inviter mon comptable" }));
    await userEvent.type(screen.getByLabelText("Adresse e-mail du comptable"), "cabinet@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/membres/inviter",
        method: "POST",
        body: { email: "cabinet@example.test", role: "ACCOUNTANT" },
      });
    });
    expect(await screen.findByText("L'e-mail n'est pas parti — transmettez ce lien vous-même")).toBeTruthy();
    expect(screen.getByDisplayValue("https://nodaq.test/membres/accepter/secours")).toBeTruthy();
    const fallback = screen.getByTestId("invitation-fallback");
    expect(within(fallback).getByText("15 € HT/mois si l'invitation est acceptée")).toBeTruthy();
  });

  test("un e-mail envoyé garde le supplément visible sans prétendre qu'il est accepté", async () => {
    invitationResponse = {
      envoye: true,
      motifEchec: null,
      lienInvitation: "https://nodaq.test/membres/accepter/envoye",
      supplementInvitation: { prixMensuelCents: 1500 },
    };
    showPage();

    await userEvent.click(await screen.findByRole("button", { name: "Inviter mon comptable" }));
    await userEvent.type(screen.getByLabelText("Adresse e-mail du comptable"), "cabinet@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    expect(await screen.findByText("Invitation envoyée à cabinet@example.test")).toBeTruthy();
    expect(screen.getByText("15 € HT/mois si l'invitation est acceptée")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Inviter mon comptable" })).toBeTruthy();
    expect(screen.queryByText(/supplément accepté/i)).toBeNull();
  });
});

describe("la banque reste sur son parcours séparé", () => {
  test("le funnel bancaire existant appelle toujours sa route dédiée", () => {
    expect(SOURCE).toContain("/connecteurs/banque/session");
  });

  test.each([
    ["CONNECTE", "Gérer la connexion bancaire"],
    ["ERREUR", "Reprendre la connexion bancaire"],
  ] as const)("en état %s, elle passe par sa gestion dédiée et jamais par PATCH", async (status, action) => {
    connectors = connectors.map((item) => item.type === "BANQUE" ? connector("BANQUE", status) : item);
    showPage();

    const bank = await screen.findByTestId("connexion-BANQUE");
    expect(within(bank).queryByRole("button", { name: "Déconnecter" })).toBeNull();
    await userEvent.click(within(bank).getByRole("button", { name: action }));

    await waitFor(() => {
      expect(calls).toContainEqual({
        url: "/api/connecteurs/banque/session",
        method: "POST",
        body: null,
      });
    });
    expect(calls.some((call) => call.url === "/api/connecteurs/BANQUE" && call.method === "PATCH")).toBe(false);
  });
});
