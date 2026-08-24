/*
 * L'attestation fiscale SAP — US-B4.1, le calcul.
 *
 * Chaque montant ci-dessous est refaisable de tête : ce document sert à
 * réclamer un crédit d'impôt, et c'est le CLIENT que l'administration
 * redresserait si le chiffre était faux.
 */
import { describe, test, expect } from "vitest";
import {
  planAttestations, joursAvantEcheance, rappelAttestation,
  type ClientAttestable, type EncaissementClient, type PrestataireSap,
} from "./attestationSap.js";

const PRESTATAIRE: PrestataireSap = {
  nom: "Services Martin", adresse: "1 rue de la Paix, 75001 Paris",
  siret: "12345678901234", numeroDeclarationSap: "SAP123456789",
};
const CLIENTS: ClientAttestable[] = [
  { id: "c1", nom: "Madame Dupont", adresse: "3 rue Neuve, 75002 Paris" },
];
const enc = (p: Partial<EncaissementClient> = {}): EncaissementClient => ({
  clientId: "c1", date: "2026-03-15", montantCents: 30_000, ...p,
});

describe("l'attestation porte sur l'ENCAISSÉ, pas sur le facturé", () => {
  test("seuls les encaissements de l'année civile comptent", () => {
    // Une facture de décembre réglée en janvier appartient à l'année suivante.
    // Attester du facturé ferait réclamer un crédit d'impôt indu.
    const r = planAttestations(CLIENTS, [
      enc({ date: "2025-12-28", montantCents: 50_000 }),
      enc({ date: "2026-01-05", montantCents: 30_000 }),
      enc({ date: "2026-11-20", montantCents: 20_000 }),
      enc({ date: "2027-01-03", montantCents: 90_000 }),
    ], PRESTATAIRE, 2026);

    expect(r.attestations[0]!.montantEligibleCents).toBe(50_000);
    expect(r.attestations[0]!.nombreEncaissements).toBe(2);
  });

  test("la borne du 31 décembre est incluse, celle du 1er janvier suivant exclue", () => {
    const r = planAttestations(CLIENTS, [
      enc({ date: "2026-12-31", montantCents: 10_000 }),
      enc({ date: "2027-01-01", montantCents: 99_000 }),
    ], PRESTATAIRE, 2026);
    expect(r.attestations[0]!.montantEligibleCents).toBe(10_000);
  });
});

describe("les aides de tiers sont déduites", () => {
  test("APA, PCH, CESU préfinancé n'ouvrent aucun droit", () => {
    // Ces sommes ne sortent pas de la poche du client. Les inclure gonflerait
    // l'avantage fiscal déclaré.
    const r = planAttestations(CLIENTS, [
      enc({ montantCents: 80_000 }),
      enc({ montantCents: 30_000, estAideTiers: true }),
    ], PRESTATAIRE, 2026);

    const a = r.attestations[0]!;
    expect(a.totalEncaisseCents).toBe(110_000);
    expect(a.aidesCents).toBe(30_000);
    expect(a.montantEligibleCents).toBe(80_000);   // la base du crédit d'impôt
  });

  test("un client entièrement pris en charge est ÉCARTÉ, pas attesté à zéro", () => {
    // Il n'a rien déboursé, il n'a droit à rien. Une attestation à 0 € le
    // ferait douter de ce qu'il a payé.
    const r = planAttestations(CLIENTS, [
      enc({ montantCents: 60_000, estAideTiers: true }),
    ], PRESTATAIRE, 2026);
    expect(r.attestations).toHaveLength(0);
    expect(r.ecartes[0]!.motif).toMatch(/aides/);
  });
});

describe("un remboursement réduit l'assiette", () => {
  test("l'argent rendu au client ne lui est pas attesté", () => {
    // Le signe vient du SENS du paiement, jamais du montant : la colonne
    // porte un CHECK > 0. Attester un remboursement ferait réclamer un
    // crédit d'impôt sur une somme récupérée.
    const r = planAttestations(CLIENTS, [
      enc({ montantCents: 50_000 }),
      enc({ montantCents: -20_000 }),
    ], PRESTATAIRE, 2026);
    expect(r.attestations[0]!.montantEligibleCents).toBe(30_000);
  });

  test("un client intégralement remboursé est écarté", () => {
    const r = planAttestations(CLIENTS, [
      enc({ montantCents: 50_000 }),
      enc({ montantCents: -50_000 }),
    ], PRESTATAIRE, 2026);
    expect(r.attestations).toHaveLength(0);
  });
});

