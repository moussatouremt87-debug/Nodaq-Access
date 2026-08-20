/**
 * Le comportement de l'agent pendant l'appel — ticket 4.18, US-3/US-4.
 *
 * Ces tests sont l'ossature des évals du §5. Ils portent sur des fonctions
 * PURES, sans modèle : c'est ce qui permet d'affirmer qu'un agent hors mandat
 * serait un bug, et pas une dérive de prompt qu'on ne saurait pas reproduire.
 */
import { describe, test, expect } from "vitest";
import { contientMarqueurOral, verifierOralite } from "../src/oralite.js";
import {
  CONVERSATION_INITIALE,
  INSISTANCES_MAX,
  ISSUES_APPEL,
  annonceEstConforme,
  annonceOuverture,
  deciderEchelonnement,
  peutClore,
  peutInsister,
  registresInterdits,
  type EtatConversation,
} from "../src/decisionAppel.js";
import type { RegleRelance } from "../src/mandatNegociation.js";

const REGLE_OUVERTE: RegleRelance = {
  echelonnementAutorise: true,
  maxVersements: 3,
  delaiMaxPremierVersementJours: 15,
  retardMaxJours: 30,
  lienPaiementAutorise: true,
  remiseAutorisee: false,
};
const REGLE_FERMEE: RegleRelance = { ...REGLE_OUVERTE, echelonnementAutorise: false };

const DEMANDE_RAISONNABLE = {
  versements: 3,
  premierVersementDansJours: 10,
  dernierVersementRetardJours: 25,
};

const etat = (over: Partial<EtatConversation> = {}): EtatConversation => ({
  ...CONVERSATION_INITIALE,
  ...over,
});

// ── a. Les trois branches de l'US-3 ────────────────────────────────────────

describe("a — US-3 : la demande d'échelonnement, ses trois issues", () => {
  test("branche 1 — autorisé par la règle ET actif dans le mandat → accordé", () => {
    const d = deciderEchelonnement(REGLE_OUVERTE, REGLE_OUVERTE, DEMANDE_RAISONNABLE);
    expect(d.kind).toBe("accorde");
    if (d.kind === "accorde") {
      expect(d.versements).toBe(3);
      expect(d.premierVersementDansJours).toBe(10);
    }
  });

  test("branche 2 — autorisé par la règle, désactivé pour la campagne → remonté", () => {
    const mandat = { ...REGLE_OUVERTE, echelonnementAutorise: false };
    const d = deciderEchelonnement(REGLE_OUVERTE, mandat, DEMANDE_RAISONNABLE);

    expect(d.kind).toBe("remonte");
    if (d.kind === "remonte") {
      expect(d.motif).toBe("desactive_campagne");
      // Le dirigeant doit comprendre que c'est SA restriction de campagne, pas
      // sa règle : sinon il irait changer la mauvaise chose.
      expect(d.messageDirigeant).toMatch(/cette campagne/i);
      expect(d.messageDirigeant).not.toMatch(/param[èe]tres/i);
      // Pré-rempli pour une validation en un clic (US-3).
      expect(d.demande).toEqual(DEMANDE_RAISONNABLE);
    }
  });

  test("branche 3 — interdit par la règle → remonté, avec le chemin pour la changer", () => {
    const d = deciderEchelonnement(REGLE_FERMEE, REGLE_FERMEE, DEMANDE_RAISONNABLE);

    expect(d.kind).toBe("remonte");
    if (d.kind === "remonte") {
      expect(d.motif).toBe("interdit_regle");
      // L'US-3 branche 3 l'exige : signaler que la règle l'interdit, avec le
      // lien vers le paramètre — et jamais la modifier depuis l'appel.
      expect(d.messageDirigeant).toMatch(/r[èe]gles de relance/i);
      expect(d.messageDirigeant).toMatch(/param[èe]tres/i);
    }
  });

  test("la règle prime : mandat ouvert mais règle fermée → interdit_regle", () => {
    // Cas qui ne devrait pas exister — `restreindreMandat` l'empêche — mais si
    // un mandat corrompu arrivait ici, c'est la RÈGLE qui doit gagner.
    const d = deciderEchelonnement(REGLE_FERMEE, REGLE_OUVERTE, DEMANDE_RAISONNABLE);
    expect(d.kind).toBe("remonte");
    if (d.kind === "remonte") expect(d.motif).toBe("interdit_regle");
  });
});

// ── b. Hors bornes : on remonte, on ne rabote pas ──────────────────────────

