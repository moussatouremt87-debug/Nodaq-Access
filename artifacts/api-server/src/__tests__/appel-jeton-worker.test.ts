/**
 * Le jeton de service du worker vocal — ticket 4.18, lot 6.
 *
 * Ce que ces tests protègent, par ordre d'importance :
 *
 *   a. LE TENANT NE PEUT PAS ÊTRE FORGÉ — c'est la règle 1 du CLAUDE.md, et
 *      c'est la seule raison d'avoir choisi un jeton par appel plutôt qu'un
 *      jeton de service. Un corps qui nomme un tenant est ignoré, parce que
 *      rien ne le lit ;
 *   b. LA PORTÉE EST L'APPEL — le jeton d'un appel n'ouvre pas celui d'un
 *      autre tenant, ni une autre route du produit ;
 *   c. LA RÉVOCATION EST AUTOMATIQUE — un appel clos ferme son jeton, sans
 *      liste noire à tenir ;
 *   d. le jeton en clair n'est PAS en base.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

interface Locataire {
  cookie: string;
  tenantId: string;
  campagneId: string;
}

const tenantIds: string[] = [];
const emails: string[] = [];
let a: Locataire;
let b: Locataire;

const REGLE_OUVERTE = {
  echelonnementAutorise: true,
  maxVersements: 4,
  delaiMaxPremierVersementJours: 15,
  retardMaxJours: 45,
  lienPaiementAutorise: true,
  remiseAutorisee: false,
};

async function inscrire(nom: string): Promise<Locataire> {
  const email = `jeton-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"][0];
  const tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);

  await request(serveurTest(app)).put("/api/relance/regles").set("Cookie", cookie).send(REGLE_OUVERTE).expect(200);
  await request(serveurTest(app))
    .patch("/api/parametres")
    .set("Cookie", cookie)
    .send({ "company.raison_sociale": `Charpente ${nom}` })
    .expect(200);

  const { body } = await request(serveurTest(app))
    .post("/api/relance/campagnes")
    .set("Cookie", cookie)
    .send({
      appels: [
        {
          clientId: null,
          factureId: "F-001",
          montantCents: 120000,
          numero: "+33600000001",
          clientNom: "Martin",
        },
      ],
    })
    .expect(201);

  // VALIDÉE, comme en production : c'est l'approbation qui FIGE le mandat et la
  // version de règle (US-9). Sur une campagne seulement proposée, la passerelle
  // retombe — à juste titre — sur le défaut prudent, et n'accorderait rien.
  await request(serveurTest(app))
    .post(`/api/pending-actions/${body.pendingActionId}/approve`)
    .set("Cookie", cookie)
    .expect(200);

  return { cookie, tenantId, campagneId: body.campagne.id };
}

/**
 * Planifie un appel et rend son jeton en clair.
 *
 * Écrit par le même chemin que la production (`planifierAppel`), via SQL admin
 * pour rester indépendant d'un ordonnanceur qui n'existe pas encore : ce qui
 * est éprouvé ici, c'est l'AUTHENTIFICATION, pas la planification.
 */
