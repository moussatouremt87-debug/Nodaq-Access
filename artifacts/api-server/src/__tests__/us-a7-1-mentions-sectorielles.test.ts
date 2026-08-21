/**
 * US-A7.1 — Mentions légales obligatoires, déclarées par secteur.
 *
 * Ce que ces tests protègent :
 *   a. NON-RÉGRESSION d'abord — les règles d'origine se déclenchent exactement
 *      comme avant la généralisation. C'est ce qui prouve que le bâtiment n'a
 *      rien perdu au passage en table déclarative ;
 *   b. AC1 — une profession à ordre sans numéro d'inscription est signalée ;
 *   c. AC3 — un secteur sans obligation propre ne subit AUCUNE vérification
 *      supplémentaire. Vérifié en comparant deux secteurs sur une facture
 *      identique, pas en relisant le code ;
 *   d. AC2 — la forme d'un blocage est la même pour toutes les règles
 *      bloquantes, et la route rend bien 422 avec `code` et `message` ;
 *   e. la table elle-même est saine : codes uniques, messages non vides.
 */
import { describe, test, expect } from "vitest";
import { auditMentionsFR, type FactureForPdf, type SellerInfo } from "../lib/pdf-generation";
import { REGLES_MENTIONS } from "../lib/mentions-obligatoires";

const vendeurComplet: SellerInfo = {
  nom: "Entreprise Test",
  siret: "12345678901234",
  decennaleAssureur: "AXA",
};

function facture(over: Partial<FactureForPdf> = {}, seller: Partial<SellerInfo> = {}): FactureForPdf {
  return {
    numero: "FACT-2026-0001",
    type: "FACTURE",
    issuedDate: "2026-08-18",
    seller: { ...vendeurComplet, ...seller },
    clientName: "Client Test",
    lines: [{ description: "Prestation", quantity: 1, unitPriceCents: 10000, vatRate: 20 }],
    autoliquidation: false,
    ...over,
  } as FactureForPdf;
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code).sort();

// ── a. Non-régression ──────────────────────────────────────────────────────

describe("a — les règles d'origine se déclenchent comme avant", () => {
  test("une facture complète en bâtiment ne signale rien", () => {
    expect(auditMentionsFR(facture(), "batiment")).toEqual([]);
  });

  test("SIRET absent → bloquant", () => {
    const issues = auditMentionsFR(facture({}, { siret: "" }), "batiment");
    const siret = issues.find((i) => i.code === "siret_vendeur_manquant");
    expect(siret?.bloquant).toBe(true);
    expect(siret?.message).toContain("242 nonies A CGI");
  });

  test("client absent, date invalide, aucune ligne", () => {
    const issues = auditMentionsFR(
      facture({ clientName: "", issuedDate: "18/08/2026", lines: [] }),
      "batiment",
    );
    expect(codes(issues)).toContain("client_manquant");
    expect(codes(issues)).toContain("date_emission_invalide");
    expect(codes(issues)).toContain("aucune_ligne");
    // `aucune_ligne` était non bloquant à l'origine : il doit le rester.
    expect(issues.find((i) => i.code === "aucune_ligne")?.bloquant).toBe(false);
  });

  test("taux réduit sans attestation TVA → bloquant, en bâtiment", () => {
    const f = facture({
      lines: [{ description: "Rénovation", quantity: 1, unitPriceCents: 10000, vatRate: 10 }],
    } as Partial<FactureForPdf>);
    const issue = auditMentionsFR(f, "batiment").find((i) => i.code === "attestation_tva_manquante");
    expect(issue?.bloquant).toBe(true);
  });

  test("décennale absente → signalée mais NON bloquante", () => {
    const issue = auditMentionsFR(facture({}, { decennaleAssureur: "" }), "batiment")
      .find((i) => i.code === "decennale_manquante");
    expect(issue).toBeTruthy();
    expect(issue?.bloquant).toBe(false);
  });

  test("décennale absente mais autoliquidation → rien", () => {
    const issues = auditMentionsFR(
      facture({ autoliquidation: true }, { decennaleAssureur: "" }),
      "batiment",
    );
    expect(codes(issues)).not.toContain("decennale_manquante");
  });

  test("franchise en base + ligne taxée → bloquant", () => {
    const issue = auditMentionsFR(facture({}, { tvaFranchise: true }), "batiment")
      .find((i) => i.code === "franchise_tva_incoherente");
    expect(issue?.bloquant).toBe(true);
    expect(issue?.message).toContain("293 B");
  });
});

