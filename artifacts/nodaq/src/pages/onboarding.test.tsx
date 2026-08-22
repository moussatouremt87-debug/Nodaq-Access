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

/** Tout ce qui part vers le serveur, dans l'ordre — ticket 4.36. */
const appels: Array<{ url: string; methode?: string; corps: unknown }> = [];

vi.mock("@/lib/auth", () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const corps = init?.body ? JSON.parse(init.body as string) : null;
    appels.push({ url, methode: init?.method, corps });
    if (url.endsWith("/votre-metier") && init?.method === "PATCH") {
      patchCalls.push({ url, body: corps });
      return new Response(JSON.stringify(corps), { status: 200, headers: { "Content-Type": "application/json" } });
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
  appels.length = 0;
});

/** Choisit une option puis avance. */
async function repondre(utilisateur: ReturnType<typeof userEvent.setup>, testid: string) {
  await utilisateur.click(await screen.findByTestId(testid));
  await utilisateur.click(screen.getByRole("button", { name: /continuer/i }));
}

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

/**
 * L'ORDRE du parcours — ticket 4.36.
 *
 * Ces tests existent parce que le premier branchement des écrans de
 * qualification les avait mis AVANT le secteur, et cassait la garde US-A1.1
 * ci-dessus. L'ordre retenu n'est donc pas un détail de mise en page : le
 * secteur d'abord, parce qu'il fixe le vocabulaire de tout ce qui suit ; la
 * qualification ensuite, parce que le stade décide si l'écran de recherche
 * SIREN a seulement lieu d'être.
 */
describe("la qualification s'intercale entre le secteur et la recherche", () => {
  test("après le secteur vient le stade — en passant l'écran", async () => {
    const utilisateur = userEvent.setup();
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);
    await utilisateur.click(screen.getByRole("button", { name: /plus tard/i }));

    expect(await screen.findByTestId("ecran-stade")).toBeTruthy();
  });

  test("après le secteur vient le stade — en le renseignant", async () => {
    // Les deux sorties de l'écran secteur sont distinctes (`onNext` et
    // `onSkip`) et peuvent diverger sans que rien ne casse : une injection qui
    // renvoyait `onNext` vers la recherche SIRET n'a pas fait broncher un test
    // qui n'empruntait que « Plus tard ».
    const utilisateur = userEvent.setup();
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);

    await utilisateur.click(screen.getByTestId("option-secteur-batiment"));
    await utilisateur.click(screen.getByRole("button", { name: /continuer/i }));

    expect(await screen.findByTestId("ecran-stade")).toBeTruthy();
  });

  test("une entreprise encore en projet ne se voit jamais demander son SIRET", async () => {
    // C'est l'effet CONCRET de la question du stade. Sans lui, ces écrans ne
    // seraient qu'un questionnaire marketing.
    const utilisateur = userEvent.setup();
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);
    await utilisateur.click(screen.getByRole("button", { name: /plus tard/i }));

    await repondre(utilisateur, "stade-EN_PROJET");
    await repondre(utilisateur, "effectif-SEUL");
    await repondre(utilisateur, "gestion-JAMAIS_FAIT");
    await repondre(utilisateur, "irritant-PAPERASSE");

    // L'écran de dépôt de documents, pas celui de la recherche d'entreprise.
    expect(await screen.findByRole('heading', { name: 'Ancienne facture' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Votre entreprise' })).toBeNull();
  });

  test("une entreprise existante passe bien par la recherche", async () => {
    // Le miroir du test précédent : sans lui, un « return null » permanent
    // ferait passer les deux.
    const utilisateur = userEvent.setup();
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);
    await utilisateur.click(screen.getByRole("button", { name: /plus tard/i }));

    await repondre(utilisateur, "stade-EXISTANTE");
    await repondre(utilisateur, "effectif-SEUL");
    await repondre(utilisateur, "gestion-JAMAIS_FAIT");
    await repondre(utilisateur, "irritant-PAPERASSE");

    expect(await screen.findByRole('heading', { name: 'Votre entreprise' })).toBeTruthy();
  });

  test("chaque réponse part seule, dans son propre envoi", async () => {
    const utilisateur = userEvent.setup();
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);
    await utilisateur.click(screen.getByRole("button", { name: /plus tard/i }));

    await repondre(utilisateur, "stade-EXISTANTE");
    await repondre(utilisateur, "effectif-DE_2_A_3");

    const qualif = appels.filter((a) => a.url.includes("/onboarding/qualification"));
    await waitFor(() => expect(qualif.length).toBeGreaterThanOrEqual(2));
    // Un abandon au troisième écran laisse les deux premières réponses en
    // base : c'est ce que garantit « un champ par envoi ».
    expect(qualif[0]!.corps).toEqual({ stade: "EXISTANTE" });
    expect(qualif[1]!.corps).toEqual({ effectif: "DE_2_A_3" });
  });
});

describe("le fil d'Ariane", () => {
  test("les quatre questions comptent pour UNE étape, et elle est surlignée", async () => {
    // Défaut réel du premier branchement : le dédoublonnage écartait les
    // libellés répétés au lieu de n'en garder qu'un. Les quatre écrans
    // disparaissaient du fil, et l'étape courante n'existait plus pendant
    // quatre écrans d'affilée — un parcours sans repère, sans rien de cassé.
    const utilisateur = userEvent.setup();
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);
    await utilisateur.click(screen.getByRole("button", { name: /plus tard/i }));
    await screen.findByTestId("ecran-stade");

    const etapes = screen.getAllByText("Votre situation");
    expect(etapes).toHaveLength(1);
    expect(etapes[0]!.className).toContain("font-medium");
  });

  test("l'étape « Entreprise » disparaît pour une entreprise en projet", async () => {
    const utilisateur = userEvent.setup();
    monter();
    await screen.findByText(/quel est votre secteur d'activité/i);
    await utilisateur.click(screen.getByRole("button", { name: /plus tard/i }));

    await repondre(utilisateur, "stade-EN_PROJET");
    await screen.findByTestId("ecran-effectif");
    // Annoncer une étape qu'on ne fera jamais est un mensonge de plus.
    expect(screen.queryByText("Entreprise")).toBeNull();
  });
});
