/**
 * Relancer un devis sans réponse — ticket 4.33.
 *
 * Un devis sans réponse n'est PAS un impayé : le client n'a rien promis. Les
 * quatre refus de `decider` existent pour que le produit ne confonde pas les
 * deux, et n'abîme pas une relation commerciale encore ouverte.
 */
import { describe, test, expect } from "vitest";
import {
  decider, redigerRelance, numeroPourWhatsApp, joursEntre,
  type DevisRelancable,
} from "../src/relanceCommerciale.js";

const BASE: DevisRelancable = {
  id: "d1",
  reference: "DEV-2026-0042",
  clientNom: "Delacroix",
  clientTelephone: "06 12 34 56 78",
  statut: "ENVOYE",
  dateEnvoi: "2026-08-01",
  validUntil: "2026-09-30",
  totalTTCCents: 1454030,
  derniereRelance: null,
};

describe("a — l'écart en jours ne dépend pas du fuseau", () => {
  test("un mois de 31 jours", () => {
    expect(joursEntre("2026-08-01", "2026-09-01")).toBe(31);
  });

  test("le passage à l'heure d'hiver ne décale rien", () => {
    // Construit en local, ce calcul rendrait 26,96 jours arrondis à 27.
    expect(joursEntre("2026-10-20", "2026-11-16")).toBe(27);
  });
});

describe("b — les quatre refus", () => {
  test("un BROUILLON n'a jamais atteint le client", () => {
    const d = decider({ ...BASE, statut: "BROUILLON", dateEnvoi: null }, 7, "2026-08-20");
    expect(d.relancer).toBe(false);
    expect(d.motif).toBe("pas_envoye");
  });

  test("trop tôt : relancer au bout de 3 jours perd l'affaire", () => {
    const d = decider(BASE, 7, "2026-08-04");
    expect(d.relancer).toBe(false);
    expect(d.motif).toBe("delai_non_atteint");
    expect(d.joursSansReponse).toBe(3);
  });

  test("un devis EXPIRÉ se refait, il ne se relance pas", () => {
    // Le prix a pu changer : réclamer une réponse sur un tarif qu'on ne tiendra
    // plus est un piège qu'on se tend à soi-même.
    const d = decider({ ...BASE, validUntil: "2026-08-10" }, 7, "2026-08-20");
    expect(d.relancer).toBe(false);
    expect(d.motif).toBe("expire");
  });

  test("déjà relancé récemment → on n'insiste pas", () => {
    const d = decider({ ...BASE, derniereRelance: "2026-08-18" }, 7, "2026-08-20");
    expect(d.relancer).toBe(false);
    expect(d.motif).toBe("deja_relance");
  });

  test("une relance ANCIENNE n'empêche pas la suivante", () => {
    const d = decider({ ...BASE, derniereRelance: "2026-08-05" }, 7, "2026-08-20");
    expect(d.relancer).toBe(true);
  });
});

describe("c — le cas nominal", () => {
  test("envoyé il y a 19 jours, encore valide → on relance", () => {
    const d = decider(BASE, 7, "2026-08-20");
    expect(d.relancer).toBe(true);
    expect(d.motif).toBeNull();
    expect(d.joursSansReponse).toBe(19);
  });

  test("le jour PILE du délai suffit", () => {
    expect(decider(BASE, 7, "2026-08-08").relancer).toBe(true);
  });
});

describe("d — le numéro WhatsApp", () => {
  test.each([
    ["06 12 34 56 78", "33612345678"],
    ["0612345678", "33612345678"],
    ["+33 6 12 34 56 78", "33612345678"],
    ["+1 415 555 0123", "14155550123"],
  ])("« %s » → %s", (brut, attendu) => {
    expect(numeroPourWhatsApp(brut)).toBe(attendu);
  });

  test.each([
    ["absent", null],
    ["trop court", "0612"],
    ["étranger sans indicatif", "415 555 0123"],
  ])("%s → aucun lien", (_cas, brut) => {
    // Mieux vaut pas de lien qu'un lien qui ouvre une conversation avec un
    // inconnu : deviner un indicatif serait l'inventer.
    expect(numeroPourWhatsApp(brut)).toBeNull();
  });
});

describe("e — le message", () => {
  const m = redigerRelance(BASE, 19, "Couverture Lemarchand");

  test("le montant vient du devis, au centime", () => {
    expect(m.corps).toContain("14540.30 € TTC");
  });

  test("le nombre de jours est celui calculé, pas une approximation", () => {
    expect(m.corps).toContain("il y a 19 jours");
  });

  test("le ton est une question, pas une réclamation", () => {
    // Un devis sans réponse n'est pas un impayé.
    expect(m.corps).toMatch(/Avez-vous eu le temps/);
    expect(m.corps).not.toMatch(/retard|impayé|mise en demeure|pénalit/i);
  });

  test("le lien WhatsApp est prérempli et encodé", () => {
    expect(m.lienWhatsApp).toContain("https://wa.me/33612345678?text=");
    expect(m.lienWhatsApp).toContain(encodeURIComponent("DEV-2026-0042"));
  });

  test("sans numéro exploitable, pas de lien — et pas d'erreur", () => {
    const sans = redigerRelance({ ...BASE, clientTelephone: null }, 19, "X");
    expect(sans.lienWhatsApp).toBeNull();
    expect(sans.objet).toContain("DEV-2026-0042");
  });
});
