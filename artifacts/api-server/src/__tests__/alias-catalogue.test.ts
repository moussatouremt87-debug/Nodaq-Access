/**
 * Alias appris du catalogue — la PR B du lot 2.
 *
 * Ce que ces tests protègent :
 *   a. l'alias sert VRAIMENT : une dictée que rien ne rapprochait trouve son
 *      prix au second passage ;
 *   b. on n'apprend QUE d'une désignation humaine, jamais d'un rapprochement
 *      automatique ;
 *   c. un alias ne peut pas RECOUVRIR le libellé exact d'une autre ligne —
 *      c'est le refus qui compte, parce que le détournement serait invisible ;
 *   d. un remplacement n'est jamais implicite ;
 *   e. un alias s'oublie ;
 *   f. isolation : l'alias d'un tenant n'apprend rien à un autre ;
 *   g. la suppression d'une ligne emporte ses alias.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `alias-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

async function ligneCatalogue(
  l: Locataire,
  libelle: string,
  prixCents = 4_500,
  motsCles: string[] = [],
): Promise<string> {
  const { body } = await request(app).post("/api/catalogue").set("Cookie", l.cookie)
    .send({ libelle, unite: "m2", prixUnitaireHtCents: prixCents, tauxTva: 10, motsCles })
    .expect(201);
  return body.id;
}

const apprendre = (l: Locataire, libelleDicte: string, ligneId: string, remplacer = false) =>
  request(app).post("/api/catalogue/alias").set("Cookie", l.cookie)
    .send({ libelleDicte, catalogueLigneId: ligneId, remplacer });

/** Passe une dictée et rend la ligne proposée. */
async function dicter(l: Locataire, texte: string) {
  const { body } = await request(app).post("/api/devis/dictee/proposer")
    .set("Cookie", l.cookie).send({ texte }).expect(200);
  return body.lignes[0];
}

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a. L'alias sert vraiment ────────────────────────────────────────────────

describe("a — ce que l'artisan corrige une fois, il ne le corrige plus", () => {
  test("une dictée sans correspondance trouve son prix APRÈS apprentissage", async () => {
    const t = await inscrire("bout-en-bout");
    // Le simulateur de vitest.setup rend « Cloison BA13 » et « Pose d'une
    // veranda en aluminium » pour toute dictée contenant « cloison ».
    const ligne = await ligneCatalogue(t, "Cloison placo BA13 hydrofuge", 5_500);

    // Avant : le libellé dicté ne correspond à rien.
    const avant = await dicter(t, "cloison trente mètres carrés");
    expect(avant.provenance).toBe("a_completer");
    expect(avant.prixUnitaireHtCents).toBeNull();

    // L'artisan désigne lui-même la ligne.
    await apprendre(t, "Cloison BA13", ligne).expect(201);

    // Après : le prix vient du catalogue, et la provenance le DIT.
    const apres = await dicter(t, "cloison trente mètres carrés");
    expect(apres.provenance).toBe("alias");
    expect(apres.prixUnitaireHtCents).toBe(5_500);
    expect(apres.catalogueLigneId).toBe(ligne);
  });

  test("la provenance « alias » est distincte de « catalogue »", async () => {
    // L'utilisateur doit pouvoir voir d'où vient le prix : d'un libellé qui
    // correspond, ou d'une correction qu'il a faite lui-même.
    const t = await inscrire("provenance");
    const ligne = await ligneCatalogue(t, "Cloison BA13");
    const direct = await dicter(t, "cloison BA13");
    expect(direct.provenance).toBe("catalogue");

    await apprendre(t, "du placo", ligne).expect(201);
    const { body } = await request(app).get("/api/catalogue/alias")
      .set("Cookie", t.cookie).expect(200);
    expect(body.alias[0].libelleDicte).toBe("du placo");
    expect(body.alias[0].libelleCatalogue).toBe("Cloison BA13");
  });
});

// ── b & c. Ce qu'on refuse d'apprendre ──────────────────────────────────────

