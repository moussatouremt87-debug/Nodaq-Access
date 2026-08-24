/*
 * Aucun vocabulaire de chantier écrit en dur dans ce qu'on donne au modèle.
 *
 * ── Le point d'attention d'US-A2.2, transformé en garde ───────────────────
 * « Vérifier que le modèle de langage n'a pas été implicitement biaisé
 * (prompt, exemples few-shot) vers un vocabulaire de chantier lors de son
 * paramétrage initial. »
 *
 * Une vérification faite une fois se périme au commit suivant. Celle-ci est
 * rejouée à chaque exécution, et elle a une histoire : le prompt de dictée
 * avait DÉJÀ été dé-bâtimentisé une première fois (US-A6.1, « un artisan du
 * bâtiment », « ouvriers sur le chantier », un exemple de toiture) — et il
 * restait une liste d'unités « m2, ml, u, h, forfait » que cette correction
 * n'avait pas vue. Deux descriptions d'outils portaient la même.
 *
 * C'est exactement ce que fait une garde et que ne fait pas une relecture :
 * attraper le morceau qu'on n'a pas regardé.
 *
 * ── Une garde STATIQUE, sur les fichiers source ───────────────────────────
 * Elle lit le texte, elle n'appelle pas le modèle. Un test qui appellerait un
 * modèle dépendrait d'une clé, et la CI ne dépend d'aucun secret.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VERTICALS, verticalPack } from "@nodaq/shared";

const ici = dirname(fileURLToPath(import.meta.url));
const src = join(ici, "..");

/**
 * Ce qu'on envoie au modèle, et rien d'autre.
 *
 * `plan-vocal.ts` n'y est pas : il traite la sortie du modèle, il ne la
 * conditionne pas. Ses mentions de « chantier » sont des commentaires
 * expliquant un cas d'usage, pas des instructions.
 */
const FICHIERS_DE_PROMPT = [
  "routes/devis-dictee.ts",
  "lib/mistralAgent.ts",
  "lib/vertical-tenant.ts",
] as const;

/**
 * Les mots d'un seul métier. Chacun a une raison d'être ici :
 * — `m²`/`m2`/`ml` : les unités qui portaient le biais, et le remède.
 * — `placo`, `BA13`, `cloison`, `gouttière`, `toiture`, `enduit`, `maçon` :
 *   le lexique de gros œuvre qui avait déjà dû être retiré une fois.
 *
 * « chantier » n'y figure PAS, et c'est délibéré : `verticalPacks` doit
 * pouvoir contenir le mot — c'est le vocabulaire légitime du bâtiment. Ce que
 * la garde interdit, c'est de l'écrire en dur dans une consigne partagée par
 * les dix-sept secteurs.
 */
const MOTS_DE_CHANTIER = [
  "m²", "m2", "ml",
  "placo", "ba13", "cloison", "gouttière", "toiture", "enduit", "maçon",
  "plaquiste", "couvreur", "carrelage",
] as const;

/** Les lignes de texte destinées au modèle, commentaires exclus. */
function lignesDInstruction(chemin: string): { n: number; texte: string }[] {
  const brut = readFileSync(join(src, chemin), "utf8");
  return brut.split("\n")
    .map((texte, i) => ({ n: i + 1, texte }))
    // Un commentaire n'atteint jamais le modèle. L'interdire noierait la
    // garde sous des faux positifs et pousserait à la contourner.
    .filter(({ texte }) => {
      const t = texte.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    });
}

describe("le prompt ne parle pas qu'aux maçons — US-A2.2", () => {
  test.each(FICHIERS_DE_PROMPT)("%s ne code en dur aucun mot de chantier", (chemin) => {
    const fautives = lignesDInstruction(chemin).filter(({ texte }) => {
      const bas = texte.toLowerCase();
      return MOTS_DE_CHANTIER.some((mot) => bas.includes(mot.toLowerCase()));
    });

    expect(
      fautives.map((l) => `${chemin}:${l.n}  ${l.texte.trim()}`),
      "Une consigne partagée par les 17 secteurs ne peut pas porter le lexique d'un seul. " +
      "Les unités du métier viennent de `verticalPack(vertical).unitesExemples`.",
    ).toEqual([]);
  });
});

describe("chaque secteur a ses propres unités", () => {
  test("les dix-sept packs en déclarent", () => {
    // Un pack qui n'en aurait pas ferait retomber son prompt sur du vide, et
    // le modèle réinventerait des unités — probablement celles qu'il a le
    // plus vues à l'entraînement, c'est-à-dire pas celles de ce métier.
    for (const v of VERTICALS) {
      expect(verticalPack(v).unitesExemples.length, `${v} n'a aucune unité`)
        .toBeGreaterThan(0);
    }
  });

  test("les métiers sans surface n'héritent pas du m²", () => {
    // Le cœur du défaut : une coiffeuse, un kiné, un taxi voyaient « m², ml »
    // en tête de liste sur chaque appel.
    for (const v of ["restauration_chr", "services_personne", "sante_liberale",
                     "professions_liberales", "transport", "artisanat_service"] as const) {
      expect(verticalPack(v).unitesExemples, v).not.toContain("m²");
      expect(verticalPack(v).unitesExemples, v).not.toContain("ml");
    }
  });

  test("les métiers de surface le gardent", () => {
    // La correction ne doit pas retirer au bâtiment son unité réelle.
    expect(verticalPack("batiment").unitesExemples).toContain("m²");
    expect(verticalPack("paysage").unitesExemples).toContain("m²");
  });

  test("chaque secteur a au moins une unité qui lui est propre", () => {
    // Sans quoi « sectoriel » ne voudrait rien dire : dix-sept listes
    // identiques auraient le même effet que la liste unique d'avant.
    const parSecteur = VERTICALS.map((v) => verticalPack(v).unitesExemples.join("|"));
    expect(new Set(parSecteur).size).toBeGreaterThan(6);
  });
});

describe("le vocabulaire envoyé au tenant porte SES unités", () => {
  test("un restaurant reçoit « couvert », jamais « m² »", async () => {
    const { vocabulaireAssistant } = await import("../lib/vertical-tenant.js");
    const texte = vocabulaireAssistant("restauration_chr");
    expect(texte).toContain("couvert");
    expect(texte).not.toContain("m²");
  });

  test("un maçon reçoit bien « m² »", async () => {
    const { vocabulaireAssistant } = await import("../lib/vertical-tenant.js");
    expect(vocabulaireAssistant("batiment")).toContain("m²");
  });

  test("les unités sont annoncées comme des EXEMPLES, pas une liste fermée", async () => {
    // Un modèle qui croirait la liste exhaustive refuserait l'unité que
    // l'utilisateur vient de dicter — pire que le biais qu'on corrige.
    const { vocabulaireAssistant } = await import("../lib/vertical-tenant.js");
    expect(vocabulaireAssistant("sante_liberale")).toMatch(/exemples/i);
  });
});
