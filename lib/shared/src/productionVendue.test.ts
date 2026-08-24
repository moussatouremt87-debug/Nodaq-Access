/*
 * La ligne « Production vendue – services » — US-A1.2 critère 3, et les trois
 * défauts trouvés en y entrant.
 *
 * Ce code produit un document COMPTABLE et n'avait aucun test. Chacun des
 * chiffres ci-dessous est vérifiable à la main, délibérément : un test dont on
 * ne peut pas refaire le calcul de tête ne prouve pas grand-chose sur une
 * ligne qu'un expert-comptable va lire.
 */
import { describe, test, expect } from "vitest";
import {
  productionVendue, STATUTS_PRODUITS,
  type FacturePourResultat, type AvoirPourResultat, type RepriseCA,
} from "./productionVendue.js";

const DU = "2026-01-01";
const AU = "2026-12-31";

const f = (p: Partial<FacturePourResultat> = {}): FacturePourResultat => ({
  issuedDate: "2026-03-01", statut: "EMISE",
  totalHTCents: 100_000, amountCents: 120_000, ...p,
});

const SANS_REPRISE: RepriseCA = { caFactureEuros: null, dateDebutExercice: null };
const AUCUN_AVOIR: readonly AvoirPourResultat[] = [];

describe("un brouillon n'est pas un produit", () => {
  test("il ne compte pas dans le chiffre d'affaires", () => {
    // Une facture jamais émise n'a pas de numéro, n'est jamais partie, et
    // personne ne la doit. La compter gonfle le résultat — et un résultat
    // gonflé se paie en impôt sur les bénéfices.
    const r = productionVendue(
      [f({ statut: "BROUILLON" })], AUCUN_AVOIR, SANS_REPRISE, DU, AU,
    );
    expect(r.totalCents).toBe(0);
  });

  test("le rattrapage d'un abonnement ne fabrique aucun produit", () => {
    // US-A2.3 crée des brouillons en série. Sans ce filtre, rattraper quatre
    // mois d'abonnement afficherait quatre mois de produits fictifs.
    const brouillons = Array.from({ length: 4 }, () => f({ statut: "BROUILLON" }));
    expect(productionVendue(brouillons, AUCUN_AVOIR, SANS_REPRISE, DU, AU).totalCents).toBe(0);
  });

  test("une facture annulée par avoir ne compte pas non plus", () => {
    const r = productionVendue(
      [f({ statut: "ANNULEE_PAR_AVOIR" })], AUCUN_AVOIR, SANS_REPRISE, DU, AU,
    );
    expect(r.totalCents).toBe(0);
  });

  test.each(STATUTS_PRODUITS)("un statut %s compte", (statut) => {
    expect(productionVendue([f({ statut })], AUCUN_AVOIR, SANS_REPRISE, DU, AU).totalCents)
      .toBe(100_000);
  });
});

describe("un compte de résultat enregistre du HORS TAXES", () => {
  test("la TVA collectée n'est pas un produit", () => {
    // Elle est une dette envers l'État. Compter le TTC surévaluait la ligne
    // d'environ 20 % — assez pour fausser un résultat et un acompte d'IS.
    const r = productionVendue([f({ totalHTCents: 100_000, amountCents: 120_000 })],
      AUCUN_AVOIR, SANS_REPRISE, DU, AU);
    expect(r.totalCents).toBe(100_000);   // et non 120 000
  });

  test("une ligne antérieure à `total_ht_cents` retombe sur le TTC", () => {
    // `NOT NULL DEFAULT 0` : prendre ce 0 au mot effacerait leur chiffre
    // d'affaires. Le repli n'est pas exact, mais c'est le comportement
    // historique — aucune régression pour ces lignes-là.
    const r = productionVendue([f({ totalHTCents: 0, amountCents: 120_000 })],
      AUCUN_AVOIR, SANS_REPRISE, DU, AU);
    expect(r.totalCents).toBe(120_000);
  });
});

describe("les avoirs sont déduits", () => {
  test("un avoir réduit le chiffre d'affaires de la période", () => {
    const r = productionVendue(
      [f({ totalHTCents: 100_000 })],
      [{ issuedDate: "2026-04-01", montantHtCents: 30_000 }],
      SANS_REPRISE, DU, AU,
    );
    expect(r.totalCents).toBe(70_000);
  });

  test("un avoir hors période ne touche pas à celle-ci", () => {
    const r = productionVendue(
      [f({ totalHTCents: 100_000 })],
      [{ issuedDate: "2025-12-31", montantHtCents: 30_000 }],
      SANS_REPRISE, DU, AU,
    );
    expect(r.totalCents).toBe(100_000);
  });
});

