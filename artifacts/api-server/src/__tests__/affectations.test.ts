/**
 * Affectations — rattachement à une affaire OU à un client (US-A4.1).
 *
 * Ce que ces tests protègent :
 *   a. le rattachement affaire existant continue de fonctionner tel quel ;
 *   b. un client peut être affecté directement, sans affaire fictive ;
 *   c. les deux à la fois, ou aucun des deux, sont REFUSÉS — à la création
 *      comme à la modification (état FUSIONNÉ patch+existant) ;
 *   d. un PATCH peut BASCULER le rattachement (affaire → client et inverse).
 *
 * L'isolation multi-tenant est couverte par rls.test.ts.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

let cookie: string;
let tenantId: string;
let membreId: string;
let affaireId: string;
let clientId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

beforeAll(async () => {
  const email = `affectations-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Chef", tenantNom: "Services Test" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";

  const { body: me } = await request(serveurTest(app)).get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);

  const { rows: membreRows } = await adminPool.query<{ id: string }>(
    `INSERT INTO team_members (id, name, tenant_id) VALUES (gen_random_uuid()::text, 'Membre Test', $1) RETURNING id`,
    [tenantId],
  );
  membreId = membreRows[0]!.id;

  const { rows: affaireRows } = await adminPool.query<{ id: string }>(
    `INSERT INTO affaires (id, label, tenant_id, status) VALUES (gen_random_uuid()::text, 'Affaire Test', $1, 'EN_COURS') RETURNING id`,
    [tenantId],
  );
  affaireId = affaireRows[0]!.id;

  const { rows: clientRows } = await adminPool.query<{ id: string }>(
    `INSERT INTO clients (id, tenant_id, nom) VALUES (gen_random_uuid()::text, $1, 'Client Test') RETURNING id`,
    [tenantId],
  );
  clientId = clientRows[0]!.id;
}, 60_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// Fonction, pas objet littéral : `membreId` n'est assigné que dans
// `beforeAll` (asynchrone) — un littéral au chargement du module le
// capturerait avant assignation.
const corpsBase = () => ({ membreId, dateDebut: "2020-01-06", dateFin: "2020-01-10", heuresParJour: 7 });

describe("a — rattachement AFFAIRE (comportement existant)", () => {
  test("une affectation avec affaireId seul est créée normalement", async () => {
    const res = await request(serveurTest(app))
      .post("/api/affectations")
      .set("Cookie", cookie)
      .send({ ...corpsBase(), affaireId });
    expect(res.status).toBe(201);
    expect(res.body.affaireId).toBe(affaireId);
    expect(res.body.clientId).toBeNull();
  });
});

describe("b — rattachement CLIENT direct (US-A4.1)", () => {
  test("une affectation avec clientId seul est créée sans affaire", async () => {
    const res = await request(serveurTest(app))
      .post("/api/affectations")
      .set("Cookie", cookie)
      .send({ ...corpsBase(), clientId });
    expect(res.status).toBe(201);
    expect(res.body.clientId).toBe(clientId);
    expect(res.body.affaireId).toBeNull();
  });

  test("GET /affectations?clientId= filtre sur le rattachement client", async () => {
    const { body } = await request(serveurTest(app))
      .get(`/api/affectations?clientId=${clientId}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(body.affectations.length).toBeGreaterThan(0);
    for (const a of body.affectations) expect(a.clientId).toBe(clientId);
  });
});

describe("c — rattachement invalide REFUSÉ", () => {
  test("affaire ET client à la fois → REFUSÉ à la création", async () => {
    const res = await request(serveurTest(app))
      .post("/api/affectations")
      .set("Cookie", cookie)
      .send({ ...corpsBase(), affaireId, clientId });
    expect(res.status).toBe(400);
  });

  test("ni affaire ni client → REFUSÉ à la création", async () => {
    const res = await request(serveurTest(app)).post("/api/affectations").set("Cookie", cookie).send(corpsBase());
    expect(res.status).toBe(400);
  });

  test("PATCH qui ferait porter les deux rattachements à la fois → REFUSÉ", async () => {
    const cree = await request(serveurTest(app))
      .post("/api/affectations")
      .set("Cookie", cookie)
      .send({ ...corpsBase(), affaireId })
      .expect(201);

    // N'envoie QUE clientId : affaireId n'est pas touché par le corps du
    // patch, donc reste celui déjà enregistré — l'état FUSIONNÉ porterait
    // alors les deux. C'est exactement ce que la route doit refuser.
    const res = await request(serveurTest(app))
      .patch(`/api/affectations/${cree.body.id}`)
      .set("Cookie", cookie)
      .send({ clientId });
    expect(res.status).toBe(400);
  });
});

describe("d — PATCH bascule le rattachement", () => {
  test("affaire → client : envoyer clientId ET affaireId:null bascule proprement", async () => {
    const cree = await request(serveurTest(app))
      .post("/api/affectations")
      .set("Cookie", cookie)
      .send({ ...corpsBase(), affaireId })
      .expect(201);

    const res = await request(serveurTest(app))
      .patch(`/api/affectations/${cree.body.id}`)
      .set("Cookie", cookie)
      .send({ affaireId: null, clientId });
    expect(res.status).toBe(200);
    expect(res.body.affaireId).toBeNull();
    expect(res.body.clientId).toBe(clientId);
  });

  test("client → affaire : envoyer affaireId ET clientId:null bascule proprement", async () => {
    const cree = await request(serveurTest(app))
      .post("/api/affectations")
      .set("Cookie", cookie)
      .send({ ...corpsBase(), clientId })
      .expect(201);

    const res = await request(serveurTest(app))
      .patch(`/api/affectations/${cree.body.id}`)
      .set("Cookie", cookie)
      .send({ clientId: null, affaireId });
    expect(res.status).toBe(200);
    expect(res.body.clientId).toBeNull();
    expect(res.body.affaireId).toBe(affaireId);
  });
});