describe("b — une demande hors bornes est remontée, jamais ramenée en silence", () => {
  test("trop de versements", () => {
    const d = deciderEchelonnement(REGLE_OUVERTE, REGLE_OUVERTE, {
      ...DEMANDE_RAISONNABLE,
      versements: 6,
    });
    expect(d.kind).toBe("remonte");
    if (d.kind === "remonte") expect(d.motif).toBe("hors_bornes");
  });

  test("premier versement trop tardif", () => {
    const d = deciderEchelonnement(REGLE_OUVERTE, REGLE_OUVERTE, {
      ...DEMANDE_RAISONNABLE,
      premierVersementDansJours: 60,
    });
    expect(d.kind).toBe("remonte");
  });

  test("dernier versement au-delà du retard accepté", () => {
    const d = deciderEchelonnement(REGLE_OUVERTE, REGLE_OUVERTE, {
      ...DEMANDE_RAISONNABLE,
      dernierVersementRetardJours: 120,
    });
    expect(d.kind).toBe("remonte");
  });

  test("la demande d'origine est conservée telle quelle", () => {
    // Le point : on ne « négocie » pas à la baisse dans le dos du débiteur.
    // Lui accorder autre chose que ce qu'il a demandé, sans le dire,
    // produirait une promesse qu'il n'a pas faite.
    const demande = { ...DEMANDE_RAISONNABLE, versements: 9 };
    const d = deciderEchelonnement(REGLE_OUVERTE, REGLE_OUVERTE, demande);
    if (d.kind === "remonte") expect(d.demande.versements).toBe(9);
  });

  test("pile sur la borne, c'est accordé", () => {
    const d = deciderEchelonnement(REGLE_OUVERTE, REGLE_OUVERTE, {
      versements: REGLE_OUVERTE.maxVersements,
      premierVersementDansJours: REGLE_OUVERTE.delaiMaxPremierVersementJours,
      dernierVersementRetardJours: REGLE_OUVERTE.retardMaxJours,
    });
    expect(d.kind).toBe("accorde");
  });
});

// ── c. Deux insistances, pas trois ─────────────────────────────────────────

describe("c — US-4 : l'insistance s'arrête à deux", () => {
  test("le plafond est DEUX — le nombre est l'exigence, pas un réglage", () => {
    // Épinglé littéralement, et non via `INSISTANCES_MAX` : un test qui se
    // contente de suivre la constante suit aussi ses erreurs. Découvert en
    // éprouvant la garde — passer le plafond à 3 ne faisait alors échouer
    // aucun test, alors que l'US-3 écrit « au plus deux fois ».
    expect(INSISTANCES_MAX).toBe(2);
  });

  test("les deux premières sont permises, la troisième non", () => {
    expect(peutInsister(etat({ insistances: 0 }))).toBe(true);
    expect(peutInsister(etat({ insistances: 1 }))).toBe(true);
    // Valeurs littérales : après deux relances, c'est fini.
    expect(peutInsister(etat({ insistances: 2 }))).toBe(false);
    expect(peutInsister(etat({ insistances: 3 }))).toBe(false);
    expect(peutInsister(etat({ insistances: 5 }))).toBe(false);
  });

  test("une demande d'arrêt prime sur le quota restant", () => {
    // Le cadre du recouvrement amiable sanctionne l'appel oppressant : un
    // quota non consommé ne justifie pas de continuer quand on vous demande
    // d'arrêter.
    expect(peutInsister(etat({ insistances: 0, clotureDemandee: true }))).toBe(false);
  });

  test("on n'insiste plus une fois la promesse obtenue", () => {
    expect(peutInsister(etat({ insistances: 0, promesseObtenue: true }))).toBe(false);
  });
});

// ── d. Pas de promesse sans reformulation ──────────────────────────────────

describe("d — US-3 : une promesse se verrouille par reformulation", () => {
  test("promesse obtenue mais non confirmée → l'agent ne peut pas clore", () => {
    expect(peutClore(etat({ promesseObtenue: true, promesseConfirmee: false }))).toBe(false);
  });

  test("promesse confirmée → l'agent peut clore", () => {
    expect(peutClore(etat({ promesseObtenue: true, promesseConfirmee: true }))).toBe(true);
  });

  test("sans promesse, clore est libre", () => {
    expect(peutClore(etat())).toBe(true);
  });

  test("une demande d'arrêt permet de clore immédiatement, promesse ou non", () => {
    // L'US-4 : si le débiteur s'énerve ou demande d'arrêter, l'agent clôt
    // IMMÉDIATEMENT. Exiger une reformulation à ce moment-là serait
    // exactement l'acharnement que la story interdit.
    expect(
      peutClore(etat({ promesseObtenue: true, promesseConfirmee: false, clotureDemandee: true })),
    ).toBe(true);
  });
});

