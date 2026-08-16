/**
 * Brief matin — section "overdue" (US-A3.1).
 *
 * Ce que ces tests protègent :
 *   a. `urgent` reflète la sévérité calibrée par secteur
 *      (`estRetardSignificatif`), pas "en retard" tout court ;
 *   b. les factures en retard significatif apparaissent en tête de liste.
 *
 * Le passage de `settled = false` à `conditionFactureEnRetardSql` (statut
 * autoritaire, voir `facturesEnRetard.ts`) n'a pas de comportement observable
 * distinct aujourd'hui — vérifié : chaque chemin d'écriture
 * (`reglement-facture.ts`, la route de mise à jour) pose `settled` et
 * `statut` ensemble, jamais l'un sans l'autre. Le changement reste justifié
 * (une seule définition partagée plutôt qu'une troisième copie divergente à
 * terme) mais n'a pas de test dédié pour cette seule raison.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { toDateString } from "@nodaq/shared";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";
import app from "../app";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

async function inscrire(nom: string): Promise<Locataire> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `brief-${nom}-${suffix}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom} ${suffix}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const setCookie = reg.headers["set-cookie"] as string[] | string | undefined;
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ""]).find(c => c.startsWith("nodaq_sid=")) ?? "";
  const { rows } = await adminPool.query<{ id: string }>(
    "SELECT t.id FROM tenants t JOIN memberships m ON m.tenant_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = $1 LIMIT 1",
    [email],
  );
  const tenantId = rows[0]?.id ?? "";
  cleanupTenantIds.push(tenantId);

  await request(app).post("/api/onboarding/profil/confirmer").set("Cookie", cookie)
    .send({
      siret: "81234567600009", siren: "812345676", raison_sociale: `${nom} SARL`,
      adresse: "9 rue des Artisans", code_postal: "69001", commune: "Lyon",
    })
    .expect(200);

  return { cookie, tenantId };
}

function ilYA(jours: number): string {
  const d = new Date();
  d.setDate(d.getDate() - jours);
  return toDateString(d);
}

async function creerFacture(l: Locataire, dueDate: string): Promise<{ id: string }> {
  const { body } = await request(app).post("/api/factures").set("Cookie", l.cookie)
    .send({
      customerName: "Client Brief", issuedDate: dueDate, dueDate,
      lines: [{ description: "Prestation", quantity: 1, unitPriceCents: 50_000, vatRate: 20, vatCategory: "S" }],
    })
    .expect(201);
  return { id: body.id };
}

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("a, b — sévérité calibrée par secteur, en retard significatif en tête", () => {
  test("bâtiment (délai usuel 30j) : 15 jours de retard → pas urgent ; 45 jours → urgent, en tête", async () => {
    const l = await inscrire("batiment-brief");
    await request(app).patch("/api/votre-metier").set("Cookie", l.cookie).send({ metier: "batiment" }).expect(200);

    const legere = await creerFacture(l, ilYA(15));
    await request(app).post(`/api/factures/${legere.id}/emettre`).set("Cookie", l.cookie)
      .send({ issuedDate: ilYA(15), dueDate: ilYA(15) }).expect(200);

    const grave = await creerFacture(l, ilYA(45));
    await request(app).post(`/api/factures/${grave.id}/emettre`).set("Cookie", l.cookie)
      .send({ issuedDate: ilYA(45), dueDate: ilYA(45) }).expect(200);

    const { body } = await request(app).get("/api/brief").set("Cookie", l.cookie).expect(200);
    const overdue = body.sections.find((s: { type: string }) => s.type === "overdue");
    expect(overdue.items).toHaveLength(2);
    // La facture à 45 jours (significative) est en tête, urgent=true.
    expect(overdue.items[0].urgent).toBe(true);
    expect(overdue.items[1].urgent).toBe(false);
  });
});
