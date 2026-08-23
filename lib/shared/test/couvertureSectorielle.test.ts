/*
 * Ce qui est outillé pour un secteur, et ce qui ne l'est pas — US-A1.4.
 *
 * ── La contradiction que ces tests gardent ────────────────────────────────
 * US-A1.1 promet de ne pas présumer du secteur. L'audit du 23/08 a constaté
 * que la liste d'onboarding n'en proposait que neuf, sans porte de sortie :
 * un métier absent forçait à en choisir un autre, ou à passer l'écran — et le
 * défaut serveur rangeait alors le tenant en `industrie_btp`.
 *
 * Le rebond que A1.1 corrige revenait donc un écran plus loin. Ces tests
 * tiennent les deux bouts : la porte de sortie existe, et ce qu'on annonce
 * est vrai.
 */
import { describe, test, expect } from "vitest";
import {
  couvertureSecteur, secteurOutille, SECTEURS_AVEC_MODULE,
  FONCTIONS_GENERIQUES, FONCTIONS_SECTORIELLES,
  LIBELLE_SECTEUR_AUTRE, INVITE_SECTEUR_LIBRE,
} from "../src/couvertureSectorielle.js";
import { VERTICAL_PACKS } from "../src/verticalPacks.js";

describe("la liste des secteurs outillés est COURTE et vraie", () => {
  test("seul le bâtiment a un module dédié aujourd'hui", () => {
    // Y inscrire un secteur dont le module n'existe pas serait exactement la
    // promesse implicite que cette story combat. Le test le tient.
    expect([...SECTEURS_AVEC_MODULE].sort()).toEqual(["batiment", "industrie_btp"]);
  });

  test("tout secteur déclaré outillé porte VRAIMENT des fonctions propres", () => {
    // Sans cette garde, on pourrait déclarer un secteur « outillé » sans rien
    // lui associer : le message dirait « votre métier a son module dédié » et
    // la liste serait vide.
    for (const v of SECTEURS_AVEC_MODULE) {
      expect(FONCTIONS_SECTORIELLES[v]?.length ?? 0, v).toBeGreaterThan(0);
    }
  });

  test("aucun secteur non déclaré ne porte de fonctions sectorielles", () => {
    // L'inverse : des fonctions listées pour un secteur absent de
    // `SECTEURS_AVEC_MODULE` ne seraient jamais montrées — du texte mort qui
    // laisserait croire à une couverture.
    for (const v of Object.keys(FONCTIONS_SECTORIELLES)) {
      expect(SECTEURS_AVEC_MODULE, v).toContain(v);
    }
  });
});

describe("ce qu'on annonce à un secteur non outillé", () => {
  test("le message dit ce qui marche ET ce qui n'existe pas", () => {
    const c = couvertureSecteur("retail");
    expect(c.outille).toBe(false);
    // Les deux moitiés comptent. Ne dire que ce qui manque décourage ; ne
    // dire que ce qui marche est la promesse implicite qu'on veut éviter.
    expect(c.message).toMatch(/fonctionne dès maintenant/);
    expect(c.message).toMatch(/ne connaît pas encore/);
    // Et surtout : rien n'est bloqué. C'est le critère d'acceptation 2.
    expect(c.message).toMatch(/[Rr]ien n'est bloqué/);
  });

  test("le tronc commun est TOUJOURS annoncé, même sans module", () => {
    expect(couvertureSecteur("transport").generiques).toEqual(FONCTIONS_GENERIQUES);
    expect(couvertureSecteur(null).generiques.length).toBeGreaterThan(0);
  });

  test("aucune fonction sectorielle n'est annoncée à un secteur qui n'en a pas", () => {
    for (const v of ["retail", "transport", "sante_liberale", "autre"] as const) {
      expect(couvertureSecteur(v).sectorielles, v).toEqual([]);
    }
  });

  test("le métier dit par l'utilisateur est repris dans la phrase", () => {
    // « votre secteur » est une formule d'administration. Le nom qu'il a
    // écrit lui-même, non.
    expect(couvertureSecteur("autre", "fleuriste").message).toContain("pour fleuriste");
    // Sur un nom vide, l'incise disparaît PROPREMENT : pas de « pour  » ni de
    // double espace. L'assertion vise l'incise, pas la sous-chaîne « pour » —
    // la phrase contient « Rien n'est bloqué pour autant », qui est légitime.
    const sansNom = couvertureSecteur("autre", "  ").message;
    expect(sansNom).toContain("fonctionne dès maintenant :");
    expect(sansNom).not.toMatch(/dès maintenant pour/);
    expect(sansNom).not.toMatch(/ {2}/);
  });

  test("le message ne promet AUCUNE date", () => {
    // « seront ajoutées prochainement » est un engagement qu'on ne peut pas
    // tenir sur commande, et qu'on relira dans six mois.
    for (const v of ["retail", "transport", "autre"] as const) {
      const m = couvertureSecteur(v).message;
      expect(m, v).not.toMatch(/prochainement|bientôt|d'ici|semaine|mois|trimestre/i);
    }
  });
});

describe("ce qu'on annonce à un secteur outillé", () => {
  test("le bâtiment voit ses fonctions propres, nommées", () => {
    const c = couvertureSecteur("batiment");
    expect(c.outille).toBe(true);
    expect(c.sectorielles).toContain("Retenue de garantie sur marché");
    expect(c.message).toMatch(/module dédié/);
  });

  test("il voit AUSSI le tronc commun", () => {
    // Un artisan du bâtiment ne doit pas croire que la trésorerie est une
    // spécificité de son métier.
    expect(couvertureSecteur("batiment").generiques).toEqual(FONCTIONS_GENERIQUES);
  });
});

describe("la porte de sortie existe", () => {
  test("le vertical « autre » est un pack réel, pas une valeur fantôme", () => {
    // Sans lui, choisir « mon métier n'est pas dans la liste » écrirait un
    // vertical inconnu, et `verticalPack()` retomberait sur le défaut.
    expect(VERTICAL_PACKS["autre"]).toBeDefined();
    expect(secteurOutille("autre")).toBe(false);
  });

  test("les libellés destinés à l'écran sont des phrases, pas des étiquettes", () => {
    // « Autre » ne dit rien à personne. La phrase, si.
    expect(LIBELLE_SECTEUR_AUTRE.length).toBeGreaterThan(20);
    expect(INVITE_SECTEUR_LIBRE).toMatch(/prochain module/);
  });
});
