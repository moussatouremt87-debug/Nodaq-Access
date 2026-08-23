/*
 * Facturer le temps passé — US-A2.4 et US-B5.4.
 *
 * ── Le critère qui porte tout le risque ───────────────────────────────────
 * « Un taux modifié en cours d'année : une nouvelle facture applique le taux
 * en vigueur à la DATE DE LA PRESTATION, pas le taux courant. »
 *
 * C'est le seul critère de cette story dont l'erreur ne se voit pas : une
 * facture au mauvais taux a l'air parfaitement normale. Elle est simplement
 * fausse, et c'est le client qui la conteste — trois mois plus tard, sur un
 * montant qu'on ne sait plus reconstituer.
 */
import { describe, test, expect } from "vitest";
import {
  tauxApplicable, lignesDepuisHeures, tauxOccupation,
  type TauxDate, type HeurePointee,
} from "../src/facturationTemps.js";

const h = (p: Partial<HeurePointee> & { id: string; date: string; heures: number }): HeurePointee =>
  ({ facturable: true, ...p });

describe("le taux en vigueur à la date de la prestation", () => {
  const historique: TauxDate[] = [
    { dateEffet: "2026-01-01", montantCents: 8000 },
    { dateEffet: "2026-07-01", montantCents: 9500 },
  ];

  test("un travail de janvier se facture au taux de janvier, même facturé en août", () => {
    // Le cœur de la story. Toute lecture du « dernier taux connu » donnerait
    // 9500 ici, et la facture serait indéfendable devant le client.
    expect(tauxApplicable(historique, "2026-01-15")).toBe(8000);
    expect(tauxApplicable(historique, "2026-06-30")).toBe(8000);
  });

  test("le jour même de la prise d'effet, le nouveau taux s'applique", () => {
    // Une borne, donc un choix à écrire : « à partir du 1er juillet » inclut
    // le 1er juillet. L'inverse surprendrait celui qui a saisi la date.
    expect(tauxApplicable(historique, "2026-07-01")).toBe(9500);
  });

  test("avant le premier taux saisi, il n'y a AUCUN taux", () => {
    // Et non « le plus ancien connu ». Appliquer rétroactivement un tarif à
    // une période qu'il ne couvrait pas invente un prix.
    expect(tauxApplicable(historique, "2025-12-31")).toBeNull();
    expect(tauxApplicable([], "2026-01-15")).toBeNull();
  });

  test("l'ordre de saisie n'a aucune importance", () => {
    const desordre: TauxDate[] = [
      { dateEffet: "2026-07-01", montantCents: 9500 },
      { dateEffet: "2026-01-01", montantCents: 8000 },
    ];
    expect(tauxApplicable(desordre, "2026-03-01")).toBe(8000);
  });
});

describe("le taux d'un membre l'emporte sur celui de l'entreprise", () => {
  const historique: TauxDate[] = [
    { dateEffet: "2026-01-01", montantCents: 8000 },
    { dateEffet: "2026-01-01", montantCents: 14000, membreId: "associe" },
  ];

  test("un associé se facture à son tarif", () => {
    expect(tauxApplicable(historique, "2026-03-01", "associe")).toBe(14000);
    expect(tauxApplicable(historique, "2026-03-01", "junior")).toBe(8000);
  });

  test("un taux d'entreprise plus RÉCENT n'écrase pas celui du membre", () => {
    // Désigner quelqu'un est une intention plus forte qu'une mise à jour
    // globale. Sans cette règle, changer le tarif d'entreprise ferait tomber
    // l'associé au tarif commun sans que personne ne le voie.
    const avecMaj: TauxDate[] = [
      ...historique,
      { dateEffet: "2026-06-01", montantCents: 9000 },
    ];
    expect(tauxApplicable(avecMaj, "2026-09-01", "associe")).toBe(14000);
    expect(tauxApplicable(avecMaj, "2026-09-01", "junior")).toBe(9000);
  });
});