describe("c — un alias ne RECOUVRE jamais le libellé d'une autre ligne", () => {
  test("apprendre « Peinture » vers la cloison est REFUSÉ si « Peinture » existe", async () => {
    // C'est le refus qui compte le plus. L'alias passe AVANT le libellé dans
    // l'ordre de rapprochement : l'accepter détournerait silencieusement
    // toutes les futures dictées de « Peinture » vers la cloison, sans que
    // l'artisan voie quoi que ce soit.
    const t = await inscrire("recouvrement");
    const cloison = await ligneCatalogue(t, "Cloison BA13", 4_500);
    await ligneCatalogue(t, "Peinture deux couches", 2_000);

    const r = await apprendre(t, "Peinture deux couches", cloison).expect(409);
    expect(r.body.motif).toBe("deja_un_libelle");
    expect(r.body.error).toMatch(/détournerait/i);

    // Et rien n'a été appris.
    const { body } = await request(app).get("/api/catalogue/alias")
      .set("Cookie", t.cookie).expect(200);
    expect(body.total).toBe(0);
  });

  test("apprendre son PROPRE libellé est accepté — ça ne détourne personne", async () => {
    const t = await inscrire("propre-libelle");
    const ligne = await ligneCatalogue(t, "Cloison BA13");
    await apprendre(t, "Cloison BA13", ligne).expect(201);
  });

  test("une ligne de catalogue inexistante → 404", async () => {
    await apprendre(a, "peu importe", crypto.randomUUID()).expect(404);
  });

  test("un libellé vide n'apprend rien", async () => {
    const ligne = await ligneCatalogue(a, `Vide ${crypto.randomBytes(3).toString("hex")}`);
    await apprendre(a, "   ", ligne).expect(400);
  });
});

describe("d — un remplacement n'est jamais implicite", () => {
  test("réapprendre vers une AUTRE ligne est refusé sans confirmation", async () => {
    const t = await inscrire("remplacement");
    const cloison = await ligneCatalogue(t, "Cloison BA13");
    const peinture = await ligneCatalogue(t, "Peinture deux couches");

    await apprendre(t, "du placo", cloison).expect(201);
    const r = await apprendre(t, "du placo", peinture).expect(409);
    expect(r.body.motif).toBe("deja_appris_ailleurs");
    // Le message NOMME la cible actuelle : sans elle, l'artisan ne peut pas
    // décider si l'apprentissage précédent était une erreur.
    expect(r.body.error).toContain("Cloison BA13");

    // L'apprentissage d'origine est intact.
    const { body } = await request(app).get("/api/catalogue/alias")
      .set("Cookie", t.cookie).expect(200);
    expect(body.alias[0].catalogueLigneId).toBe(cloison);
  });

  test("avec `remplacer`, le changement passe et reste UNIQUE", async () => {
    const t = await inscrire("remplacement-ok");
    const cloison = await ligneCatalogue(t, "Cloison BA13");
    const peinture = await ligneCatalogue(t, "Peinture deux couches");

    await apprendre(t, "du placo", cloison).expect(201);
    const r = await apprendre(t, "du placo", peinture, true).expect(201);
    expect(r.body.remplace).toBe(true);

    const { body } = await request(app).get("/api/catalogue/alias")
      .set("Cookie", t.cookie).expect(200);
    // UNE phrase, UNE ligne : pas deux entrées concurrentes.
    expect(body.total).toBe(1);
    expect(body.alias[0].catalogueLigneId).toBe(peinture);
  });

  test("réapprendre la MÊME chose n'est pas une erreur", async () => {
    // C'est le geste d'un artisan qui doute, pas une faute.
    const t = await inscrire("idempotent");
    const ligne = await ligneCatalogue(t, "Cloison BA13");
    await apprendre(t, "du placo", ligne).expect(201);
    const r = await apprendre(t, "du placo", ligne).expect(201);
    expect(r.body.remplace).toBe(false);

    const { body } = await request(app).get("/api/catalogue/alias")
      .set("Cookie", t.cookie).expect(200);
    expect(body.total).toBe(1);
  });

  test("la normalisation fait son travail : accents et casse ignorés", async () => {
    const t = await inscrire("normalisation");
    const ligne = await ligneCatalogue(t, "Cloison BA13");
    await apprendre(t, "Plâtrerie Générale", ligne).expect(201);
    // La même phrase autrement écrite ne crée PAS un second alias.
    const r = await apprendre(t, "PLATRERIE GENERALE", ligne).expect(201);
    expect(r.body.remplace).toBe(false);

    const { body } = await request(app).get("/api/catalogue/alias")
      .set("Cookie", t.cookie).expect(200);
    expect(body.total).toBe(1);
  });
});

