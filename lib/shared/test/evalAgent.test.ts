/*
 * Le détecteur de formules interdites — ticket 4.23.
 *
 * ── Ce que ce fichier prouve, et ce qu'il ne prouve pas ───────────────────
 * Il prouve que le DÉTECTEUR fonctionne : qu'il repère les formules qui ont
 * fait échouer la session de test du 22/08, et qu'il laisse passer les refus
 * légitimes.
 *
 * Il ne prouve RIEN sur ce que l'agent répond réellement. Ça, seul un vrai
 * modèle peut le dire, et ça vit dans `scripts/evals-agent.mjs`, hors CI.
 *
 * ── Pourquoi les cas négatifs pèsent autant que les positifs ─────────────
 * Un détecteur trop large est pire qu'aucun détecteur : il rendrait l'éval
 * rouge sur des réponses justes, et la première chose qu'on ferait serait de
 * la désactiver. Les refus LÉGITIMES — un avis fiscal, un avis médical,
 * l'invitation d'un comptable — doivent passer.
 */
import { describe, test, expect } from "vitest";
import {
  formulesInterdites, annonceCapaciteAbsente, CORPUS_EVAL,
  FORMULES_INTERDITES, FORMULE_CAPACITE_ABSENTE,
} from "../src/evalAgent.js";

const codes = (t: string) => formulesInterdites(t).map((f) => f.code);

describe("les formules qui ont fait échouer la session du 22/08", () => {
  test("le verbatim exact de l'incident est repéré", () => {
    // La réponse qui a ouvert le ticket 4.23, mot pour mot.
    const incident =
      "Non, je ne peux pas créer de factures. Tu peux utiliser un logiciel de "
      + "comptabilité ou faire appel à un expert-comptable pour créer des factures "
      + "conformes à la réglementation en vigueur.";
    const trouvees = codes(incident);
    expect(trouvees).toContain("incapacite_declaree");
    expect(trouvees).toContain("renvoi_logiciel_tiers");
  });

  test("« je n'ai pas d'activité à te résumer » est repéré", () => {
    expect(codes("Je n'ai aucune activité à te résumer pour aujourd'hui."))
      .toContain("aucune_activite_a_tort");
  });

  test("les variantes de formulation sont repérées aussi", () => {
    // Un modèle ne répète pas deux fois la même phrase : une liste de chaînes
    // n'attraperait que celle qu'on a pensé à y écrire.
    for (const variante of [
      "Je ne peux pas te créer une facture.",
      "Je ne sais pas établir de devis.",
      "Je ne peux malheureusement pas générer ce contrat pour toi.",
    ]) {
      expect(codes(variante), variante).toContain("incapacite_declaree");
    }
  });

  test("l'apostrophe typographique ne fait pas manquer une faute", () => {
    // Un modèle alterne entre ' et ’ d'une phrase à l'autre. Un détecteur qui
    // n'en connaît qu'une manque une réponse sur deux — et son vert ne veut
    // plus rien dire.
    expect(codes("Je n’ai pas accès à tes données de facturation."))
      .toContain("acces_refuse");
  });

  test("le renvoi vers un tableur ou un concurrent nommé est repéré", () => {
    for (const v of [
      "Utilise un tableur pour faire ce calcul.",
      "Passe par un autre logiciel de facturation.",
      "Tu peux utiliser Excel pour ça.",
    ]) {
      expect(codes(v), v).toContain("renvoi_logiciel_tiers");
    }
  });
});