async function appelPlanifie(l: Locataire): Promise<{ appelId: string; jeton: string }> {
  const jeton = crypto.randomBytes(32).toString("base64url");
  const sha = crypto.createHash("sha256").update(jeton).digest("hex");
  const appelId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO appels_relance (id, tenant_id, campagne_id, empreinte_numero, statut, jeton_sha256)
     VALUES ($1, $2::uuid, $3, $4, 'PLANIFIE', $5)`,
    [appelId, l.tenantId, l.campagneId, `emp-${appelId}`, sha],
  );
  return { appelId, jeton };
}

const avecJeton = (jeton: string) => (chemin: string) =>
  request(serveurTest(app)).get(chemin).set("Authorization", `Bearer ${jeton}`);

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
}, 120_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. Le tenant ne peut pas être forgé ────────────────────────────────────

describe("a — le tenant vient du jeton, jamais du client", () => {
  test("le jeton suffit : aucun tenant n'est transmis", async () => {
    const { jeton } = await appelPlanifie(a);
    const r = await avecJeton(jeton)("/api/relance/appel/ouverture").expect(200);
    // L'annonce nomme le tenant du jeton, qu'aucune requête n'a nommé.
    expect(r.body.annonce).toContain("Charpente a");
  });

  test("un tenantId forgé dans le CORPS ne change rien", async () => {
    // La garde est structurelle : rien ne lit un tenant dans le corps, donc il
    // n'y a rien à contourner. Ce test le prouve plutôt que de le supposer.
    const { jeton } = await appelPlanifie(a);
    const r = await request(serveurTest(app))
      .post("/api/relance/appel/echelonnement")
      .set("Authorization", `Bearer ${jeton}`)
      .send({
        tenantId: b.tenantId,
        campagneId: b.campagneId,
        versements: 3,
        premierVersementDansJours: 10,
        dernierVersementRetardJours: 25,
      })
      .expect(200);
    expect(r.body.accorde).toBe(true);
  });

  test("sans jeton : 401", async () => {
    await request(serveurTest(app)).get("/api/relance/appel/ouverture").expect(401);
  });

  test("un jeton inconnu : 401, avec la MÊME réponse qu'un jeton expiré", async () => {
    const inconnu = await request(serveurTest(app))
      .get("/api/relance/appel/ouverture")
      .set("Authorization", `Bearer ${crypto.randomBytes(32).toString("base64url")}`)
      .expect(401);

    const { appelId, jeton } = await appelPlanifie(a);
    await adminPool.query(`UPDATE appels_relance SET statut = 'TERMINE' WHERE id = $1`, [appelId]);
    const expire = await avecJeton(jeton)("/api/relance/appel/ouverture").expect(401);

    // Distinguer les deux confirmerait à un curieux qu'un jeton a existé.
    expect(inconnu.body).toEqual(expire.body);
  });

  test("un en-tête mal formé ne passe pas", async () => {
    const { jeton } = await appelPlanifie(a);
    for (const entete of [jeton, `Basic ${jeton}`, "Bearer", "Bearer "]) {
      await request(serveurTest(app))
        .get("/api/relance/appel/ouverture")
        .set("Authorization", entete)
        .expect(401);
    }
  });
});

// ── b. La portée est l'appel ───────────────────────────────────────────────

describe("b — un jeton n'ouvre qu'une conversation", () => {
  test("le jeton de A ne lit pas la campagne de B", async () => {
    const { jeton } = await appelPlanifie(a);
    const r = await avecJeton(jeton)("/api/relance/appel/ouverture").expect(200);
    expect(r.body.annonce).toContain("Charpente a");
    expect(r.body.annonce).not.toContain("Charpente b");
  });

  test("le jeton n'ouvre AUCUNE autre route du produit", async () => {
    // Un jeton d'appel n'est pas une session : il ne doit rien ouvrir d'autre
    // que les routes du worker. Sans cette assertion, un jeton fuité donnerait
    // accès au portefeuille du tenant.
    const { jeton } = await appelPlanifie(a);
    for (const chemin of ["/api/factures", "/api/clients", "/api/cockpit", "/api/relance/regles"]) {
      const r = await avecJeton(jeton)(chemin);
      expect([401, 403, 404], `${chemin} → ${r.status}`).toContain(r.status);
    }
  });

  test("une session humaine n'ouvre PAS les routes du worker", async () => {
    // La réciproque : ces routes ne sont exposées à aucune interface.
    await request(serveurTest(app))
      .get("/api/relance/appel/ouverture")
      .set("Cookie", a.cookie)
      .expect(401);
  });
});

// ── c. La révocation est automatique ───────────────────────────────────────

describe("c — le jeton meurt avec l'appel", () => {
  test("un appel TERMINE ferme son jeton", async () => {
    const { appelId, jeton } = await appelPlanifie(a);
    await avecJeton(jeton)("/api/relance/appel/ouverture").expect(200);

    await adminPool.query(`UPDATE appels_relance SET statut = 'TERMINE' WHERE id = $1`, [appelId]);
    await avecJeton(jeton)("/api/relance/appel/ouverture").expect(401);
  });

  test("EN_COURS reste ouvert — c'est l'état pendant lequel on parle", async () => {
    const { appelId, jeton } = await appelPlanifie(a);
    await adminPool.query(`UPDATE appels_relance SET statut = 'EN_COURS' WHERE id = $1`, [appelId]);
    await avecJeton(jeton)("/api/relance/appel/ouverture").expect(200);
  });

  test("une ligne effacée (art. 17) ferme son jeton", async () => {
    const { appelId, jeton } = await appelPlanifie(a);
    await adminPool.query(`DELETE FROM appels_relance WHERE id = $1`, [appelId]);
    await avecJeton(jeton)("/api/relance/appel/ouverture").expect(401);
  });
});

// ── d. Le jeton n'est pas en base ──────────────────────────────────────────

describe("d — seul le condensat est conservé", () => {
  test("le jeton en clair est introuvable dans la table", async () => {
    const { jeton } = await appelPlanifie(a);
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM appels_relance WHERE jeton_sha256 = $1`,
      [jeton],
    );
    expect(rows[0].n).toBe(0);
  });
});

// ── e. Ce que la passerelle répond ─────────────────────────────────────────

describe("e — le noyau décide, la route transmet", () => {
  test("l'insistance s'arrête à deux, et le plafond est dit", async () => {
    const { jeton } = await appelPlanifie(a);
    const zero = await avecJeton(jeton)("/api/relance/appel/insistance?faites=0").expect(200);
    const deux = await avecJeton(jeton)("/api/relance/appel/insistance?faites=2").expect(200);

    expect(zero.body).toEqual({ autorise: true, plafond: 2 });
    expect(deux.body.autorise).toBe(false);
  });

  test("un échelonnement hors mandat est refusé SANS dire pourquoi", async () => {
    // Le motif décrit une configuration interne. Le worker le transmettrait au
    // modèle, qui pourrait le prononcer — « mon patron a désactivé ça pour
    // votre campagne » expose un réglage et invite à une discussion que
    // l'agent n'a pas le droit d'avoir.
    const { jeton } = await appelPlanifie(a);
    const r = await request(serveurTest(app))
      .post("/api/relance/appel/echelonnement")
      .set("Authorization", `Bearer ${jeton}`)
      .send({ versements: 40, premierVersementDansJours: 300, dernierVersementRetardJours: 900 })
      .expect(200);

    expect(r.body.accorde).toBe(false);
    expect(Object.keys(r.body)).toEqual(["accorde"]);
    expect(JSON.stringify(r.body)).not.toMatch(/campagne|règle|mandat|motif/i);
  });

  test("sans raison sociale, l'agent refuse de s'annoncer", async () => {
    // Se présenter comme « l'assistant automatique de Entreprise » sonne comme
    // une arnaque — l'effet exact que l'annonce doit éviter. On préfère ne pas
    // composer.
    const c = await inscrire("c");
    await adminPool.query(
      `DELETE FROM settings WHERE tenant_id = $1::uuid AND key = 'company.raison_sociale'`,
      [c.tenantId],
    );
    const { jeton } = await appelPlanifie(c);
    const r = await avecJeton(jeton)("/api/relance/appel/ouverture").expect(409);
    expect(r.body.error).toMatch(/raison sociale/i);
  });
});
