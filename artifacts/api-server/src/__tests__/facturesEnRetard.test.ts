/**
 * `estFactureEnRetard` (US-A3.1) — définition canonique, testée en pur pour
 * ne pas dépendre de la base. Le pendant SQL (`conditionFactureEnRetardSql`)
 * est exercé indirectement via `facturation.test.ts` (describe "l") et
 * `factures.ts` (`totalOverdueCents`) — mêmes scénarios dueDate
 * future/passée, sur les deux chemins, pour donner confiance qu'ils
 * s'accordent sans dupliquer un test d'intégration ici.
 */
import { describe, test, expect } from "vitest";
import {
  estFactureEnRetard,
  residuelFactureCents,
  conditionFactureEnRetardSql,
  STATUTS_JAMAIS_EN_RETARD,
} from "../lib/facturesEnRetard";

describe("estFactureEnRetard", () => {
  test("dueDate strictement avant aujourd'hui, statut EMISE → en retard", () => {
    expect(estFactureEnRetard({ statut: "EMISE", dueDate: "2026-01-01" }, "2026-01-02")).toBe(true);
  });

  test("dueDate === aujourd'hui → pas encore en retard (US-A3.4)", () => {
    expect(estFactureEnRetard({ statut: "EMISE", dueDate: "2026-01-02" }, "2026-01-02")).toBe(false);
  });

  test("dueDate future → pas en retard", () => {
    expect(estFactureEnRetard({ statut: "EMISE", dueDate: "2026-02-01" }, "2026-01-02")).toBe(false);
  });

  test("statut PAYEE, dueDate ancienne → jamais en retard", () => {
    expect(estFactureEnRetard({ statut: "PAYEE", dueDate: "2020-01-01" }, "2026-01-02")).toBe(false);
  });

  test("statut ANNULEE_PAR_AVOIR, dueDate ancienne → jamais en retard", () => {
    expect(estFactureEnRetard({ statut: "ANNULEE_PAR_AVOIR", dueDate: "2020-01-01" }, "2026-01-02")).toBe(false);
  });

  /*
   * Retourné le 29/08/2026. La version précédente affirmait l'inverse, mais
   * décrivait un MÉCANISME — « le brouillon n'est pas exclu de la liste » —
   * sans jamais défendre d'intention. C'était un test de caractérisation.
   *
   * L'intention, elle, ne fait pas de doute : personne ne doit cet argent. Un
   * brouillon n'a été envoyé à aucun client, et `due_date` est renseignée dès
   * la création — bien avant que le document existe pour lui.
   *
   * Ce qu'un brouillon oublié mérite — « vous avez une facture à émettre » —
   * est un signal distinct, à construire à sa place. Le compter parmi les
   * impayés faisait pire que rien : le Cockpit, le Brief et la liste de
   * relance de l'agent le prenaient tous pour une créance.
   */
  test("statut BROUILLON, dueDate ancienne → JAMAIS en retard : personne ne doit cet argent", () => {
    expect(estFactureEnRetard({ statut: "BROUILLON", dueDate: "2020-01-01" }, "2026-01-02")).toBe(false);
  });
});

describe("residuelFactureCents", () => {
  test("résiduel présent → priorité au résiduel, pas au montant total", () => {
    expect(residuelFactureCents({ residualCents: 3_000, amountCents: 10_000 })).toBe(3_000);
  });

  test("résiduel absent (null) → replie sur le montant total", () => {
    expect(residuelFactureCents({ residualCents: null, amountCents: 10_000 })).toBe(10_000);
  });

  test("résiduel à zéro → 0, pas un repli sur le montant total (facture soldée)", () => {
    expect(residuelFactureCents({ residualCents: 0, amountCents: 10_000 })).toBe(0);
  });
});

/**
 * ── UN BROUILLON N'EST DÛ PAR PERSONNE ──────────────────────────────────────
 *
 * Constaté le 29/08/2026 sur une base peuplée par les routes réelles : un
 * brouillon de 12 000 €, jamais émis, jamais envoyé à qui que ce soit, faisait
 * monter de 12 000 € le total « en retard » de l'écran Factures.
 *
 * `factures.ts` renseigne `due_date` dès la CRÉATION, alors que le statut vaut
 * encore `BROUILLON` — la date d'échéance existe donc bien avant que le
 * document n'existe pour le client.
 *
 * La portée n'est pas cosmétique. Cette définition alimente le Cockpit, le
 * Brief matin, l'écran Factures ET la liste d'impayés que l'agent propose de
 * relancer : une relance pouvait partir chez un client pour une facture qu'il
 * n'avait jamais reçue.
 *
 * `chiffreAffaires.ts` avait déjà tiré la même conclusion pour le CA, avec la
 * même cause écrite noir sur blanc. Les deux listes se rejoignent ici.
 */
describe("un brouillon n'est jamais en retard", () => {
  test("le même document devient en retard UNE FOIS ÉMIS", () => {
    // La bascule tient au statut seul : mêmes dates, réponse opposée.
    expect(estFactureEnRetard({ statut: "BROUILLON", dueDate: "2026-01-01" }, "2026-01-02")).toBe(false);
    expect(estFactureEnRetard({ statut: "EMISE", dueDate: "2026-01-01" }, "2026-01-02")).toBe(true);
  });
});

/**
 * La version SQL et la version JS ne peuvent plus diverger : elles dérivent de
 * la MÊME constante. Ce test lit la condition produite et vérifie que chaque
 * statut exclu y figure — un ajout futur à la liste qui oublierait le SQL
 * ferait rougir ici.
 */
describe("les deux versions dérivent de la même liste", () => {
  test("chaque statut jamais en retard apparaît dans la condition SQL", () => {
    const condition = JSON.stringify(conditionFactureEnRetardSql("2026-01-02"));
    for (const statut of STATUTS_JAMAIS_EN_RETARD) {
      expect(condition, `${statut} absent de la condition SQL`).toContain(statut);
    }
  });
});
