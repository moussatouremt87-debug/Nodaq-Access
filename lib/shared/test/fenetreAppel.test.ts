/**
 * Fenêtre d'appel et plafond de tentatives — ticket 4.18, US-2/US-5.
 *
 * Le cadre du recouvrement amiable sanctionne l'appel répété ou oppressant :
 * ces deux garde-fous sont ce qui sépare une relance d'un harcèlement, et ils
 * se testent sans téléphone.
 *
 * Les dates sont construites en COMPOSANTES LOCALES (`new Date(a, m, j, h)`) —
 * jamais depuis une chaîne UTC. C'est la leçon du correctif de fuseau sur
 * `emission-electronique` : un instant UTC ne désigne pas la même heure locale
 * partout, et cette suite tourne sous trois fuseaux en CI.
 */
import { describe, test, expect } from "vitest";
import {
  FENETRE_APPEL_DEFAUT,
  TENTATIVES_MAX_DEFAUT,
  dansFenetreAppel,
  estJourOuvre,
  messageRepondeur,
  messageRepondeurEstDiscret,
  peutAppeler,
  prochaineOuverture,
  type ContexteAppel,
} from "../src/fenetreAppel.js";

/** Lundi 17 août 2026, à l'heure locale demandée. */
const lundi = (h: number, min = 0) => new Date(2026, 7, 17, h, min, 0, 0);
/** Samedi 22 août 2026. */
const samedi = (h: number) => new Date(2026, 7, 22, h, 0, 0, 0);
/** Dimanche 23 août 2026. */
const dimanche = (h: number) => new Date(2026, 7, 23, h, 0, 0, 0);

const ctx = (over: Partial<ContexteAppel> = {}): ContexteAppel => ({
  maintenant: lundi(10),
  fenetre: FENETRE_APPEL_DEFAUT,
  tentativesDejaFaites: 0,
  tentativesMax: TENTATIVES_MAX_DEFAUT,
  opposition: false,
  campagneValidee: true,
  ...over,
});

// ── a. Les bornes de la fenêtre ────────────────────────────────────────────

describe("a — la fenêtre horaire, bornes comprises", () => {
  test("9 h ouvre, 17 h 59 est encore dedans", () => {
    expect(dansFenetreAppel(lundi(9), FENETRE_APPEL_DEFAUT)).toBe(true);
    expect(dansFenetreAppel(lundi(17, 59), FENETRE_APPEL_DEFAUT)).toBe(true);
  });

  test("18 h est DEHORS — la borne de fin est exclue", () => {
    // Le débiteur qui décroche à 18 h 01 aurait raison de le prendre mal.
    expect(dansFenetreAppel(lundi(18), FENETRE_APPEL_DEFAUT)).toBe(false);
    expect(dansFenetreAppel(lundi(18, 30), FENETRE_APPEL_DEFAUT)).toBe(false);
  });

  test("avant l'ouverture, dehors", () => {
    expect(dansFenetreAppel(lundi(8, 59), FENETRE_APPEL_DEFAUT)).toBe(false);
    expect(dansFenetreAppel(lundi(3), FENETRE_APPEL_DEFAUT)).toBe(false);
  });

  test("le week-end, jamais — même en pleine fenêtre horaire", () => {
    expect(dansFenetreAppel(samedi(10), FENETRE_APPEL_DEFAUT)).toBe(false);
    expect(dansFenetreAppel(dimanche(14), FENETRE_APPEL_DEFAUT)).toBe(false);
  });

  test("les jours ouvrés sont lundi à vendredi", () => {
    expect(estJourOuvre(lundi(10))).toBe(true);
    expect(estJourOuvre(new Date(2026, 7, 21, 10))).toBe(true); // vendredi
    expect(estJourOuvre(samedi(10))).toBe(false);
    expect(estJourOuvre(dimanche(10))).toBe(false);
  });
});

// ── b. La prochaine ouverture ──────────────────────────────────────────────