// ── e & g. Défaire ──────────────────────────────────────────────────────────

describe("e — un alias s'oublie", () => {
  test("oublier remet la dictée en « à compléter »", async () => {
    // Une erreur d'apprentissage qu'on ne pourrait pas défaire mettrait un
    // mauvais prix sur tous les devis suivants.
    const t = await inscrire("oubli");
    const ligne = await ligneCatalogue(t, "Cloison placo BA13 hydrofuge", 5_500);
    await apprendre(t, "Cloison BA13", ligne).expect(201);
    expect((await dicter(t, "cloison trente mètres")).provenance).toBe("alias");

    const { body } = await request(app).get("/api/catalogue/alias")
      .set("Cookie", t.cookie).expect(200);
    await request(app).delete(`/api/catalogue/alias/${body.alias[0].id}`)
      .set("Cookie", t.cookie).expect(204);

    expect((await dicter(t, "cloison trente mètres")).provenance).toBe("a_completer");
  });

  test("oublier un alias inconnu → 404", async () => {
    await request(app).delete(`/api/catalogue/alias/${crypto.randomUUID()}`)
      .set("Cookie", a.cookie).expect(404);
  });
});

describe("g — supprimer une ligne de catalogue emporte ses alias", () => {
  test("aucun alias orphelin ne subsiste", async () => {
    // `rapprocher` sait ignorer un alias orphelin, mais le garder ferait
    // croire à l'artisan qu'il a appris quelque chose d'encore utile.
    const t = await inscrire("cascade");
    const ligne = await ligneCatalogue(t, "Cloison BA13");
    await apprendre(t, "du placo", ligne).expect(201);

    await request(app).delete(`/api/catalogue/${ligne}`).set("Cookie", t.cookie);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM catalogue_alias WHERE catalogue_ligne_id = $1`, [ligne]);
    expect(rows[0].n).toBe(0);
  });
});

// ── f. Isolation ────────────────────────────────────────────────────────────

describe("f — l'alias d'un tenant n'apprend rien à un autre", () => {
  test("le tenant B ne voit pas les alias de A et n'en profite pas", async () => {
    const ligneA = await ligneCatalogue(a, `Cloison A ${crypto.randomBytes(3).toString("hex")}`);
    await apprendre(a, "du placo maison", ligneA).expect(201);

    const { body } = await request(app).get("/api/catalogue/alias")
      .set("Cookie", b.cookie).expect(200);
    expect(JSON.stringify(body)).not.toContain("du placo maison");
  });

  test("la policy refuse la lecture depuis un autre tenant", async () => {
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_user");
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [b.tenantId]);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM catalogue_alias WHERE tenant_id = $1::uuid`, [a.tenantId]);
      expect(rows[0].n).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  test("deux tenants peuvent apprendre la MÊME phrase vers des lignes différentes", async () => {
    // L'unicité porte sur (tenant, alias), pas sur l'alias seul : « du placo »
    // ne désigne pas le même ouvrage chez deux artisans.
    const un = await inscrire("meme-phrase-1");
    const deux = await inscrire("meme-phrase-2");
    const l1 = await ligneCatalogue(un, "Cloison BA13");
    const l2 = await ligneCatalogue(deux, "Doublage isolant");
    await apprendre(un, "du placo", l1).expect(201);
    await apprendre(deux, "du placo", l2).expect(201);
  });
});
