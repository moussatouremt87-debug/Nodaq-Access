/**
 * Intentions vocales — la garantie est STRUCTURELLE.
 *
 * Ce que ces tests protègent :
 *   — le modèle ne PEUT PAS écrire un identifiant ni un montant : le schéma
 *     les refuse, il ne les nettoie pas ;
 *   — une ambiguïté ne se tranche pas toute seule ;
 *   — une date non comprise rend `null`, jamais la date du jour.
 *
 * Ces tests tournent sous TZ=UTC, Europe/Paris et Pacific/Auckland.
 */
import { describe, test, expect } from "vitest";
import {
  Intention,
  SortieModele,
  resoudreMention,
  interpreterDate,
  TYPES_INTENTION,
  CHAMPS_A_COMPLETER,
  champsManquants,
  champCorrigeable,
  type TypeIntention,
} from "../src/intentionVocale.js";

// ── Le modèle ne peut pas écrire ────────────────────────────────────────────

describe("le schéma REFUSE, il ne nettoie pas", () => {
  test("une intention porteuse d'un `id` est rejetée", () => {
    // Nettoyer laisserait croire qu'on a compris ce qui a été proposé.
    const r = Intention.safeParse({
      type: "creer_affaire",
      label: "Carrelage Dupont",
      id: "aff-123",
    });
    expect(r.success).toBe(false);
  });

  test("une intention porteuse d'un prix est rejetée", () => {
    const r = Intention.safeParse({
      type: "creer_affaire",
      label: "Carrelage Dupont",
      montantCents: 250000,
    });
    expect(r.success).toBe(false);
  });

  test.each([
    ["affaireId", { type: "creer_affaire", label: "X", affaireId: "a1" }],
    ["prix", { type: "creer_prospect", nom: "Dupont", prix: 1000 }],
    ["montant", { type: "creer_echeance", libelle: "TVA", montant: 500 }],
    ["estimatedCents", { type: "creer_echeance", libelle: "TVA", estimatedCents: 500 }],
    ["clientId", { type: "creer_prospect", nom: "Dupont", clientId: "c1" }],
  ])("champ interdit « %s » → rejet", (_nom, charge) => {
    expect(Intention.safeParse(charge).success).toBe(false);
  });

  test("AUCUN schéma d'intention ne déclare de champ monétaire", () => {
    // Garde structurelle : si quelqu'un ajoute un jour `montantCents` à une
    // intention, ce test tombe avant que le modèle puisse s'en servir.
    const interdits = /montant|prix|cents|amount|tarif/i;
    for (const type of TYPES_INTENTION) {
      const forme = Intention.options.find(
        (o) => o.shape.type.value === type,
      );
      expect(forme, `schéma introuvable pour ${type}`).toBeDefined();
      for (const champ of Object.keys(forme!.shape)) {
        expect(interdits.test(champ), `${type}.${champ} évoque un montant`).toBe(false);
      }
    }
  });

  test("un type d'intention inconnu est rejeté", () => {
    expect(Intention.safeParse({ type: "supprimer_tout", cible: "factures" }).success).toBe(false);
  });

  test("`nonCompris` est obligatoire dans la sortie — au pire vide", () => {
    // Un plan qui fait silence sur ce qu'il a raté est un plan qui ment.
    const r = SortieModele.safeParse({ intentions: [] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.nonCompris).toEqual([]);
  });
});

// ── Rapprochement ───────────────────────────────────────────────────────────

describe("rapprochement d'une mention", () => {
  const candidats = [
    { id: "1", libelle: "Carrelage Dupont" },
    { id: "2", libelle: "Toiture Martin" },
  ];

  test("correspondance exacte, accents et casse ignorés", () => {
    const r = resoudreMention("CARRELAGE DUPONT", candidats);
    expect(r.etat).toBe("resolu");
    expect(r.etat === "resolu" && r.candidat.id).toBe("1");
    expect(r.etat === "resolu" && r.certitude).toBe("exacte");
  });

  test("correspondance partielle unique", () => {
    const r = resoudreMention("Dupont", candidats);
    expect(r.etat).toBe("resolu");
    expect(r.etat === "resolu" && r.certitude).toBe("partielle");
  });

  test("DEUX Dupont → ambigu, et surtout pas le premier de la liste", () => {
    // Sur un produit vocal, choisir au hasard écrit une erreur avant que
    // l'artisan l'ait vue.
    const deux = [
      { id: "1", libelle: "Dupont rue des Lilas" },
      { id: "2", libelle: "Dupont chantier de Marly" },
    ];
    const r = resoudreMention("Dupont", deux);
    expect(r.etat).toBe("ambigu");
    expect(r.etat === "ambigu" && r.candidats).toHaveLength(2);
  });

  test("aucun candidat → introuvable", () => {
    expect(resoudreMention("Durand", candidats).etat).toBe("introuvable");
  });

  test("une mention vide ne résout rien", () => {
    expect(resoudreMention("   ", candidats).etat).toBe("introuvable");
  });
});

// ── Dates dictées ───────────────────────────────────────────────────────────

describe("dates dictées en français", () => {
  // Référence fixe, en COMPOSANTES LOCALES : la construire depuis un instant
  // en ferait un jour différent selon le fuseau — le défaut que ce dépôt a
  // corrigé partout ailleurs.
  const REF = new Date(2026, 7, 10, 12, 0, 0); // lundi 10 août 2026

  test("« le 27 août » → 2026-08-27, dans les trois fuseaux", () => {
    expect(interpreterDate("le 27 août", REF)).toBe("2026-08-27");
  });

  test("« 1er septembre » → 2026-09-01", () => {
    expect(interpreterDate("1er septembre", REF)).toBe("2026-09-01");
  });

  test("une année explicite est respectée", () => {
    expect(interpreterDate("27 août 2027", REF)).toBe("2027-08-27");
  });

  test("« fin septembre » → le dernier jour du mois", () => {
    expect(interpreterDate("fin septembre", REF)).toBe("2026-09-30");
  });

  test("« début octobre » et « mi-novembre »", () => {
    expect(interpreterDate("début octobre", REF)).toBe("2026-10-01");
    expect(interpreterDate("mi-novembre", REF)).toBe("2026-11-15");
  });

  test("« demain » et « après-demain »", () => {
    expect(interpreterDate("demain", REF)).toBe("2026-08-11");
    expect(interpreterDate("après-demain", REF)).toBe("2026-08-12");
  });

  test("« lundi prochain » saute la semaine en cours", () => {
    // REF est un lundi : « lundi prochain » désigne le suivant, pas celui-ci.
    expect(interpreterDate("lundi prochain", REF)).toBe("2026-08-17");
  });

  test("« vendredi » depuis un lundi → le vendredi de la semaine", () => {
    expect(interpreterDate("vendredi", REF)).toBe("2026-08-14");
  });

  test("UNE DATE NON COMPRISE REND NULL, jamais la date du jour", () => {
    // Rendre « aujourd'hui » poserait une échéance à une date que personne
    // n'a dite, et qui aurait l'air d'avoir été voulue.
    for (const mention of ["", "   ", "bientôt", "quand il fera beau", "le 32 août", "31 février"]) {
      expect(interpreterDate(mention, REF), `« ${mention} » aurait dû rendre null`).toBeNull();
    }
  });

  test("le 29 février d'une année non bissextile est refusé, pas décalé", () => {
    // `new Date(2026, 1, 29)` déborde silencieusement au 1er mars.
    expect(interpreterDate("29 février", REF)).toBeNull();
  });

  test("une année bissextile l'accepte", () => {
    expect(interpreterDate("29 février", new Date(2028, 0, 5, 12, 0, 0))).toBe("2028-02-29");
  });
});

// ── Lot 4 : les champs que la voix laisse vides ─────────────────────────────

describe("champs à compléter — le montant se tape, il ne se dicte pas", () => {
  test("tout champ réclamé est aussi corrigeable — sinon c'est une impasse", () => {
    // Un champ réclamé à l'écran mais absent de la liste blanche des
    // corrections serait refusé au retour : l'utilisateur le remplirait et
    // se verrait dire non, sans autre issue que d'annuler.
    for (const type of TYPES_INTENTION) {
      for (const champ of CHAMPS_A_COMPLETER[type]) {
        expect(
          champCorrigeable(type, champ),
          `${type}.${champ} est réclamé mais non corrigeable`,
        ).toBe(true);
      }
    }
  });

  test.each([
    ["creer_article_catalogue", "prixUnitaireHtCents"],
    ["creer_charge_recurrente", "montantCents"],
    ["creer_contrat", "montantCents"],
  ])("%s réclame « %s »", (type, champ) => {
    expect(CHAMPS_A_COMPLETER[type as TypeIntention]).toContain(champ);
  });

  test("un champ vide, absent ou blanc est manquant ; une valeur ne l'est pas", () => {
    const t = "creer_article_catalogue";
    expect(champsManquants(t, { prixUnitaireHtCents: null })).toEqual(["prixUnitaireHtCents"]);
    expect(champsManquants(t, {})).toEqual(["prixUnitaireHtCents"]);
    // Des espaces ne sont pas un prix — le piège classique du champ « rempli ».
    expect(champsManquants(t, { prixUnitaireHtCents: "   " })).toEqual(["prixUnitaireHtCents"]);
    expect(champsManquants(t, { prixUnitaireHtCents: "4500" })).toEqual([]);
  });

  test("les intentions des lots précédents ne réclament rien", () => {
    // Garde anti-régression : ajouter un champ à compléter à une intention
    // existante changerait son contrat d'écran sans que personne le demande.
    for (const type of ["creer_affaire", "pointer_heures", "facturer_devis"] as const) {
      expect(CHAMPS_A_COMPLETER[type]).toEqual([]);
    }
  });
});
