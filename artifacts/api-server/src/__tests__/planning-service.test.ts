/**
 * planning-service.ts — vocabulaire adaptatif (US-A1.1 / sweep US-A4.1).
 *
 * `calcHorizon` et `simulerChantier` prenaient le mot "chantier" en dur.
 * Ce fichier n'avait AUCUNE couverture avant ce test : ni la logique de
 * calcul, ni — ce que ce fichier protège spécifiquement — le fait que le
 * paramètre `words` est réellement utilisé dans le texte produit, pas
 * silencieusement ignoré.
 */
import { describe, test, expect } from "vitest";
import { buildSemaines, calcHorizon, simulerChantier, type MemberRecord, type SemaineData } from "../services/planning-service";
import { affaireWords } from "@nodaq/shared";

const CHANTIER = affaireWords("industrie_btp"); // "chantier" — vocabulaire historique
const MISSION = affaireWords("services_projet"); // "mission" — un vertical non-BTP

function semaineLibre(dateDebut: string): SemaineData {
  return {
    dateDebut,
    label: dateDebut,
    type: "libre",
    fillPct: 0,
    chantiers: [],
    absentsNoms: [],
    joursLibres: 5,
    joursDisponibles: 5,
    joursVendus: 0,
  };
}

describe("buildSemaines — capacité RH (US-A4.3)", () => {
  // Un lundi non férié, pour que les 5 jours ouvrés de la semaine comptent
  // pleinement — évite tout bruit de jour férié dans le calcul de capacité.
  const LUNDI = new Date("2026-08-10T00:00:00Z");

  function membre(overrides: Partial<MemberRecord>): MemberRecord {
    return {
      id: "m1", name: "Test", availability: "DISPONIBLE", typeLien: "SALARIE",
      schedule: [], ...overrides,
    };
  }

  test("un salarié compte pleinement dans la capacité", () => {
    const semaines = buildSemaines({
      today: LUNDI,
      members: [membre({ typeLien: "SALARIE" })],
      absences: [], affaires: [], weekCount: 1,
      tauxJourFacture: 1, coutJourCharge: 250,
    });
    expect(semaines[0]!.joursDisponibles).toBe(5);
  });

  test("un sous-traitant disponible ne compte PAS dans la capacité (l'angle mort corrigé)", () => {
    const semaines = buildSemaines({
      today: LUNDI,
      members: [membre({ typeLien: "SOUS_TRAITANT" })],
      absences: [], affaires: [], weekCount: 1,
      tauxJourFacture: 1, coutJourCharge: 250,
    });
    expect(semaines[0]!.joursDisponibles).toBe(0);
  });

  test("un apprenti compte, comme un salarié", () => {
    const semaines = buildSemaines({
      today: LUNDI,
      members: [membre({ typeLien: "APPRENTI" })],
      absences: [], affaires: [], weekCount: 1,
      tauxJourFacture: 1, coutJourCharge: 250,
    });
    expect(semaines[0]!.joursDisponibles).toBe(5);
  });

  test("un salarié et un sous-traitant : seul le salarié compte", () => {
    const semaines = buildSemaines({
      today: LUNDI,
      members: [
        membre({ id: "m1", typeLien: "SALARIE" }),
        membre({ id: "m2", typeLien: "SOUS_TRAITANT" }),
      ],
      absences: [], affaires: [], weekCount: 1,
      tauxJourFacture: 1, coutJourCharge: 250,
    });
    expect(semaines[0]!.joursDisponibles).toBe(5);
  });
});

describe("calcHorizon — vocabulaire adaptatif", () => {
  test("aucune semaine travaillée : le sous-titre reprend le mot du vertical (BTP)", () => {
    const result = calcHorizon([semaineLibre("2026-08-10")], 2, CHANTIER);
    expect(result.sous).toBe("Aucun chantier n'est planifié dans les prochaines semaines.");
  });

  test("même cas, vertical non-BTP : le sous-titre suit — accord féminin inclus", () => {
    const result = calcHorizon([semaineLibre("2026-08-10")], 2, MISSION);
    expect(result.sous).toBe("Aucune mission n'est planifiée dans les prochaines semaines.");
  });
});

describe("simulerChantier — vocabulaire adaptatif", () => {
  test("pas assez de monde : le détail reprend le mot du vertical (BTP)", () => {
    const result = simulerChantier({
      joursNecessaires: 3,
      personnesNecessaires: 5,
      semaines: [semaineLibre("2026-08-10")],
      activeCount: 2,
      words: CHANTIER,
    });
    expect(result.possible).toBe(false);
    expect(result.detail).toBe("Le chantier nécessite 5 personnes mais votre équipe n'en compte que 2.");
  });

  test("même cas, vertical non-BTP : « la mission » remplace « le chantier »", () => {
    const result = simulerChantier({
      joursNecessaires: 3,
      personnesNecessaires: 5,
      semaines: [semaineLibre("2026-08-10")],
      activeCount: 2,
      words: MISSION,
    });
    expect(result.detail).toBe("La mission nécessite 5 personnes mais votre équipe n'en compte que 2.");
  });

  test("créneau trouvé : « décalé »/« décalée » s'accorde avec le mot du vertical", () => {
    const semaines = [semaineLibre("2026-08-10")];

    const chantier = simulerChantier({
      joursNecessaires: 2, personnesNecessaires: 1, semaines, activeCount: 1, words: CHANTIER,
    });
    expect(chantier.possible).toBe(true);
    expect(chantier.detail).toMatch(/Aucun chantier en cours n'est décalé\.$/);

    const mission = simulerChantier({
      joursNecessaires: 2, personnesNecessaires: 1, semaines, activeCount: 1, words: MISSION,
    });
    expect(mission.detail).toMatch(/Aucune mission en cours n'est décalée\.$/);
  });
});
