/**
 * L'invariant central du ticket 4.18 : une campagne RESTREINT la règle du
 * tenant, jamais elle ne l'élargit.
 *
 * C'est ce qui rend l'autonomie de l'agent acceptable — il négocie seul, mais
 * à l'intérieur d'un plafond posé à froid par le dirigeant. Si cet invariant
 * cède, tout le reste du dispositif ne vaut plus rien : le mandat figé, le
 * versionnement de la règle, les évals. D'où des tests qui vont jusqu'au corps
 * forgé, et pas seulement au cas nominal.
 */
import { describe, test, expect } from "vitest";
import {
  REGLE_RELANCE_DEFAUT,
  restreindreMandat,
  depassementsMandat,
  mandatEstRestreint,
  verifierRegleRelance,
  resumerRegleRelance,
  type RegleRelance,
} from "../src/mandatNegociation.js";

const REGLE_OUVERTE: RegleRelance = {
  echelonnementAutorise: true,
  maxVersements: 4,
  delaiMaxPremierVersementJours: 15,
  retardMaxJours: 45,
  lienPaiementAutorise: true,
  remiseAutorisee: true,
};

// ── a. L'invariant, dans le sens qui compte ────────────────────────────────

describe("a — une campagne ne peut jamais élargir la règle", () => {
  test("un drapeau fermé par la règle reste fermé, quoi qu'on demande", () => {
    const mandat = restreindreMandat(REGLE_RELANCE_DEFAUT, {
      echelonnementAutorise: true,
      lienPaiementAutorise: true,
      remiseAutorisee: true,
    });
    expect(mandat.echelonnementAutorise).toBe(false);
    expect(mandat.lienPaiementAutorise).toBe(false);
    expect(mandat.remiseAutorisee).toBe(false);
  });

  test("une borne ne peut pas être relevée au-dessus de la règle", () => {
    const mandat = restreindreMandat(REGLE_OUVERTE, {
      maxVersements: 99,
      delaiMaxPremierVersementJours: 365,
      retardMaxJours: 9999,
    });
    expect(mandat.maxVersements).toBe(REGLE_OUVERTE.maxVersements);
    expect(mandat.delaiMaxPremierVersementJours).toBe(
      REGLE_OUVERTE.delaiMaxPremierVersementJours,
    );
    expect(mandat.retardMaxJours).toBe(REGLE_OUVERTE.retardMaxJours);
  });

  test("un corps forgé ne passe pas — valeurs absurdes comprises", () => {
    // Le clamping est sûr PAR CONSTRUCTION : quoi qu'on lui passe, il ne peut
    // pas rendre plus large que la règle. C'est pour ça qu'il est préféré à un
    // refus, qui dépendrait d'avoir pensé à tous les cas.
    const forge = {
      maxVersements: Number.POSITIVE_INFINITY,
      retardMaxJours: Number.NaN,
      delaiMaxPremierVersementJours: -50,
      echelonnementAutorise: true,
    } as unknown as Partial<RegleRelance>;

    const mandat = restreindreMandat(REGLE_RELANCE_DEFAUT, forge);

    expect(mandat.echelonnementAutorise).toBe(false);
    expect(Number.isFinite(mandat.maxVersements)).toBe(true);
    expect(mandat.maxVersements).toBeLessThanOrEqual(REGLE_RELANCE_DEFAUT.maxVersements);
    expect(mandat.retardMaxJours).toBe(REGLE_RELANCE_DEFAUT.retardMaxJours);
    // Une valeur négative est ramenée à zéro, jamais laissée négative : un
    // délai négatif ferait exiger un versement dans le passé.
    expect(mandat.delaiMaxPremierVersementJours).toBe(0);
  });

  test("aucune combinaison de demandes ne dépasse la règle", () => {
    // Balayage exhaustif des drapeaux plutôt que trois cas choisis : c'est
    // l'ensemble des chemins qui doit être sûr, pas ceux auxquels j'ai pensé.
    const regles: RegleRelance[] = [REGLE_RELANCE_DEFAUT, REGLE_OUVERTE];
    for (const regle of regles) {
      for (const ech of [true, false]) {
        for (const lien of [true, false]) {
          for (const remise of [true, false]) {
            const m = restreindreMandat(regle, {
              echelonnementAutorise: ech,
              lienPaiementAutorise: lien,
              remiseAutorisee: remise,
              maxVersements: 12,
              delaiMaxPremierVersementJours: 90,
              retardMaxJours: 365,
            });
            expect(m.echelonnementAutorise && !regle.echelonnementAutorise).toBe(false);
            expect(m.lienPaiementAutorise && !regle.lienPaiementAutorise).toBe(false);
            expect(m.remiseAutorisee && !regle.remiseAutorisee).toBe(false);
            expect(m.maxVersements).toBeLessThanOrEqual(regle.maxVersements);
            expect(m.retardMaxJours).toBeLessThanOrEqual(regle.retardMaxJours);
          }
        }
      }
    }
  });
});

