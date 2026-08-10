/**
 * Axes de prospection — cibles professionnelles, et sources obligatoires.
 *
 * Ce que ces tests protègent :
 *   — AUCUNE cible « particulier » ne peut exister, même par erreur de saisie ;
 *   — aucun axe n'est proposé sans source citable ;
 *   — un secteur inconnu ne produit rien plutôt qu'une piste inventée ;
 *   — le silence est EXPLIQUÉ, jamais muet.
 */
import { describe, test, expect } from "vitest";
import {
  axesPourMetier,
  raisonSilence,
  MESSAGES_SILENCE,
  CIBLES_PROSPECTION,
  type ContexteTenant,
} from "../src/axesProspection.js";

const SOURCE = { label: "Annuaire des entreprises", url: "https://exemple.test/annuaire" };

const contexte = (p: Partial<ContexteTenant> = {}): ContexteTenant => ({
  secteur: "batiment",
  zone: "Marly-Gomont",
  sources: [SOURCE],
  ...p,
});

// ── La contrainte qui commande tout ─────────────────────────────────────────

describe("UNIQUEMENT des cibles professionnelles", () => {
  test("aucune cible « particulier » n'existe dans la liste fermée", () => {
    // Depuis le 11 août 2026, le démarchage téléphonique d'un particulier
    // exige un consentement préalable. Ce n'est pas un filtre appliqué après
    // coup : la valeur n'existe pas dans le type.
    const interdits = /particulier|personne_physique|menage|consommateur/i;
    for (const cible of CIBLES_PROSPECTION) {
      expect(interdits.test(cible), `« ${cible} » évoque un particulier`).toBe(false);
    }
  });

  test("aucun axe produit ne vise un particulier, quel que soit le secteur", () => {
    for (const secteur of ["batiment", "paysage", "maintenance"]) {
      for (const axe of axesPourMetier(contexte({ secteur }))) {
        expect(CIBLES_PROSPECTION).toContain(axe.cible);
        expect(/particulier/i.test(axe.libelle)).toBe(false);
        expect(/particulier/i.test(axe.pourquoi)).toBe(false);
      }
    }
  });

  test("un secteur inventé ne fabrique pas de cible", () => {
    expect(axesPourMetier(contexte({ secteur: "particuliers" }))).toEqual([]);
    expect(raisonSilence(contexte({ secteur: "particuliers" }))).toBe("secteur_inconnu");
  });
});

// ── Une suggestion sans source n'existe pas ─────────────────────────────────

describe("aucune suggestion sans source citable", () => {
  test("sans source configurée, aucun axe", () => {
    expect(axesPourMetier(contexte({ sources: [] }))).toEqual([]);
    expect(raisonSilence(contexte({ sources: [] }))).toBe("aucune_source");
  });

  test("CHAQUE axe porte une source complète", () => {
    const axes = axesPourMetier(contexte());
    expect(axes.length).toBeGreaterThan(0);
    for (const axe of axes) {
      expect(axe.source.label.length).toBeGreaterThan(0);
      expect(axe.source.url).toMatch(/^https?:\/\//);
    }
  });

  test("la source citée est bien celle qui a été configurée", () => {
    const autre = { label: "Autre registre", url: "https://autre.test/x" };
    const axes = axesPourMetier(contexte({ sources: [autre] }));
    expect(axes.every((a) => a.source.label === "Autre registre")).toBe(true);
  });
});

// ── Le silence est expliqué ─────────────────────────────────────────────────

describe("ne rien proposer est un résultat, pas une panne", () => {
  test.each([
    ["aucune_source", contexte({ sources: [] })],
    ["secteur_absent", contexte({ secteur: null })],
    ["zone_absente", contexte({ zone: null })],
    ["secteur_inconnu", contexte({ secteur: "aeronautique" })],
  ])("%s → aucun axe, et une raison", (attendue, c) => {
    expect(axesPourMetier(c)).toEqual([]);
    expect(raisonSilence(c)).toBe(attendue);
  });

  test("chaque raison a une phrase affichable", () => {
    // Se taire sans le dire ferait croire qu'il n'y a rien à démarcher.
    for (const raison of Object.keys(MESSAGES_SILENCE) as Array<keyof typeof MESSAGES_SILENCE>) {
      expect(MESSAGES_SILENCE[raison].length).toBeGreaterThan(30);
    }
  });

  test("quand tout est renseigné, il n'y a plus de raison de se taire", () => {
    expect(raisonSilence(contexte())).toBeNull();
    expect(axesPourMetier(contexte()).length).toBeGreaterThan(0);
  });
});

// ── Contenu des axes ────────────────────────────────────────────────────────

describe("ce qu'un axe dit à l'artisan", () => {
  test("la zone du tenant est reprise dans le libellé", () => {
    const axes = axesPourMetier(contexte({ zone: "Laon" }));
    expect(axes.every((a) => a.libelle.includes("Laon"))).toBe(true);
    expect(axes.every((a) => a.zone === "Laon")).toBe(true);
  });

  test("chaque axe explique POURQUOI — une phrase, pas un score", () => {
    // Un score n'aide pas un couvreur à décider ; une raison, si.
    for (const axe of axesPourMetier(contexte())) {
      expect(axe.pourquoi.length).toBeGreaterThan(30);
      expect(axe.pourquoi).not.toMatch(/\d+\s*%/);
    }
  });

  test("le bâtiment propose bien les syndics et les entreprises générales", () => {
    const cibles = axesPourMetier(contexte({ secteur: "batiment" })).map((a) => a.cible);
    expect(cibles).toContain("syndic");
    expect(cibles).toContain("entreprise_generale");
  });
});
