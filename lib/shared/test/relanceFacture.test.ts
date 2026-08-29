/**
 * Le recouvrement d'une facture impayée — l'échelonnement.
 *
 * ── CE QUE CES TESTS FIGENT ───────────────────────────────────────────────
 * La règle décrite par le fondateur le 29/08/2026, mot pour mot :
 *
 *   J+0   échéance dépassée → e-mail ET WhatsApp
 *   J+15  sans réponse      → second e-mail ET second WhatsApp
 *   J+30  sans réponse      → appel téléphonique
 *
 * Ce sont des délais qui touchent la relation client. Les changer par
 * inadvertance enverrait un appel de recouvrement à quelqu'un qui a deux
 * jours de retard, ou laisserait un impayé dormir six semaines.
 */
import { describe, test, expect } from "vitest";
import {
  PALIERS_RECOUVREMENT,
  palierApplicable,
  redigerRecouvrement,
  joursDeRetard,
} from "../src/relanceFacture";

const FACTURE = {
  numero: "F-2026-0007",
  clientNom: "Mme Girard",
  montantTTCCents: 420000,          // 4 200,00 €
  dateEcheance: "2026-08-01",
};

describe("l'échelle, telle qu'elle a été décrite", () => {
  test("trois paliers : e-mail+WhatsApp, e-mail+WhatsApp, appel", () => {
    expect(PALIERS_RECOUVREMENT.map((p) => p.apresJoursDeRetard)).toEqual([0, 15, 30]);
    expect(PALIERS_RECOUVREMENT[0]!.canaux).toEqual(["email", "whatsapp"]);
    expect(PALIERS_RECOUVREMENT[1]!.canaux).toEqual(["email", "whatsapp"]);
    // L'appel vient EN DERNIER : c'est l'étape qui coûte le plus cher à la
    // relation, et l'usage veut qu'on écrive avant d'appeler.
    expect(PALIERS_RECOUVREMENT[2]!.canaux).toEqual(["appel"]);
  });
});

describe("quel palier s'applique", () => {
  test("une facture pas encore échue ne déclenche rien", () => {
    expect(palierApplicable(-1, 0)).toBeNull();
    expect(palierApplicable(-30, 0)).toBeNull();
  });

  test("dès le premier jour de retard : première relance", () => {
    expect(palierApplicable(0, 0)?.niveau).toBe(1);
    expect(palierApplicable(3, 0)?.niveau).toBe(1);
  });

  /*
   * LA garde contre le harcèlement. Une relance partie hier ne doit pas
   * repartir aujourd'hui parce que le compteur a avancé d'un jour : c'est le
   * nombre d'envois qui fait progresser le dossier, pas le seul calendrier.
   */
  test("relancé une fois, on ATTEND le palier suivant", () => {
    expect(palierApplicable(1, 1)).toBeNull();
    expect(palierApplicable(14, 1)).toBeNull();
    expect(palierApplicable(15, 1)?.niveau).toBe(2);
  });

  test("relancé deux fois, l'appel n'arrive qu'à J+30", () => {
    expect(palierApplicable(29, 2)).toBeNull();
    expect(palierApplicable(30, 2)?.niveau).toBe(3);
    expect(palierApplicable(30, 2)?.canaux).toEqual(["appel"]);
  });

  test("l'échelle s'arrête après l'appel — on ne relance pas indéfiniment", () => {
    expect(palierApplicable(60, 3)).toBeNull();
    expect(palierApplicable(365, 9)).toBeNull();
  });

  /*
   * LA garde qui protège la relation client. Une facture découverte à J+40
   * n'a jamais reçu de relance : lui envoyer d'emblée l'appel sauterait les
   * deux e-mails. On applique le PROCHAIN palier dû, pas le plus élevé
   * atteignable.
   */
  test("une facture découverte tardivement commence par le PREMIER palier", () => {
    const p = palierApplicable(40, 0);
    expect(p?.niveau).toBe(1);
    expect(p?.canaux).toEqual(["email", "whatsapp"]);
  });
});

describe("les jours de retard", () => {
  test("se comptent en jours calendaires", () => {
    expect(joursDeRetard("2026-08-01", "2026-08-01")).toBe(0);
    expect(joursDeRetard("2026-08-01", "2026-08-16")).toBe(15);
    expect(joursDeRetard("2026-08-01", "2026-07-31")).toBe(-1);
  });

  /*
   * Aucun fuseau n'intervient : une échéance au 29 août est dépassée le 30, à
   * Paris comme à Auckland. Le dépôt a déjà payé cette erreur — un calcul
   * passant par des `Date` locales devenait faux l'après-midi.
   */
  test("un changement de mois ou d'année ne décale rien", () => {
    expect(joursDeRetard("2026-08-31", "2026-09-01")).toBe(1);
    expect(joursDeRetard("2026-12-31", "2027-01-01")).toBe(1);
    expect(joursDeRetard("2026-02-28", "2026-03-01")).toBe(1);
  });
});

describe("le message", () => {
  const nom = "Toiture Martin";

  test("la première relance suppose un oubli", () => {
    const m = redigerRecouvrement(FACTURE, PALIERS_RECOUVREMENT[0]!, 0, nom);

    expect(m.objet).toContain("F-2026-0007");
    expect(m.corps).toMatch(/oubli/i);
    // Le ton reste ouvert : on ne traite pas un client de mauvais payeur au
    // premier jour de retard.
    expect(m.corps).not.toMatch(/mise en demeure|contentieux|pénalit/i);
  });

  test("la seconde durcit le ton, sans changer les faits", () => {
    const m = redigerRecouvrement(FACTURE, PALIERS_RECOUVREMENT[1]!, 15, nom);

    expect(m.corps).toMatch(/précédente relance/i);
    expect(m.corps).toContain("15 jours");
  });

  /*
   * LA garde qui protège la créance. Le montant et le numéro sont des FAITS :
   * ils viennent de la facture et ne bougent pas d'un palier à l'autre. Un
   * message qui changerait de chiffre entre deux relances détruirait la
   * crédibilité de la demande.
   */
  test("le montant et le numéro sont identiques à tous les paliers", () => {
    for (const p of PALIERS_RECOUVREMENT) {
      const m = redigerRecouvrement(FACTURE, p, 40, nom);
      expect(m.objet + m.corps + m.texteWhatsApp, `palier ${p.niveau}`).toContain("F-2026-0007");
      // 420 000 centimes = 4 200,00 €. Jamais 420 000 € : c'est le facteur 100
      // qui a fait annoncer un carnet de commandes cent fois trop élevé.
      expect(m.corps, `palier ${p.niveau}`).toContain("4200.00 €");
    }
  });

  test("le texte WhatsApp est court — un pavé ne s'y lit pas", () => {
    for (const p of PALIERS_RECOUVREMENT) {
      const m = redigerRecouvrement(FACTURE, p, 20, nom);
      expect(m.texteWhatsApp.length, `palier ${p.niveau}`).toBeLessThan(320);
      expect(m.texteWhatsApp).toContain(nom);
    }
  });

  test("le nom de l'entreprise signe chaque message", () => {
    const m = redigerRecouvrement(FACTURE, PALIERS_RECOUVREMENT[0]!, 0, nom);
    expect(m.corps.trimEnd().endsWith(nom)).toBe(true);
  });
});
