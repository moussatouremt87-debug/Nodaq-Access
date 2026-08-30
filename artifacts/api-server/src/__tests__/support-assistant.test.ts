/**
 * L'assistant d'aide — ce qu'il ne doit JAMAIS faire.
 *
 * Sa valeur ne vient pas de ce qu'il sait dire, mais de ce qu'il ne peut pas
 * faire. Ces tests portent donc sur ses limites, pas sur la qualité de ses
 * phrases — celle-là se juge à l'usage, pas en CI.
 */
import { describe, test, expect } from "vitest";
import { CONSIGNE_SUPPORT } from "../lib/support-connaissances";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routeSource = readFileSync(
  join(__dirname, "..", "routes", "support.ts"), "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/gm, "$1");

describe("il ne peut RIEN déclencher", () => {
  /*
   * LA garde. Un assistant d'aide qui pourrait écrire serait un chemin
   * d'écriture de plus, hors du parcours de validation de la règle 4. Le seul
   * moyen sûr est de ne lui donner aucun outil — et de le vérifier ici, parce
   * qu'ajouter un outil « juste pour lire » est exactement la pente.
   */
  test("aucun outil n'est passé au modèle", () => {
    expect(routeSource).toMatch(/chatCompletion\(\s*config,\s*messages,\s*undefined/);
    expect(routeSource).not.toMatch(/tools\s*:/);
  });

  test("il ne touche à aucune table métier", () => {
    for (const interdit of ["withTenant", "db.select", "db.insert", "db.update", "Table"]) {
      expect(routeSource, `${interdit} n'a rien à faire dans l'aide`).not.toContain(interdit);
    }
  });

  test("la conversation n'est écrite nulle part", () => {
    expect(routeSource).not.toMatch(/insert|INSERT/);
  });
});

describe("la consigne tient les règles produit", () => {
  test("elle interdit « je ne peux pas » et le renvoi vers un tiers", () => {
    expect(CONSIGNE_SUPPORT).toMatch(/je ne peux pas/i);
    expect(CONSIGNE_SUPPORT).toMatch(/expert-comptable/i);
    // La formule de repli exacte imposée par la règle 3 bis.
    expect(CONSIGNE_SUPPORT).toMatch(/pas encore disponible dans nodaq/i);
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

describe("ce que la consigne SAIT du produit", () => {
  test("elle nomme les écrans réels, pas des écrans plausibles", () => {
    for (const ecran of ["Cockpit", "Brief matin", "Devis", "Factures", "Avoirs", "Classeur", "Marge"]) {
      expect(CONSIGNE_SUPPORT).toContain(ecran);
    }
  });

  test("elle décrit la règle comptable qu'un artisan enfreint le plus", () => {
    // « Je corrige ma facture déjà envoyée » — la question qui revient, et la
    // seule réponse juste est l'avoir.
    expect(CONSIGNE_SUPPORT).toMatch(/on ne modifie jamais une facture émise/i);
    expect(CONSIGNE_SUPPORT).toMatch(/AVOIR/);
  });

  test("elle explique l'attestation TVA comme une obligation, pas un caprice", () => {
    expect(CONSIGNE_SUPPORT).toMatch(/attestation TVA/i);
    expect(CONSIGNE_SUPPORT).toMatch(/obligation fiscale/i);
  });
});
