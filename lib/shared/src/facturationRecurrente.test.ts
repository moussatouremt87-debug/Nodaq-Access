/*
 * Le calcul des échéances dues — US-A2.3, partie pure.
 *
 * `facturation-recurrente.test.ts` (api-server) éprouve la route et sa base.
 * Celui-ci éprouve les décisions : qui est dû, qui est écarté, et ce que
 * change une résiliation.
 */
import { describe, test, expect } from "vitest";
import { echeancesAFacturer, type ContratAFacturer } from "./facturationRecurrente.js";

const base: ContratAFacturer = {
  id: "c1",
  label: "Maintenance",
  cadence: "mensuel",
  startDate: "2026-01-15",
  endDate: null,
  status: "ACTIF",
  amountCents: 50_000,
  dejaFacturees: [],
};

const contrat = (p: Partial<ContratAFacturer> = {}): ContratAFacturer => ({ ...base, ...p });

describe("ce qui est dû", () => {
  test("un mensuel de janvier rattrape tout jusqu'à aujourd'hui", () => {
    const { dues } = echeancesAFacturer(contrat(), "2026-04-20");
    expect(dues.map((d) => d.echeanceLe)).toEqual([
      "2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15",
    ]);
  });

  test("le libellé nomme la PÉRIODE, pas la date d'émission", () => {
    // « Maintenance — février 2026 » se relit un an après. « Maintenance »
    // seul, sur quatre factures, ne se distingue pas.
    const { dues } = echeancesAFacturer(contrat(), "2026-02-20");
    expect(dues[1]!.libelle).toBe("Maintenance — février 2026");
  });

  test("le jour de l'échéance, elle est DUE — pas le lendemain", () => {
    // La ranger dans « à venir » la ferait disparaître le seul jour où elle
    // compte.
    const { dues } = echeancesAFacturer(contrat(), "2026-01-15");
    expect(dues).toHaveLength(1);
  });

  test("rien n'est dû avant la date de début", () => {
    const { dues, ecartes } = echeancesAFacturer(contrat(), "2026-01-14");
    expect(dues).toHaveLength(0);
    expect(ecartes).toHaveLength(0);
  });

  test("le jour d'ancrage survit à février", () => {
    // Un contrat au 31 doit revenir au 31 en mars. Un moteur qui itérerait
    // depuis l'occurrence précédente resterait bloqué au 28 pour toujours.
    const { dues } = echeancesAFacturer(
      contrat({ startDate: "2026-01-31" }), "2026-03-31",
    );
    expect(dues.map((d) => d.echeanceLe)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31",
    ]);
  });

  test("le terme borne la série", () => {
    const { dues } = echeancesAFacturer(
      contrat({ endDate: "2026-03-01" }), "2026-06-20",
    );
    expect(dues.map((d) => d.echeanceLe)).toEqual(["2026-01-15", "2026-02-15"]);
  });
});

describe("ce qui a déjà été facturé ne l'est pas deux fois", () => {
  test("le curseur repart de la DERNIÈRE échéance facturée", () => {
    const { dues } = echeancesAFacturer(
      contrat({ dejaFacturees: ["2026-01-15", "2026-02-15"] }), "2026-04-20",
    );
    expect(dues.map((d) => d.echeanceLe)).toEqual(["2026-03-15", "2026-04-15"]);
  });

  test("l'ordre d'arrivée des échéances déjà facturées n'a pas d'importance", () => {
    // Le tri est lexicographique — correct sur des dates ISO, contrairement à
    // ce qu'il ferait sur des nombres. La base ne promet aucun ordre.
    const { dues } = echeancesAFacturer(
      contrat({ dejaFacturees: ["2026-02-15", "2026-01-15"] }), "2026-03-20",
    );
    expect(dues.map((d) => d.echeanceLe)).toEqual(["2026-03-15"]);
  });

  test("tout à jour : aucune due, aucun écart", () => {
    const { dues, ecartes } = echeancesAFacturer(
      contrat({ dejaFacturees: ["2026-01-15"] }), "2026-01-20",
    );
    expect(dues).toHaveLength(0);
    expect(ecartes).toHaveLength(0);
  });
});

describe("la résiliation", () => {
  test.each(["TERMINE", "SUSPENDU"])("un contrat %s ne produit rien", (status) => {
    // Troisième critère : il n'y a rien à dé-planifier, puisque aucune
    // occurrence n'a jamais été inscrite quelque part.
    const r = echeancesAFacturer(contrat({ status }), "2026-06-20");
    expect(r.dues).toHaveLength(0);
    expect(r.ecartes).toHaveLength(0);   // ce n'est pas un défaut à signaler
  });
});

describe("ce qui est écarté est nommé", () => {
  test("un contrat sans montant", () => {
    const { ecartes } = echeancesAFacturer(contrat({ amountCents: null }), "2026-04-20");
    expect(ecartes[0]!.motif).toMatch(/montant/);
  });

  test("un montant à zéro compte comme absent", () => {
    // Émettre une facture à 0 € n'aide personne et consomme un numéro.
    const { dues, ecartes } = echeancesAFacturer(contrat({ amountCents: 0 }), "2026-04-20");
    expect(dues).toHaveLength(0);
    expect(ecartes).toHaveLength(1);
  });

  test("un contrat sans date de début", () => {
    const { ecartes } = echeancesAFacturer(contrat({ startDate: null }), "2026-04-20");
    expect(ecartes[0]!.motif).toMatch(/date de début/);
  });

  test("un rattrapage tronqué est ANNONCÉ, pas silencieux", () => {
    // Trois ans de mensuel : la borne de 24 est atteinte. Facturer 24 et se
    // taire laisserait croire que le contrat est à jour.
    const r = echeancesAFacturer(contrat({ startDate: "2023-01-15" }), "2026-04-20");
    expect(r.dues).toHaveLength(24);
    expect(r.ecartes).toHaveLength(1);
    expect(r.ecartes[0]!.motif).toBeTruthy();
  });
});
