/**
 * Écran d'envoi — il ne se contredit plus, et ne demande rien d'irréalisable.
 *
 * Deux défauts relevés à l'usage :
 *   — l'écran affichait simultanément « l'authentification de domaine ne peut
 *     pas être proposée » et le formulaire qui la propose, avec « Enregistrer »
 *     actif et « Vérifier le DNS » désactivé ;
 *   — il demandait « Sélecteur DKIM » et « Valeur DKIM (v=DKIM1; k=rsa; p=…) »
 *     à un couvreur de cinq salariés, qui n'a pas de console de service d'envoi.
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ParametresEnvoi from "./parametres-envoi";

let serviceConfigure = false;

vi.mock("@/lib/auth", () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url.endsWith("/parametres-envoi")) {
      return new Response(
        JSON.stringify({
          parametres: null,
          spfIncludeConfigure: serviceConfigure,
          avertissementDelivrabilite: true,
          messageAvertissement:
            "Vos documents partent depuis nodaq.fr, pas depuis votre domaine. Beaucoup de messageries les classeront en indésirables.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function monter() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ParametresEnvoi />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  serviceConfigure = false;
});

describe("service d'envoi NON configuré", () => {
  test("le formulaire de domaine n'est pas proposé", async () => {
    monter();
    await screen.findByText(/n'est pas encore disponible/i);

    // L'écran ne doit pas afficher un formulaire qu'il vient de déclarer
    // impossible : plus aucun champ de domaine actif.
    expect(screen.queryByPlaceholderText("toituremartin.fr")).toBeNull();
  });

  test("le repli est un vrai bouton, pas du texte", async () => {
    monter();
    const bouton = await screen.findByRole("button", { name: /Continuer avec l'envoi depuis nodaq\.fr/i });
    expect(bouton).toBeTruthy();
  });

  test("l'avertissement de délivrabilité reste affiché", async () => {
    monter();
    expect(await screen.findByText(/indésirables/i)).toBeTruthy();
  });
});

describe("aucune valeur DKIM n'est demandée à l'artisan", () => {
  test("ni sélecteur ni valeur DKIM, service configuré ou non", async () => {
    serviceConfigure = true;
    monter();
    await screen.findByPlaceholderText("toituremartin.fr");

    // Ces deux champs étaient irréalisables pour l'utilisateur visé.
    expect(screen.queryByPlaceholderText(/Sélecteur DKIM/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/Valeur DKIM/i)).toBeNull();
  });

  test("l'écran dit honnêtement comment la suite arrive", async () => {
    serviceConfigure = true;
    monter();
    expect(await screen.findByText(/par e-mail/i)).toBeTruthy();
  });
});