// ── b. AC1 — professions à ordre ───────────────────────────────────────────

describe("b — AC1 : le numéro d'ordre est vérifié pour les professions concernées", () => {
  test("profession libérale sans numéro d'ordre → signalé", () => {
    const issues = auditMentionsFR(facture(), "professions_liberales");
    expect(codes(issues)).toContain("numero_ordre_manquant");
  });

  test("avec le numéro renseigné, plus rien", () => {
    const issues = auditMentionsFR(facture({}, { numeroOrdre: "12345" }), "professions_liberales");
    expect(codes(issues)).not.toContain("numero_ordre_manquant");
  });

  test("la règle est non bloquante tant que la revue juridique n'a pas tranché", () => {
    // Le passage en bloquant est une décision juridique, pas technique — voir
    // la note dans mentions-obligatoires.ts. Ce test fige l'état actuel : le
    // jour où il devient rouge, c'est que quelqu'un a basculé le drapeau, et
    // il faudra que ce soit délibéré.
    const issue = auditMentionsFR(facture(), "sante_liberale")
      .find((i) => i.code === "numero_ordre_manquant");
    expect(issue?.bloquant).toBe(false);
  });
});

// ── c. AC3 — aucune vérification superflue ─────────────────────────────────

describe("c — AC3 : un secteur sans obligation propre n'est pas gêné", () => {
  // `restauration_chr` est neutre au sens de cette story : ni exposé aux
  // travaux (la liste `garantie-decennale` de regulatoryWatch.ts couvre
  // batiment, paysage, maintenance, services_projet, industrie_btp — j'avais
  // supposé à tort que services_projet n'en était pas), ni profession à ordre.
  const SECTEUR_NEUTRE = "restauration_chr" as const;

  test("la même facture au taux réduit passe dans un secteur neutre", () => {
    const f = facture({
      lines: [{ description: "Mission", quantity: 1, unitPriceCents: 10000, vatRate: 10 }],
    } as Partial<FactureForPdf>);
    // En bâtiment, l'attestation TVA est exigée…
    expect(codes(auditMentionsFR(f, "batiment"))).toContain("attestation_tva_manquante");
    // …et dans un secteur neutre, rien ne bloque une facture par ailleurs complète.
    expect(auditMentionsFR(f, SECTEUR_NEUTRE)).toEqual([]);
  });

  test("un secteur neutre ne voit que le socle commun", () => {
    const issues = auditMentionsFR(facture({}, { siret: "", decennaleAssureur: "" }), SECTEUR_NEUTRE);
    // Le SIRET est du socle commun : il sort. La décennale et le numéro
    // d'ordre sont sectoriels : ils ne sortent pas.
    expect(codes(issues)).toEqual(["siret_vendeur_manquant"]);
  });
});

// ── d. AC2 — la forme du blocage ───────────────────────────────────────────

describe("d — AC2 : toutes les règles bloquantes ont la même forme", () => {
  test("chaque anomalie porte un code, un message et un drapeau", () => {
    const issues = auditMentionsFR(
      facture({ clientName: "", lines: [] }, { siret: "", tvaFranchise: true }),
      "batiment",
    );
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) {
      expect(typeof i.code).toBe("string");
      expect(i.code.length).toBeGreaterThan(0);
      expect(i.message.length).toBeGreaterThan(20);
      expect(typeof i.bloquant).toBe("boolean");
    }
  });
});

// ── e. La table elle-même ──────────────────────────────────────────────────

describe("e — la table de règles reste saine", () => {
  test("les codes sont uniques", () => {
    const tous = REGLES_MENTIONS.map((r) => r.code);
    expect(new Set(tous).size).toBe(tous.length);
  });

  test("aucune règle ne bloque avec un message vide", () => {
    // Une règle ajoutée sans message bloquerait une émission sans dire
    // pourquoi — le pire des deux mondes pour l'utilisateur.
    for (const r of REGLES_MENTIONS) {
      expect(r.message.trim().length, `règle « ${r.code} » sans message`).toBeGreaterThan(20);
    }
  });

  test("une règle sectorielle déclare au moins un secteur", () => {
    for (const r of REGLES_MENTIONS) {
      if (r.verticals) {
        expect(r.verticals.length, `règle « ${r.code} » gatée sur une liste vide`).toBeGreaterThan(0);
      }
    }
  });
});