describe("le chiffre d'affaires repris — US-A1.2 critère 3", () => {
  test("il apparaît dans l'exercice où la reprise a été déclarée", () => {
    // Sans lui, une entreprise qui migre en juin voit un compte de résultat
    // amputé de tout son premier semestre — et c'est précisément ce qui
    // décourage de migrer.
    const r = productionVendue(
      [f({ totalHTCents: 100_000 })], AUCUN_AVOIR,
      { caFactureEuros: 85_000, dateDebutExercice: "2026-01-01" }, DU, AU,
    );
    expect(r.reprisCents).toBe(8_500_000);
    expect(r.totalCents).toBe(8_600_000);
  });

  test("il n'apparaît PAS dans un autre exercice", () => {
    // L'ajouter à chaque période le compterait autant de fois qu'on change
    // de filtre, et personne ne verrait passer l'erreur.
    const r = productionVendue(
      [], AUCUN_AVOIR,
      { caFactureEuros: 85_000, dateDebutExercice: "2026-01-01" },
      "2027-01-01", "2027-12-31",
    );
    expect(r.reprisCents).toBe(0);
    expect(r.avertissement).toBeNull();
  });

  test("le montant repris est ANNONCÉ, pas fondu dans le total", () => {
    // Un comptable qui lit 86 000 € doit pouvoir savoir d'où vient l'écart
    // avec les factures du logiciel.
    const r = productionVendue(
      [], AUCUN_AVOIR,
      { caFactureEuros: 85_000, dateDebutExercice: "2026-06-15" }, DU, AU,
    );
    expect(r.avertissement).toMatch(/repris/);
    expect(r.avertissement).toContain("85");
  });

  test("les centimes d'euros survivent à la conversion", () => {
    const r = productionVendue(
      [], AUCUN_AVOIR,
      { caFactureEuros: 85_000.5, dateDebutExercice: "2026-01-01" }, DU, AU,
    );
    expect(r.reprisCents).toBe(8_500_050);
  });
});

describe("une reprise que l'on ne sait pas dater n'est pas jetée en silence", () => {
  test("sans date d'exercice, le montant est écarté MAIS annoncé", () => {
    // Le repli est l'état sûr — on ne place pas un montant dans un exercice
    // au hasard — mais un montant qui disparaît sans un mot laisse
    // l'utilisateur devant un total amputé sans savoir pourquoi.
    const r = productionVendue(
      [f({ totalHTCents: 100_000 })], AUCUN_AVOIR,
      { caFactureEuros: 85_000, dateDebutExercice: null }, DU, AU,
    );
    expect(r.reprisCents).toBe(0);
    expect(r.totalCents).toBe(100_000);
    expect(r.avertissement).toMatch(/date de début d'exercice/);
  });

  test("aucune reprise déclarée : rien à dire", () => {
    const r = productionVendue([f()], AUCUN_AVOIR, SANS_REPRISE, DU, AU);
    expect(r.avertissement).toBeNull();
  });

  test("une reprise à zéro ne déclenche aucun message", () => {
    // Zéro est une réponse légitime — un tout nouvel entrepreneur. Lui
    // réclamer une date d'exercice serait une corvée sans objet.
    const r = productionVendue(
      [], AUCUN_AVOIR, { caFactureEuros: 0, dateDebutExercice: null }, DU, AU,
    );
    expect(r.avertissement).toBeNull();
  });
});

describe("les bornes de période", () => {
  test("les deux bornes sont INCLUSES", () => {
    const r = productionVendue(
      [f({ issuedDate: DU, totalHTCents: 1000 }), f({ issuedDate: AU, totalHTCents: 1000 })],
      AUCUN_AVOIR, SANS_REPRISE, DU, AU,
    );
    expect(r.totalCents).toBe(2000);
  });

  test("la veille et le lendemain sont dehors", () => {
    const r = productionVendue(
      [f({ issuedDate: "2025-12-31" }), f({ issuedDate: "2027-01-01" })],
      AUCUN_AVOIR, SANS_REPRISE, DU, AU,
    );
    expect(r.totalCents).toBe(0);
  });
});