describe("les refus LÉGITIMES ne sont pas attrapés", () => {
  test("refuser un avis fiscal reste permis", () => {
    // Règle 3 bis : le refus doit exclure les fonctions de nodaq, pas les
    // avis réglementés. Attraper celui-ci pousserait à élargir le produit
    // là où il n'a pas à aller.
    expect(codes(
      "Je ne peux pas te donner un avis fiscal sur ce montage : "
      + "adresse-toi à ton expert-comptable.",
    )).toEqual([]);
  });

  test("refuser un avis médical ou juridique reste permis", () => {
    expect(codes("Je ne peux pas te conseiller sur ce point juridique.")).toEqual([]);
  });

  test("inviter le comptable dans l'espace n'est pas un renvoi", () => {
    // Le SEUL cas où « expert-comptable » est légitime dans la réponse : on
    // ne renvoie pas vers lui, on lui ouvre un accès.
    expect(codes(
      "J'ai préparé l'invitation de ton expert-comptable sur l'espace, "
      + "tu n'as plus qu'à valider.",
    )).toEqual([]);
  });

  test("annoncer une capacité absente comme il le faut n'est pas une faute", () => {
    expect(codes(FORMULE_CAPACITE_ABSENTE)).toEqual([]);
    expect(annonceCapaciteAbsente(FORMULE_CAPACITE_ABSENTE)).toBe(true);
  });

  test("une réponse ordinaire ne déclenche rien", () => {
    expect(codes(
      "J'ai préparé la facture pour le chantier Dupont : 4 500,00 € HT. "
      + "Valide-la depuis le cockpit et elle sera émise.",
    )).toEqual([]);
  });
});

describe("l'annonce d'une capacité absente", () => {
  test("elle exige la formule complète, pas seulement « pas disponible »", () => {
    // « Ce n'est pas disponible » sans « je le note » laisse l'utilisateur
    // sans suite : c'est un refus sec, pas une promesse tenue.
    expect(annonceCapaciteAbsente("Ce n'est pas disponible.")).toBe(false);
    expect(annonceCapaciteAbsente(
      "Ce n'est pas encore disponible dans nodaq, je le note pour l'équipe.",
    )).toBe(true);
  });
});

describe("le corpus", () => {
  test("vingt tâches, au moins deux formulations chacune", () => {
    // Le ticket demande les 20 tâches produit principales en 2 variantes
    // minimum. Le compte est vérifié plutôt qu'affirmé.
    expect(CORPUS_EVAL.length).toBeGreaterThanOrEqual(40);
    const familles = new Set(CORPUS_EVAL.map((c) => c.id.replace(/-\d+[a-z]$/, "")));
    expect(familles.size).toBeGreaterThanOrEqual(20);
  });

  test("chaque identifiant est unique", () => {
    const ids = CORPUS_EVAL.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("trois cas éprouvent une capacité qui n'existe PAS", () => {
    // Sans eux, un agent qui promettrait n'importe quoi passerait l'éval :
    // aucune formule interdite, aucun outil manquant, et une réponse fausse.
    const absentes = CORPUS_EVAL.filter((c) => c.capaciteAbsente);
    expect(absentes.length).toBeGreaterThanOrEqual(3);
    // Et aucune de ces trois n'attend d'outil : en attendre un serait se
    // contredire.
    for (const c of absentes) expect(c.outilAttendu, c.id).toBeNull();
  });

  test("toute écriture attendue est une écriture, pas une lecture", () => {
    // Règle 4 : une écriture passe par une `pending_action`. Un cas marqué
    // `ecriture` mais dont l'outil est une lecture ferait échouer l'éval pour
    // une raison qui n'est pas la bonne.
    for (const c of CORPUS_EVAL.filter((x) => x.ecriture)) {
      expect(c.outilAttendu === null || !c.outilAttendu.startsWith("get_"), c.id).toBe(true);
    }
  });

  test("chaque formule interdite porte son motif ET son pourquoi", () => {
    // Le « pourquoi » est rendu à qui verra son cas échouer : sans lui, il
    // devrait deviner ce qu'on lui reproche.
    for (const f of FORMULES_INTERDITES) {
      expect(f.code, "code vide").toBeTruthy();
      expect(f.pourquoi.length, f.code).toBeGreaterThan(40);
    }
  });
});
