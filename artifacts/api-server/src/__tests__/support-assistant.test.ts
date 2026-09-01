/**
 * L'assistant d'aide — ce qu'il ne doit JAMAIS faire.
 *
 * Sa valeur ne vient pas de ce qu'il sait dire, mais de ce qu'il ne peut pas
 * faire. Ces tests portent donc sur ses limites, pas sur la qualité de ses
 * phrases — celle-là se juge à l'usage, pas en CI.
 */
import { describe, test, expect } from "vitest";
import { CONSIGNE_SUPPORT, consigneSupport } from "../lib/support-connaissances";
import {
  exigeTransmission, suiteDe, ecranSur, CATEGORIE_PAR_DIAGNOSTIC,
} from "../lib/support-diagnostics";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeSource = readFileSync(
  join(__dirname, "..", "routes", "support.ts"), "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

/*
 * ── L'EXCEPTION À LA RÈGLE 4, ET CE QUI LA REND INOFFENSIVE ─────────────────
 *
 * Décidé le 30/08/2026 : le support transmet à l'équipe SANS validation
 * humaine. La règle 4 protège contre un agent qui agirait sur le MÉTIER de
 * l'artisan — envoyer un devis, émettre une facture. Ici le courriel part chez
 * l'éditeur, à la demande de quelqu'un qui vient de demander de l'aide.
 *
 * L'exception ne tient pas à une promesse mais à trois propriétés de FORME,
 * figées ci-dessous. Les retirer demanderait de faire rougir ces tests, donc
 * d'y penser.
 */
describe("l'exception reste bornée", () => {
  const diagSource = readFileSync(
    join(__dirname, "..", "lib", "support-diagnostics.ts"), "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

  /*
   * LA propriété. Le modèle ne choisit AUCUN destinataire : s'il pouvait, une
   * phrase bien tournée lui ferait écrire à un client de l'artisan.
   */
  test("l'outil de transmission n'accepte aucune adresse", () => {
    const bloc = /OUTIL_TRANSMISSION = \{[\s\S]*?\n\};/.exec(diagSource)?.[0] ?? "";
    expect(bloc, "OUTIL_TRANSMISSION introuvable").not.toBe("");
    for (const interdit of ["email", "adresse", "destinataire", "to"]) {
      expect(bloc.toLowerCase(), `« ${interdit} » ne doit pas être un paramètre`)
        .not.toMatch(new RegExp(`properties[\\s\\S]*?${interdit}\\s*:`, "i"));
    }
    expect(bloc).toMatch(/required:\s*\["resume"\]/);
  });

  test("les deux destinataires viennent de la configuration et de la session", () => {
    expect(diagSource).toMatch(/SUPPORT_ESCALADE_EMAIL/);
    expect(diagSource).toMatch(/ctx\.emailUtilisateur/);
    // Aucune adresse en dur : ni de repli, ni d'exemple oublié.
    expect(diagSource).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });

  test("sans configuration, rien ne part — et on le dit", () => {
    expect(diagSource).toMatch(/transmis: false/);
    expect(diagSource).toMatch(/n'est pas configurée/);
  });

  test("les diagnostics ne font que LIRE", () => {
    for (const interdit of [".insert(", ".update(", ".delete(", "INSERT", "UPDATE ", "DELETE "]) {
      expect(diagSource, `${interdit} n'a rien à faire dans un diagnostic`).not.toContain(interdit);
    }
  });

  test("ils passent tous par withTenant — l'isolation reste entière", () => {
    const fonctions = diagSource.match(/export async function diagnostic\w+/g) ?? [];
    expect(fonctions.length).toBeGreaterThanOrEqual(4);
    // Autant d'appels à withTenant que de diagnostics : aucun ne lit à côté.
    const appels = diagSource.match(/withTenant\(/g) ?? [];
    expect(appels.length).toBeGreaterThanOrEqual(fonctions.length);
  });

  /*
   * ── LA TRANSMISSION NE DÉPEND PAS DE LA PROSE DU MODÈLE ───────────────────
   *
   * Trois tentatives ont échoué le 30/08/2026 : consigne, consigne plus ferme,
   * puis détection de « transmis » dans le texte — il écrivait « je le
   * signale » et inventait une référence. La règle est devenue structurelle :
   * un diagnostic consulté déclenche le dossier, quoi que le modèle raconte.
   */
  test("la décision vient du RÉSULTAT du diagnostic, pas du texte", () => {
    expect(routeSource).toMatch(/suiteDe\(/);
    expect(routeSource).toMatch(/exigeTransmission\(suite\)/);
  });

  /*
   * ── ET ELLE NE SUR-DÉCLENCHE PLUS ─────────────────────────────────────────
   *
   * La règle « un diagnostic consulté ⇒ on transmet » a été vérifiée en
   * production le 30/08 et sur-déclenchait. Sur un tenant vide, l'agent
   * répondait correctement — aucune facture, voici le chemin pour en créer
   * une — puis promettait une réponse par courriel que personne n'enverrait.
   *
   * Une promesse de rappel non tenue coûte plus qu'un ticket manquant.
   */
  test("un diagnostic qui RÉPOND ne crée aucun dossier", () => {
    for (const suite of ["repond"] as const) {
      expect(exigeTransmission(suite), `« ${suite} » ne doit pas transmettre`).toBe(false);
    }
  });

  test("un diagnostic qui trouve une anomalie ou n'aboutit pas transmet", () => {
    for (const suite of ["anomalie", "inabouti"] as const) {
      expect(exigeTransmission(suite), `« ${suite} » doit transmettre`).toBe(true);
    }
  });

  test("un diagnostic qui OUBLIE de dire sa suite transmet quand même", () => {
    // Le repli sûr est celui qui ne perd pas de dossier : un diagnostic
    // ajouté plus tard sans champ `suite` doit faire remonter, pas se taire.
    expect(suiteDe({})).toBe("inabouti");
    expect(suiteDe({ suite: "n'importe quoi" })).toBe("inabouti");
    expect(suiteDe({ suite: "repond" })).toBe("repond");
  });

  test("les quatre diagnostics déclarent tous une suite", () => {
    // Sans ce contrôle, un diagnostic muet retomberait silencieusement sur
    // « inabouti » et rouvrirait la sur-transmission par la petite porte.
    const src = readFileSync(
      new URL("../lib/support-diagnostics.ts", import.meta.url), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const retours = src.match(/suite[,:]/g) ?? [];
    expect(retours.length, "un diagnostic ne rend pas de `suite`").toBeGreaterThanOrEqual(4);
  });

  test("une transmission réussie n'est jamais refaite dans la même conversation", () => {
    /*
     * PRÉCAUTION, pas correctif. Le commentaire précédent affirmait avoir
     * observé un doublon en production : c'était une erreur de lecture. Un
     * dossier produit DEUX lignes au journal — le courriel à l'équipe et
     * l'accusé de réception à l'utilisateur — et j'y avais vu deux dossiers.
     *
     * La garde reste : rien n'empêche un modèle d'appeler l'outil à ses deux
     * tours, et un second dossier porterait une référence que l'utilisateur
     * n'aurait jamais vue.
     */
    expect(routeSource).toMatch(/transmettre_a_l_equipe" && transmission\?\.transmis/);
  });

  test("un dossier envoie DEUX courriels, et c'est voulu", () => {
    // La propriété que j'avais prise pour un défaut. L'écrire noir sur blanc
    // évite qu'on la « corrige » un jour en supprimant l'accusé de réception —
    // sans lui, l'utilisateur n'a aucune trace écrite de sa demande.
    const diag = readFileSync(
      join(__dirname, "..", "lib", "support-diagnostics.ts"), "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const envois = diag.match(/await envoyer\(\{/g) ?? [];
    expect(envois.length, "un dossier doit produire deux envois").toBe(2);
    expect(diag).toMatch(/to:\s*ctx\.emailUtilisateur/);
  });

  test("aucune décision ne se prend en lisant la réponse du modèle", () => {
    // Un `texte.match(...)` qui déciderait d'envoyer serait un retour au
    // whack-a-mole des formulations.
    expect(routeSource).not.toMatch(/PROMESSE|texte\.match|test\(texte\)/);
  });

  test("les références inventées par le modèle sont retirées", () => {
    expect(routeSource).toMatch(/texte\.replace\(/);
    expect(routeSource).toMatch(/transmission\.reference/);
  });

  test("la conversation n'est écrite dans aucune table", () => {
    expect(routeSource).not.toMatch(/\.insert\(/);
  });
});

describe("la consigne tient les règles produit", () => {
  test("elle interdit « je ne peux pas » et le renvoi vers un tiers", () => {
    expect(CONSIGNE_SUPPORT).toMatch(/je ne peux pas/i);
    expect(CONSIGNE_SUPPORT).toMatch(/expert-comptable/i);
    // La formule de repli exacte imposée par la règle 3 bis.
    expect(CONSIGNE_SUPPORT).toMatch(/pas encore disponible dans nodaq/i);
  });

  /*
   * Observé avec le vrai modèle le 30/08/2026 : interrogé sur un code non reçu,
   * il a INVENTÉ une cause — « votre fournisseur a bloqué l'adresse » — sans
   * appeler le moindre diagnostic. Il aurait envoyé l'artisan reconfigurer son
   * envoi de courriel pour un problème qui n'existait pas.
   *
   * Un support qui suppose est pire qu'un support absent.
   */
  test("elle interdit d'affirmer une cause sans avoir regardé", () => {
    const plat = CONSIGNE_SUPPORT.replace(/\s+/g, " ");
    expect(plat).toMatch(/N'AFFIRMES JAMAIS UNE CAUSE SANS AVOIR REGARDÉ/);
    // Les quatre aiguillages nommés : un modèle ne devine pas quel outil sert
    // à quoi à partir d'une consigne générale.
    for (const outil of ["diagnostic_facture", "diagnostic_envois", "diagnostic_chantiers", "diagnostic_impayes"]) {
      expect(plat, `${outil} doit être associé à un symptôme`).toContain(outil);
    }
  });

  test("elle interdit d'annoncer une action future", () => {
    // « je regarde et je reviens vers vous » : il n'y aura pas de second tour.
    expect(CONSIGNE_SUPPORT).toMatch(/N'ANNONCES JAMAIS UNE ACTION FUTURE/);
  });

  test("elle impose le vouvoiement", () => {
    // Observé avec le vrai modèle : sans consigne, il alternait entre « votre
    // facture » et « ta prestation » d'une réponse à l'autre.
    expect(CONSIGNE_SUPPORT).toMatch(/TU VOUVOIES/);
  });

  test("elle bannit le jargon, en le nommant", () => {
    // Nommer les mots interdits est plus sûr que « pas de jargon » : un modèle
    // ne sait pas ce que ce mot recouvre pour un artisan français.
    for (const mot of ["MRR", "churn", "pipeline", "dashboard"]) {
      expect(CONSIGNE_SUPPORT).toContain(mot);
    }
  });

  test("elle lui interdit de produire un chiffre", () => {
    // Les espaces sont normalisés : une consigne se reformate, et une garde qui
    // rougit sur un retour à la ligne fait perdre du temps sans rien protéger.
    const plat = CONSIGNE_SUPPORT.replace(/\s+/g, " ");
    expect(plat).toMatch(/CALCULES AUCUN MONTANT/);
    expect(plat).toMatch(/aucune de ses données/i);
  });

  /*
   * La connaissance ne doit contenir NI tarif NI taux : les y mettre
   * inviterait le modèle à les recracher comme s'ils faisaient foi, ce que la
   * règle 3 interdit. Un taux de TVA cité dans un PARCOURS reste admis — c'est
   * une explication du chemin, pas un prix.
   */
  test("aucun montant en euros ne figure dans la connaissance", () => {
    const montants = CONSIGNE_SUPPORT.match(/\d+\s*(€|euros)/gi) ?? [];
    expect(montants, `montants trouvés : ${montants.join(", ")}`).toHaveLength(0);
  });
});

/*
 * Ces assertions visent `consigneSupport()` — ce que le modèle REÇOIT — et non
 * le gabarit. Depuis que la connaissance vit dans `docs/aide/*.md`, le gabarit
 * ne contient plus que les règles de conduite ; interroger le mauvais des deux
 * donnerait un vert qui ne prouve rien.
 */
describe("ce que la consigne SAIT du produit", () => {
  test("elle nomme les écrans réels, pas des écrans plausibles", () => {
    for (const ecran of ["Cockpit", "Brief matin", "Devis", "Factures", "Avoirs", "Classeur", "Marge"]) {
      expect(CONSIGNE_SUPPORT).toContain(ecran);
    }
  });

  test("elle décrit la règle comptable qu'un artisan enfreint le plus", () => {
    // « Je corrige ma facture déjà envoyée » — la question qui revient, et la
    // seule réponse juste est l'avoir.
    const recue = consigneSupport();
    expect(recue).toMatch(/on ne modifie jamais une facture émise/i);
    expect(recue).toMatch(/avoir/i);
  });

  test("elle explique l'attestation TVA comme une obligation, pas un caprice", () => {
    const recue = consigneSupport();
    expect(recue).toMatch(/attestation TVA/i);
    expect(recue).toMatch(/obligation fiscale/i);
  });
});

/*
 * ── LE DOSSIER D'ESCALADE EST LISIBLE PAR UNE MACHINE ───────────────────────
 *
 * Avant, il ne portait qu'un résumé en texte libre : utile à un humain,
 * inexploitable pour se saisir du problème sans reconstituer le contexte.
 *
 * L'en-tête nomme désormais les faits — et le plus important manquait
 * complètement : la VERSION déployée. Sans elle on instruit à l'aveugle, et on
 * reproduit parfois un défaut corrigé depuis deux jours dans le dépôt.
 */
describe("le dossier d'escalade porte les faits, pas seulement le récit", () => {
  const diagSource = readFileSync(
    join(__dirname, "..", "lib", "support-diagnostics.ts"), "utf8",
  );

  test("l'en-tête nomme la version, le tenant, l'écran et le verdict", () => {
    for (const champ of ["Référence", "Version", "Tenant", "Écran", "Catégorie", "Verdict"]) {
      expect(diagSource, `« ${champ} » absent de l'en-tête`).toContain(`${champ}`);
    }
    expect(diagSource).toMatch(/versionDeployee\(\)/);
  });

  test("la catégorie est DÉRIVÉE du diagnostic, jamais reçue du client", () => {
    /*
     * Ni demandée à l'artisan — il est bloqué, et une liste déroulante lui
     * ferait faire le travail du logiciel — ni produite par le modèle, qui
     * classerait au mauvais endroit sans que personne le voie.
     */
    expect(CATEGORIE_PAR_DIAGNOSTIC["diagnostic_facture"]).toBe("facturation");
    expect(CATEGORIE_PAR_DIAGNOSTIC["diagnostic_envois"]).toBe("envoi de documents");
    // Toutes les catégories connues viennent d'un diagnostic réel.
    for (const nom of Object.keys(CATEGORIE_PAR_DIAGNOSTIC)) {
      expect(diagSource, `${nom} n'existe pas comme outil`).toContain(nom);
    }
  });

  test("l'écran reçu du client est VALIDÉ contre une liste blanche", () => {
    /*
     * Une chaîne libre venue du navigateur finirait dans le courriel que lit
     * l'équipe : c'est un vecteur d'injection dans le dossier lui-même.
     */
    expect(ecranSur("/factures")).toBe("/factures");
    expect(ecranSur("/")).toBe("/");
    for (const hostile of [
      "/inconnu", "javascript:alert(1)", "\nRéférence : SUP-FAUSSE", 42, null, undefined,
    ]) {
      expect(ecranSur(hostile as never), `« ${String(hostile)} » recopié tel quel`)
        .toBe("non précisé");
    }
  });

  test("la version ne se DEVINE jamais", () => {
    // Une empreinte fausse est pire qu'une empreinte absente : on la croit.
    const src = readFileSync(join(__dirname, "..", "lib", "version-deployee.ts"), "utf8");
    expect(src).toMatch(/inconnue/);
    expect(src).toMatch(/commit inconnu/);
  });
});