// ── b. L'invariant, dans l'autre sens : restreindre doit marcher ───────────

describe("b — restreindre fonctionne, sinon le mandat ne sert à rien", () => {
  test("désactiver l'échelonnement pour une campagne est possible", () => {
    // Le cas nommé par l'US-1 : un débiteur récidiviste, l'échelonnement coupé
    // pour cette campagne seulement.
    const mandat = restreindreMandat(REGLE_OUVERTE, { echelonnementAutorise: false });
    expect(mandat.echelonnementAutorise).toBe(false);
    // Et le reste de la règle n'a pas bougé.
    expect(mandat.retardMaxJours).toBe(REGLE_OUVERTE.retardMaxJours);
  });

  test("serrer une borne est possible", () => {
    const mandat = restreindreMandat(REGLE_OUVERTE, { retardMaxJours: 10, maxVersements: 2 });
    expect(mandat.retardMaxJours).toBe(10);
    expect(mandat.maxVersements).toBe(2);
  });

  test("une demande vide rend la règle telle quelle", () => {
    expect(restreindreMandat(REGLE_OUVERTE, {})).toEqual(REGLE_OUVERTE);
    expect(restreindreMandat(REGLE_OUVERTE)).toEqual(REGLE_OUVERTE);
  });
});

// ── c. Dire ce qui a été ramené ────────────────────────────────────────────

describe("c — un dépassement est signalé, pas avalé", () => {
  test("le cas nominal ne signale rien", () => {
    expect(depassementsMandat(REGLE_OUVERTE, { echelonnementAutorise: false })).toEqual([]);
    // Un formulaire pré-rempli renvoie des valeurs ÉGALES à la règle : ce cas
    // doit rester silencieux, sinon l'usage normal ressemblerait à une faute.
    expect(depassementsMandat(REGLE_OUVERTE, REGLE_OUVERTE)).toEqual([]);
  });

  test("vouloir ouvrir ce que la règle ferme est signalé, avec le chemin pour le changer", () => {
    const d = depassementsMandat(REGLE_RELANCE_DEFAUT, { echelonnementAutorise: true });
    expect(d).toHaveLength(1);
    expect(d[0]!.champ).toBe("echelonnementAutorise");
    // L'US-3 branche 3 l'exige : dire au dirigeant que sa règle l'interdit, et
    // où la changer — jamais depuis l'appel lui-même.
    expect(d[0]!.message).toMatch(/règle de l'entreprise/i);
    expect(d[0]!.message).toMatch(/paramètres/i);
  });

  test("une borne relevée est signalée avec le plafond réel", () => {
    const d = depassementsMandat(REGLE_OUVERTE, { retardMaxJours: 120 });
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("45");
  });
});

// ── d. Savoir si la campagne serre ─────────────────────────────────────────

describe("d — l'écran peut dire quand une campagne restreint la règle", () => {
  test("mandat identique à la règle → pas restreint", () => {
    expect(mandatEstRestreint(REGLE_OUVERTE, restreindreMandat(REGLE_OUVERTE))).toBe(false);
  });

  test("un seul champ serré suffit", () => {
    const mandat = restreindreMandat(REGLE_OUVERTE, { maxVersements: 2 });
    expect(mandatEstRestreint(REGLE_OUVERTE, mandat)).toBe(true);
  });
});

// ── e. La règle elle-même ──────────────────────────────────────────────────

describe("e — cohérence et résumé de la règle", () => {
  test("le défaut est prudent, et il est cohérent", () => {
    expect(REGLE_RELANCE_DEFAUT.echelonnementAutorise).toBe(false);
    expect(REGLE_RELANCE_DEFAUT.remiseAutorisee).toBe(false);
    expect(verifierRegleRelance(REGLE_RELANCE_DEFAUT)).toEqual([]);
  });

  test("un échelonnement à un versement est incohérent", () => {
    const anomalies = verifierRegleRelance({
      ...REGLE_OUVERTE,
      echelonnementAutorise: true,
      maxVersements: 1,
    });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.message).toMatch(/deux versements/i);
  });

  test("le résumé d'une règle fermée dit qu'elle n'accorde rien", () => {
    expect(resumerRegleRelance(REGLE_RELANCE_DEFAUT)).toMatch(/n'accorde rien d'autre/i);
  });

  test("le résumé d'une règle ouverte énumère les concessions", () => {
    const resume = resumerRegleRelance(REGLE_OUVERTE);
    expect(resume).toMatch(/échelonnement/i);
    expect(resume).toMatch(/lien de paiement/i);
    expect(resume).toMatch(/remise/i);
  });
});