describe("b — quand rappellera-t-on ?", () => {
  test("avant l'ouverture, c'est le jour même", () => {
    const p = prochaineOuverture(lundi(7), FENETRE_APPEL_DEFAUT);
    expect(p.getDate()).toBe(17);
    expect(p.getHours()).toBe(9);
    expect(p.getMinutes()).toBe(0);
  });

  test("après la fermeture, c'est le lendemain ouvré", () => {
    const p = prochaineOuverture(lundi(19), FENETRE_APPEL_DEFAUT);
    expect(p.getDate()).toBe(18);
    expect(p.getHours()).toBe(9);
  });

  test("le vendredi soir, c'est le lundi — pas le samedi", () => {
    const vendrediSoir = new Date(2026, 7, 21, 19, 0, 0, 0);
    const p = prochaineOuverture(vendrediSoir, FENETRE_APPEL_DEFAUT);
    expect(estJourOuvre(p)).toBe(true);
    expect(p.getDate()).toBe(24); // lundi 24 août
  });

  test("le samedi, c'est le lundi", () => {
    const p = prochaineOuverture(samedi(11), FENETRE_APPEL_DEFAUT);
    expect(p.getDate()).toBe(24);
    expect(p.getHours()).toBe(9);
  });

  test("l'heure rendue est toujours dans la fenêtre", () => {
    // Balayage : quel que soit le point de départ, la date rendue doit être
    // appelable. Sinon on programmerait une tentative qui serait refusée.
    for (let jour = 17; jour <= 23; jour++) {
      for (const h of [0, 7, 9, 13, 17, 18, 23]) {
        const p = prochaineOuverture(new Date(2026, 7, jour, h), FENETRE_APPEL_DEFAUT);
        expect(dansFenetreAppel(p, FENETRE_APPEL_DEFAUT), `depuis le ${jour} à ${h} h`).toBe(true);
      }
    }
  });
});

// ── c. L'éligibilité, et son ordre de vérification ─────────────────────────

describe("c — cet appel peut-il partir ?", () => {
  test("cas nominal", () => {
    expect(peutAppeler(ctx()).autorise).toBe(true);
  });

  test("une opposition passe AVANT tout le reste", () => {
    // Répondre « hors fenêtre » à quelqu'un qui a demandé à ne plus être
    // appelé laisserait croire qu'on rappellera plus tard.
    const r = peutAppeler(
      ctx({ opposition: true, maintenant: dimanche(3), tentativesDejaFaites: 99 }),
    );
    expect(r.autorise).toBe(false);
    expect(r.motif).toBe("opposition");
    expect(r.reessayerLe, "un refus définitif ne propose pas de réessai").toBeUndefined();
  });

  test("sans campagne validée, rien ne part", () => {
    const r = peutAppeler(ctx({ campagneValidee: false }));
    expect(r.autorise).toBe(false);
    expect(r.motif).toBe("campagne_non_validee");
  });

  test("les tentatives s'épuisent", () => {
    expect(peutAppeler(ctx({ tentativesDejaFaites: 2 })).autorise).toBe(true);
    const r = peutAppeler(ctx({ tentativesDejaFaites: 3 }));
    expect(r.autorise).toBe(false);
    expect(r.motif).toBe("tentatives_epuisees");
  });

  test("hors fenêtre, le refus est temporaire et dit quand", () => {
    const r = peutAppeler(ctx({ maintenant: lundi(21) }));
    expect(r.autorise).toBe(false);
    expect(r.motif).toBe("hors_fenetre");
    expect(r.reessayerLe).toBeTruthy();
    expect(dansFenetreAppel(r.reessayerLe!, FENETRE_APPEL_DEFAUT)).toBe(true);
  });

  test("le plafond par défaut est TROIS", () => {
    // Épinglé littéralement : un test qui suivrait la constante suivrait aussi
    // ses erreurs. Leçon du lot 3.
    expect(TENTATIVES_MAX_DEFAUT).toBe(3);
  });

  test("la fenêtre par défaut est 9 h – 18 h", () => {
    expect(FENETRE_APPEL_DEFAUT.debutHeure).toBe(9);
    expect(FENETRE_APPEL_DEFAUT.finHeure).toBe(18);
  });
});

// ── d. Le répondeur ne dit pas la dette ────────────────────────────────────

describe("d — US-5 : le message de répondeur reste discret", () => {
  test("il nomme l'entreprise et le numéro de rappel", () => {
    const m = messageRepondeur("Charpente Dubois", "01 23 45 67 89");
    expect(m).toContain("Charpente Dubois");
    expect(m).toContain("01 23 45 67 89");
  });

  test("il ne mentionne NI montant NI dette", () => {
    // Un répondeur peut être écouté par un conjoint, un enfant, un collègue.
    const m = messageRepondeur("Dubois", "0123456789");
    expect(messageRepondeurEstDiscret(m)).toBe(true);
  });

  test("la garde de discrétion attrape ce qu'elle doit attraper", () => {
    // Sans cette vérification, la garde pourrait rendre `true` sur tout et le
    // test ci-dessus passerait sans rien prouver.
    expect(messageRepondeurEstDiscret("Vous devez 1 200,00 € sur la facture 42")).toBe(false);
    expect(messageRepondeurEstDiscret("au sujet de votre impayé")).toBe(false);
    expect(messageRepondeurEstDiscret("votre facture est en retard")).toBe(false);
  });
});