describe("les lignes de facture", () => {
  const taux: TauxDate[] = [{ dateEffet: "2026-01-01", montantCents: 8000 }];

  test("une ligne par journée, avec sa date et sa durée", () => {
    // C'est l'annexe demandée par le critère 2, obtenue par construction : le
    // PDF rend déjà date, quantité, prix unitaire et total par ligne. Pas de
    // second document à fabriquer, donc pas de second document qui diverge.
    const r = lignesDepuisHeures([
      h({ id: "1", date: "2026-03-02", heures: 7 }),
      h({ id: "2", date: "2026-03-03", heures: 3.5 }),
    ], taux);
    expect(r.lignes).toHaveLength(2);
    expect(r.lignes[0]!.libelle).toBe("Intervention du 02/03/2026 — 7 h");
    expect(r.lignes[1]!.libelle).toBe("Intervention du 03/03/2026 — 3,5 h");
    expect(r.totalCents).toBe(Math.round(7 * 8000) + Math.round(3.5 * 8000));
  });

  test("deux pointages du même jour au même taux tiennent sur UNE ligne", () => {
    const r = lignesDepuisHeures([
      h({ id: "1", date: "2026-03-02", heures: 4 }),
      h({ id: "2", date: "2026-03-02", heures: 3 }),
    ], taux);
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0]!.heures).toBe(7);
  });

  test("deux taux différents le même jour font DEUX lignes", () => {
    // Les mélanger rendrait le prix unitaire faux — et une facture dont le
    // prix unitaire ne se multiplie pas par la quantité est incontestable
    // dans le mauvais sens.
    const r = lignesDepuisHeures([
      h({ id: "1", date: "2026-03-02", heures: 4, membreId: "associe" }),
      h({ id: "2", date: "2026-03-02", heures: 3, membreId: "junior" }),
    ], [
      { dateEffet: "2026-01-01", montantCents: 8000 },
      { dateEffet: "2026-01-01", montantCents: 14000, membreId: "associe" },
    ]);
    expect(r.lignes).toHaveLength(2);
    // `.sort()` nu trie en lexicographique : « 14000 » passe avant « 8000 ».
    // Un comparateur numérique, donc — le piège est classique et silencieux.
    expect(r.lignes.map((l) => l.tauxCents).sort((a, b) => a - b)).toEqual([8000, 14000]);
  });

  test("les lignes sortent dans l'ordre des dates", () => {
    const r = lignesDepuisHeures([
      h({ id: "1", date: "2026-03-10", heures: 1 }),
      h({ id: "2", date: "2026-03-02", heures: 1 }),
    ], taux);
    expect(r.lignes.map((l) => l.date)).toEqual(["2026-03-02", "2026-03-10"]);
  });

  test("les quarts d'heure survivent à l'arrondi", () => {
    // 1,25 h à 80,00 € = 100,00 €. Arrondir les heures d'abord donnerait
    // 80,00 € et perdrait un quart d'heure par ligne.
    const r = lignesDepuisHeures([h({ id: "1", date: "2026-03-02", heures: 1.25 })], taux);
    expect(r.lignes[0]!.montantCents).toBe(10000);
  });
});

describe("ce qui est écarté est NOMMÉ", () => {
  test("le temps non facturable ne part pas en facture, et on dit pourquoi", () => {
    const r = lignesDepuisHeures([
      h({ id: "1", date: "2026-03-02", heures: 7 }),
      h({ id: "2", date: "2026-03-02", heures: 2, facturable: false }),
    ], [{ dateEffet: "2026-01-01", montantCents: 8000 }]);
    expect(r.totalHeures).toBe(7);
    expect(r.ecartes).toHaveLength(1);
    expect(r.ecartes[0]!.motif).toMatch(/non facturable/);
  });

  test("un pointage antérieur au premier taux n'est ni facturé à zéro ni ignoré", () => {
    // Facturer à zéro ferait disparaître du travail réel de la facture ;
    // l'ignorer en silence ferait la même chose sans le dire. Il ressort.
    const r = lignesDepuisHeures(
      [h({ id: "1", date: "2025-12-20", heures: 7 })],
      [{ dateEffet: "2026-01-01", montantCents: 8000 }],
    );
    expect(r.lignes).toHaveLength(0);
    expect(r.ecartes[0]!.motif).toMatch(/aucun taux/);
  });
});

describe("le taux d'occupation", () => {
  test("il porte sur le facturable, pas sur le temps total", () => {
    // US-B5.4 : « il se calcule sur la base de cette distinction plutôt que
    // sur le temps total enregistré ».
    expect(tauxOccupation([
      h({ id: "1", date: "2026-03-02", heures: 6 }),
      h({ id: "2", date: "2026-03-02", heures: 2, facturable: false }),
    ])).toBe(75);
  });

  test("sans aucune heure, il n'y a pas de taux — et surtout pas zéro", () => {
    // Afficher « 0 % » à quelqu'un qui n'a rien pointé lui reprocherait une
    // inactivité qu'il n'a pas.
    expect(tauxOccupation([])).toBeNull();
  });

  test("il est rendu en points entiers", () => {
    const r = tauxOccupation([
      h({ id: "1", date: "2026-03-02", heures: 2 }),
      h({ id: "2", date: "2026-03-02", heures: 1, facturable: false }),
    ]);
    expect(r).toBe(67);            // et non 66,666…
    expect(Number.isInteger(r)).toBe(true);
  });
});
