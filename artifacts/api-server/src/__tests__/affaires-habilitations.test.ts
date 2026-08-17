/**
 * habilitationsRequises sur une affaire (US-A4.4, AC2) — une liste de types
 * d'habilitation, stockée en JSON texte (même patron que
 * team_members.schedule), jamais un blocage : ce fichier protège seulement
 * la persistance/lecture, l'avertissement à l'affectation vit côté frontend.
 */
import { describe, test, expect, afterAll } from "vitest";
import request from "supertest";
import { cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";
import app from "../app";

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

async function inscrire(): Promise<string> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `affaires-hab-${suffix}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: `Tenant ${suffix}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const setCookie = reg.headers["set-cookie"] as string[] | string | undefined;
  cleanupTenantIds.push(reg.body.tenantId ?? "");
  return (Array.isArray(setCookie) ? setCookie : [setCookie ?? ""]).find(c => c.startsWith("nodaq_sid=")) ?? "";
}

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("habilitationsRequises", () => {
  test("absente à la création → tableau vide, pas null ni une erreur", async () => {
    const cookie = await inscrire();
    const res = await request(app).post("/api/affaires").set("Cookie", cookie)
      .send({ label: "Chantier sans exigence" }).expect(201);
    expect(res.body.habilitationsRequises).toEqual([]);
  });

  test("fournie à la création → persistée et relue telle quelle", async () => {
    const cookie = await inscrire();
    const cree = await request(app).post("/api/affaires").set("Cookie", cookie)
      .send({ label: "Chantier électrique", habilitationsRequises: ["habilitation_electrique"] }).expect(201);
    expect(cree.body.habilitationsRequises).toEqual(["habilitation_electrique"]);

    const { body: relue } = await request(app).get(`/api/affaires/${cree.body.id}`).set("Cookie", cookie).expect(200);
    expect(relue.habilitationsRequises).toEqual(["habilitation_electrique"]);
  });

  test("modifiable par PATCH, y compris pour la vider", async () => {
    const cookie = await inscrire();
    const cree = await request(app).post("/api/affaires").set("Cookie", cookie)
      .send({ label: "Chantier à ajuster", habilitationsRequises: ["caces"] }).expect(201);

    const patch1 = await request(app).patch(`/api/affaires/${cree.body.id}`).set("Cookie", cookie)
      .send({ habilitationsRequises: ["caces", "habilitation_electrique"] }).expect(200);
    expect(patch1.body.habilitationsRequises).toEqual(["caces", "habilitation_electrique"]);

    const patch2 = await request(app).patch(`/api/affaires/${cree.body.id}`).set("Cookie", cookie)
      .send({ habilitationsRequises: [] }).expect(200);
    expect(patch2.body.habilitationsRequises).toEqual([]);
  });
});
