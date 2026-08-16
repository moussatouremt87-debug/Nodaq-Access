/**
 * Équipe — planning hebdomadaire type (`schedule`), rattachement d'un
 * créneau à une affaire OU à un client (US-A4.1).
 *
 * `schedule` est un JSON texte libre (`team_members.schedule`) : aucune
 * contrainte CHECK du moteur ne le protège, contrairement à
 * `pointages`/`affectations` (migration 032). L'exclusivité repose donc
 * ENTIÈREMENT sur la validation Zod de la route — ce que ces tests
 * protègent.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

let cookie: string;
let tenantId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

beforeAll(async () => {
  const email = `equipe-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Chef", tenantNom: "Services Test" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";

  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);
}, 60_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("US-A4.1 — rattachement d'un créneau de la semaine type", () => {
  test("un créneau avec clientId seul est créé et relu tel quel", async () => {
    const res = await request(app)
      .post("/api/equipe")
      .set("Cookie", cookie)
      .send({
        name: "Membre Planning",
        schedule: [{ day: "LUN", affaireId: null, clientId: "client-fictif-1" }],
      });
    expect(res.status).toBe(201);
    expect(res.body.schedule[0]).toMatchObject({ day: "LUN", affaireId: null, clientId: "client-fictif-1" });

    const { body: liste } = await request(app).get("/api/equipe").set("Cookie", cookie).expect(200);
    const relu = liste.find((m: { id: string }) => m.id === res.body.id);
    expect(relu.schedule[0]).toMatchObject({ day: "LUN", clientId: "client-fictif-1" });
  });

  test("un créneau avec affaireId ET clientId à la fois est REFUSÉ", async () => {
    const res = await request(app)
      .post("/api/equipe")
      .set("Cookie", cookie)
      .send({
        name: "Membre Invalide",
        schedule: [{ day: "LUN", affaireId: "affaire-fictive-1", clientId: "client-fictif-1" }],
      });
    expect(res.status).toBe(400);
  });

  test("un PATCH peut faire basculer un créneau d'affaire vers client", async () => {
    const cree = await request(app)
      .post("/api/equipe")
      .set("Cookie", cookie)
      .send({
        name: "Membre Bascule",
        schedule: [{ day: "MAR", affaireId: "affaire-fictive-2", clientId: null }],
      })
      .expect(201);

    const patch = await request(app)
      .patch(`/api/equipe/${cree.body.id}`)
      .set("Cookie", cookie)
      .send({ schedule: [{ day: "MAR", affaireId: null, clientId: "client-fictif-2" }] });
    expect(patch.status).toBe(200);
    expect(patch.body.schedule[0]).toMatchObject({ day: "MAR", affaireId: null, clientId: "client-fictif-2" });
  });
});