// ── e. Ce que l'agent ne dit jamais ────────────────────────────────────────

describe("e — US-4 : les registres interdits sont détectables", () => {
  test.each([
    ["Je vais devoir engager une mise en demeure.", "mise en demeure"],
    ["Sinon nous passons au contentieux.", "contentieux"],
    ["Un huissier prendra le relais.", "contentieux"],
    ["Nous allons vous poursuivre.", "menace judiciaire"],
    ["Cela ira au tribunal.", "menace judiciaire"],
    ["Une saisie sera engagée.", "saisie"],
    ["Vous serez inscrit au fichier de la Banque de France.", "fichage"],
    ["Vous devriez avoir honte de ne pas payer.", "culpabilisation"],
  ])("« %s » est détecté", (propos, libelleAttendu) => {
    const detectes = registresInterdits(propos).map((d) => d.libelle);
    expect(detectes).toContain(libelleAttendu);
  });

  test("la persuasion POSITIVE ne déclenche rien", () => {
    // L'US-4 autorise exactement cela : faciliter le paiement.
    const propos = [
      "Quel jour exactement puis-je noter ?",
      "Je peux vous envoyer un lien de paiement tout de suite si c'est plus simple.",
      "Nous pouvons échelonner en trois fois, le premier versement sous dix jours.",
      "Je récapitule : vous réglez 1 200 € le 15 septembre, c'est bien cela ?",
    ].join(" ");
    expect(registresInterdits(propos)).toEqual([]);
  });

  test("un propos vide ne déclenche rien", () => {
    expect(registresInterdits("")).toEqual([]);
  });
});

// ── f. L'annonce d'ouverture ───────────────────────────────────────────────

describe("f — US-2 : l'agent s'annonce, et dit la vérité sur la transcription", () => {
  test("l'annonce nomme l'entreprise et se déclare automatique", () => {
    const annonce = annonceOuverture("Charpente Dubois");
    expect(annonce).toContain("Charpente Dubois");
    expect(annonceEstConforme(annonce)).toBe(true);
  });

  test("elle annonce une transcription, et ne prétend PAS enregistrer", () => {
    // Le produit ne conserve pas l'audio (§6). L'annonce disait autrefois
    // « on enregistre pas l'audio » ; la mention a sauté le 2026-08-20
    // (décision fondateur : l'ouverture se paie en secondes, et cette
    // précision était un plus, pas une obligation). Le FOND qui reste
    // épinglé : la transcription est annoncée, et l'annonce ne CLAME jamais
    // un enregistrement qui n'a pas lieu — dans un sens comme dans l'autre.
    const annonce = annonceOuverture("Dubois");
    expect(annonce).toMatch(/retranscrit/i);
    expect(annonce).not.toMatch(/enregistr/i);
  });

  test("elle propose la sortie — humain ou rappel", () => {
    const annonce = annonceOuverture("Dubois");
    expect(annonce).toMatch(/rappeler|parler à quelqu'un/i);
  });

  test("une ouverture qui n'annonce pas l'assistant est non conforme", () => {
    expect(annonceEstConforme("Bonjour, je vous appelle au sujet de votre facture.")).toBe(false);
  });
});

// ── g. Les issues typées ───────────────────────────────────────────────────

describe("g — US-6 : les issues d'appel sont celles du ticket", () => {
  test("la liste est exactement celle annoncée", () => {
    expect([...ISSUES_APPEL].sort()).toEqual(
      ["callback_requested", "dispute", "paid_claimed", "promise", "refused", "unreachable"].sort(),
    );
  });
});

// ── h. Oralité des répliques produites par le noyau ────────────────────────

describe("h — l'agent parle, il ne rédige pas", () => {
  test("l'annonce d'ouverture passe la garde d'oralité", () => {
    // Une réplique qui sonne comme un courrier est un échec, pas un
    // avertissement : c'est ce qui fait raccrocher.
    const anomalies = verifierOralite(annonceOuverture("Charpente Dubois"));
    expect(anomalies, JSON.stringify(anomalies)).toEqual([]);
  });

  test("elle contient au moins un marqueur d'oral", () => {
    expect(contientMarqueurOral(annonceOuverture("Dubois"))).toBe(true);
  });

  test("aucune phrase de l'annonce ne dépasse quinze mots", () => {
    const trop = verifierOralite(annonceOuverture("Dubois")).filter(
      (a) => a.nature === "phrase_trop_longue",
    );
    expect(trop).toEqual([]);
  });
});
