import { describe, expect, it } from "vitest";
import { auditInvoice } from "../src/index.js";
import type { FacturXInvoice } from "../src/index.js";

/*
 * Régression — validation calendaire stricte des dates (portage nodaq-landing).
 *
 * `Date.parse("2026-02-31")` normalise vers 2026-03-03 au lieu de rejeter la
 * date. Sans vérification du round-trip UTC, une facture portant une date
 * inexistante passait `issuable: true` — un défaut de conformité légale.
 */

const BASE: FacturXInvoice = {
  number: "F-2026-0001",
  issueDate: "2026-01-31",
  currency: "EUR",
  operationCategory: "livraison_biens",
  seller: {
    name: "Société Test SARL",
    siret: "81234567600009",
    vatNumber: "FR12812345676",
    address: { street: "1 rue de la Paix", postalCode: "75001", city: "Paris" },
  },
  buyer: {
    name: "Client SA",
    siret: "52345678800018",
    address: { street: "2 avenue de la République", postalCode: "75011", city: "Paris" },
  },
  lines: [
    { description: "Prestation", quantity: 1, unitPriceCents: 10_000, vatRate: 20, vatCategory: "S" },
  ],
  totals: { netCents: 10_000, vatCents: 2_000, grossCents: 12_000, dueCents: 12_000 },
};

describe("auditInvoice — validation calendaire stricte des dates", () => {
  it("date d'émission impossible (30 fév) est bloquante", () => {
    const result = auditInvoice({ ...BASE, issueDate: "2026-02-30" });
    expect(result.issuable).toBe(false);
    expect(result.issues.some((i) => i.code === "date_emission_invalide")).toBe(true);
  });

  it("date d'émission impossible (31 fév) est bloquante", () => {
    const result = auditInvoice({ ...BASE, issueDate: "2026-02-31" });
    expect(result.issuable).toBe(false);
    expect(result.issues.some((i) => i.code === "date_emission_invalide")).toBe(true);
  });

  it("date d'émission impossible (31 nov) est bloquante", () => {
    const result = auditInvoice({ ...BASE, issueDate: "2026-11-31" });
    expect(result.issuable).toBe(false);
    expect(result.issues.some((i) => i.code === "date_emission_invalide")).toBe(true);
  });

  it("date valide en fin de mois (31 jan) passe", () => {
    const result = auditInvoice({ ...BASE, issueDate: "2026-01-31" });
    expect(result.issues.filter((i) => i.code === "date_emission_invalide")).toHaveLength(0);
  });

  it("29 fév en année non bissextile est bloquant", () => {
    const result = auditInvoice({ ...BASE, issueDate: "2026-02-29" });
    expect(result.issuable).toBe(false);
    expect(result.issues.some((i) => i.code === "date_emission_invalide")).toBe(true);
  });

  it("29 fév en année bissextile (2028) passe", () => {
    const result = auditInvoice({ ...BASE, issueDate: "2028-02-29" });
    expect(result.issues.filter((i) => i.code === "date_emission_invalide")).toHaveLength(0);
  });

  it("date impossible ne peut pas être sérialisée en XML valide", () => {
    // Une facture non issuable ne doit jamais atteindre buildCiiXml en production.
    // Ce test documente la garantie de la chaîne audit → émission.
    const result = auditInvoice({ ...BASE, issueDate: "2026-02-31" });
    expect(result.issuable).toBe(false);
    expect(result.issues.some((i) => i.severity === "bloquant")).toBe(true);
  });
});
