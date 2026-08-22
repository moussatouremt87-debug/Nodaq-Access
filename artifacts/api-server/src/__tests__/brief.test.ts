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
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";
import app from "../app";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

async function inscrire(nom: string): Promise<Locataire> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `brief-${nom}-${suffix}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app)).post("/api/auth/register")
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

  await request(serveurTest(app)).post("/api/onboarding/profil/confirmer").set("Cookie", cookie)
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
  const { body } = await request(serveurTest(app)).post("/api/factures").set("Cookie", l.cookie)
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

function dansNJours(jours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  return toDateString(d);
}

describe("c — habilitations à surveiller (US-A4.4)", () => {
  test("une habilitation expirée est urgente, une bientôt expirée non, une valide n'apparaît pas", async () => {
    const l = await inscrire("habilitations-brief");

    const { body: membre } = await request(serveurTest(app)).post("/api/equipe").set("Cookie", l.cookie)
      .send({ name: "Salarié Brief" }).expect(201);

    await request(serveurTest(app)).post(`/api/equipe/${membre.id}/habilitations`).set("Cookie", l.cookie)
      .send({ type: "habilitation_electrique", libelle: "Habilitation électrique — expirée", dateExpiration: dansNJours(-5) })
      .expect(201);
    await request(serveurTest(app)).post(`/api/equipe/${membre.id}/habilitations`).set("Cookie", l.cookie)
      .send({ type: "caces", libelle: "CACES — bientôt expiré", dateExpiration: dansNJours(10) })
      .expect(201);
    await request(serveurTest(app)).post(`/api/equipe/${membre.id}/habilitations`).set("Cookie", l.cookie)
      .send({ type: "diplome_etat", libelle: "Diplôme d'État — valide", dateExpiration: dansNJours(300) })
      .expect(201);

    const { body } = await request(serveurTest(app)).get("/api/brief").set("Cookie", l.cookie).expect(200);
    const habilitations = body.sections.find((s: { type: string }) => s.type === "habilitations");
    expect(habilitations.items).toHaveLength(2);
    const labels = habilitations.items.map((i: { label: string; urgent: boolean }) => i.label);
    expect(labels.some((lbl: string) => lbl.includes("expirée"))).toBe(true);
    expect(labels.some((lbl: string) => lbl.includes("bientôt expiré"))).toBe(true);
    expect(labels.some((lbl: string) => lbl.includes("valide"))).toBe(false);

    const expiree = habilitations.items.find((i: { label: string }) => i.label.includes("expirée"));
    const bientot = habilitations.items.find((i: { label: string }) => i.label.includes("bientôt expiré"));
    expect(expiree.urgent).toBe(true);
    expect(bientot.urgent).toBe(false);
  });

  test("aucune habilitation à surveiller → pas de section habilitations", async () => {
    const l = await inscrire("habilitations-brief-vide");
    const { body } = await request(serveurTest(app)).get("/api/brief").set("Cookie", l.cookie).expect(200);
    expect(body.sections.find((s: { type: string }) => s.type === "habilitations")).toBeUndefined();
  });
});

describe("a, b — sévérité calibrée par secteur, en retard significatif en tête", () => {
  test("bâtiment (délai usuel 30j) : 15 jours de retard → pas urgent ; 45 jours → urgent, en tête", async () => {
    const l = await inscrire("batiment-brief");
    await request(serveurTest(app)).patch("/api/votre-metier").set("Cookie", l.cookie).send({ metier: "batiment" }).expect(200);

    const legere = await creerFacture(l, ilYA(15));
    await request(serveurTest(app)).post(`/api/factures/${legere.id}/emettre`).set("Cookie", l.cookie)
      .send({ issuedDate: ilYA(15), dueDate: ilYA(15) }).expect(200);

    const grave = await creerFacture(l, ilYA(45));
    await request(serveurTest(app)).post(`/api/factures/${grave.id}/emettre`).set("Cookie", l.cookie)
      .send({ issuedDate: ilYA(45), dueDate: ilYA(45) }).expect(200);

    const { body } = await request(serveurTest(app)).get("/api/brief").set("Cookie", l.cookie).expect(200);
    const overdue = body.sections.find((s: { type: string }) => s.type === "overdue");
    expect(overdue.items).toHaveLength(2);
    // La facture à 45 jours (significative) est en tête, urgent=true.
    expect(overdue.items[0].urgent).toBe(true);
    expect(overdue.items[1].urgent).toBe(false);
  });
});