describe("ce qui EMPÊCHE d'émettre", () => {
  test("sans numéro de déclaration SAP, rien ne doit partir", () => {
    // C'est ce numéro qui prouve que l'activité ouvre droit au crédit. Une
    // attestation sans lui devra être renvoyée — pire que ne rien envoyer.
    const r = planAttestations(CLIENTS, [enc()],
      { ...PRESTATAIRE, numeroDeclarationSap: null }, 2026);
    expect(r.bloquants).toHaveLength(1);
    expect(r.bloquants[0]).toMatch(/déclaration SAP/);
    expect(r.bloquants[0]).toMatch(/Paramètres/);   // il dit QUOI FAIRE
  });

  test("sans SIRET non plus", () => {
    const r = planAttestations(CLIENTS, [enc()], { ...PRESTATAIRE, siret: null }, 2026);
    expect(r.bloquants.some((b) => b.includes("SIRET"))).toBe(true);
  });

  test("le calcul est fait MALGRÉ le bloquant — on montre ce qui partirait", () => {
    // Refuser de calculer priverait l'utilisateur de l'information qui le
    // motive à compléter son profil : « 14 clients vous attendent ».
    const r = planAttestations(CLIENTS, [enc()],
      { ...PRESTATAIRE, numeroDeclarationSap: null }, 2026);
    expect(r.attestations).toHaveLength(1);
  });
});

describe("un client sans encaissement n'est pas attesté", () => {
  test("il est écarté, avec son motif", () => {
    const r = planAttestations(CLIENTS, [], PRESTATAIRE, 2026);
    expect(r.attestations).toHaveLength(0);
    expect(r.ecartes[0]!.motif).toMatch(/aucun encaissement en 2026/);
  });

  test("la génération EN MASSE traite tous les clients d'un coup", () => {
    // Premier critère : « en une seule action pour tous les clients ».
    const clients = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, nom: `Client ${i}` }));
    const encaissements = clients.map((c) => enc({ clientId: c.id, montantCents: 10_000 }));
    const r = planAttestations(clients, encaissements, PRESTATAIRE, 2026);
    expect(r.attestations).toHaveLength(14);
  });
});

describe("l'échéance du 31 mars", () => {
  test("les jours restants sont comptés jusqu'au 31 mars de l'année suivante", () => {
    expect(joursAvantEcheance("2027-03-31", 2026)).toBe(0);
    expect(joursAvantEcheance("2027-03-01", 2026)).toBe(30);
    expect(joursAvantEcheance("2027-01-01", 2026)).toBe(89);
  });

  test("le dépassement est rendu NÉGATIF, pas masqué", () => {
    // Mieux vaut une attestation en retard qu'aucune : se taire après le
    // 31 mars serait le pire moment pour se taire.
    expect(joursAvantEcheance("2027-04-15", 2026)).toBe(-15);
  });
});

describe("le rappel proactif — 2e critère", () => {
  test("en février, il alerte pour l'année précédente", () => {
    const r = rappelAttestation("2027-02-10", [])!;
    expect(r.annee).toBe(2026);
    expect(r.alerter).toBe(true);
    expect(r.joursRestants).toBe(49);
  });

  test("il se TAIT si la génération a déjà été lancée", () => {
    expect(rappelAttestation("2027-02-10", [2026])).toBeNull();
  });

  test("il alerte encore APRÈS le 31 mars", () => {
    const r = rappelAttestation("2027-05-01", [])!;
    expect(r.alerter).toBe(true);
    expect(r.joursRestants).toBeLessThan(0);
  });

  test("il ne réclame pas une année non close", () => {
    // En octobre 2026, l'année 2026 n'est pas finie : rien à attester. Le
    // rappel porte sur 2025, et se tait s'il est déjà fait.
    expect(rappelAttestation("2026-10-01", [2025])).toBeNull();
    const r = rappelAttestation("2026-10-01", [])!;
    expect(r.annee).toBe(2025);
  });
});
