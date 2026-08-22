/**
 * La bannière de conformité — ticket 4.36, lot B.
 *
 * Deux échéances qu'on confond souvent : RECEVOIR au 1er septembre 2026,
 * ÉMETTRE au 1er septembre 2027 pour les petites entreprises. Les mélanger
 * ferait paniquer un artisan un an trop tôt, ou le rassurerait à tort.
 */
import { describe, test, expect } from "vitest";
import {
  messageConformite, doitReapparaitre, ETAPES_COMMENT_CA_MARCHE,
  ECHEANCE_RECEPTION,
} from "../src/conformiteFacturation.js";

const PAS_RACCORDE = { raccordementConfirme: false, inscritListeAttenteLe: null };

describe("a — avant l'échéance de réception", () => {
  test("le compte à rebours est factuel, jamais comminatoire", () => {
    const m = messageConformite(PAS_RACCORDE, "2026-08-22");
    expect(m.etat).toBe("RECEPTION_A_FAIRE");
    expect(m.corps).toContain("10 jour(s)");
    // « On s'en occupe avec vous », jamais « vous risquez une amende » : un
    // artisan qui reçoit une menace de son logiciel ferme le logiciel.
    expect(m.corps).toContain("On s'en occupe avec vous");
    expect(m.corps.toLowerCase()).not.toMatch(/amende|sanction|risqu|pénalit/);
  });

  test("l'échéance n'est pas encore dépassée", () => {
    expect(messageConformite(PAS_RACCORDE, "2026-08-22").echeanceDepassee).toBe(false);
    expect(messageConformite(PAS_RACCORDE, ECHEANCE_RECEPTION).echeanceDepassee).toBe(false);
  });
});

describe("b — après l'échéance, le ton ne change pas", () => {
  const m = messageConformite(PAS_RACCORDE, "2026-10-15");

  test("l'état est signalé comme dépassé", () => {
    expect(m.echeanceDepassee).toBe(true);
  });

  test("mais on n'en fait pas un reproche", () => {
    // Un artisan en retard n'a pas besoin qu'on le lui reproche, il a besoin
    // qu'on l'aide à rattraper.
    expect(m.corps.toLowerCase()).not.toMatch(/amende|sanction|retard|aurait dû/);
    expect(m.corps).toContain("on s'en occupe avec vous");
  });
});

describe("c — « prêt » ne se dit QUE si c'est confirmé", () => {
  test("raccordement confirmé → plus rien à faire", () => {
    const m = messageConformite(
      { raccordementConfirme: true, inscritListeAttenteLe: null }, "2026-08-22",
    );
    expect(m.etat).toBe("PRET");
    expect(m.action).toBeNull();
    // L'échéance d'émission est annoncée SANS urgence : elle est dans un an.
    expect(m.corps).toContain("1er septembre 2027");
    expect(m.corps).toContain("rien à faire d'ici là");
  });

  test("une simple inscription en attente ne vaut PAS « prêt »", () => {
    // Le ticket l'interdit : ne jamais afficher « vous êtes prêt » à un tenant
    // dont le rattachement n'est pas confirmé. Ce serait la pire des issues —
    // il cesserait de s'en occuper.
    const m = messageConformite(
      { raccordementConfirme: false, inscritListeAttenteLe: "2026-08-22" }, "2026-08-25",
    );
    expect(m.etat).toBe("EN_ATTENTE");
    expect(m.titre).not.toContain("prêt");
  });
});

describe("d — la liste d'attente promet, et tient", () => {
  test("elle dit que l'utilisateur n'a rien à surveiller", () => {
    const m = messageConformite(
      { raccordementConfirme: false, inscritListeAttenteLe: "2026-08-22" }, "2026-08-25",
    );
    expect(m.corps).toContain("rien à surveiller");
    expect(m.action).toBeNull();
  });
});

describe("e — une bannière fermée revient, mais pas tous les jours", () => {
  test("jamais fermée → toujours visible", () => {
    expect(doitReapparaitre(null, "RECEPTION_A_FAIRE", "2026-01-01")).toBe(true);
  });

  test("fermée loin de l'échéance → elle se tait", () => {
    // Une bannière qui revient tous les jours se ferme par réflexe et cesse
    // d'être lue.
    expect(doitReapparaitre("2026-01-05", "RECEPTION_A_FAIRE", "2026-01-10")).toBe(false);
  });

  test("fermée mais l'échéance approche → elle revient", () => {
    expect(doitReapparaitre("2026-07-01", "RECEPTION_A_FAIRE", "2026-08-22")).toBe(true);
  });

  test("une fois PRÊT, elle ne revient plus jamais", () => {
    expect(doitReapparaitre("2026-01-05", "PRET", "2026-08-30")).toBe(false);
  });

  test("inscrit sur la liste d'attente, on ne le harcèle pas non plus", () => {
    expect(doitReapparaitre("2026-08-22", "EN_ATTENTE", "2026-08-30")).toBe(false);
  });
});

describe("f — « comment ça marche » sans aucun sigle", () => {
  const texte = ETAPES_COMMENT_CA_MARCHE.map((e) => `${e.titre} ${e.texte}`).join(" ");

  test("trois étapes, pas davantage", () => {
    expect(ETAPES_COMMENT_CA_MARCHE).toHaveLength(3);
  });

  test.each(["PDP", "PPF", "e-reporting", "Factur-X", "annuaire"])(
    "« %s » n'apparaît pas", (sigle) => {
      // Ces mots ne disent rien à quelqu'un qui pose des ardoises. On dit ce
      // que la chose FAIT, pas comment l'administration la nomme.
      expect(texte).not.toMatch(new RegExp(sigle, "i"));
    },
  );

  test("le bénéfice est dit avant la démarche", () => {
    // La première étape parle de ce que l'utilisateur y gagne, la dernière
    // seulement de ce qu'il doit faire.
    expect(ETAPES_COMMENT_CA_MARCHE[0]!.titre).toContain("arrivent toutes seules");
    expect(ETAPES_COMMENT_CA_MARCHE[2]!.titre).toContain("une fois");
  });
});
