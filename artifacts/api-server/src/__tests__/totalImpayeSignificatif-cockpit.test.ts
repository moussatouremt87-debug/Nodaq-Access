/**
 * `totalImpayeSignificatifCents` (US-A3.1) — la sévérité d'un retard de
 * paiement dépend du cycle réel du secteur, pas d'un seuil unique.
 *
 * Ce que ces tests protègent :
 *   a. un commerce (délai usuel 0 jour) voit un retard de 15 jours comme
 *      significatif — aucune marge, tout retard y est déjà anormal ;
 *   b. le même retard de 15 jours, pour un profil B2B/bâtiment (délai usuel
 *      30 jours), n'est PAS significatif — absorbé par son cycle normal ;
 *   c. `delaiPaiementUsuelJours` est bien exposé dans la réponse cockpit,
 *      pour que le front puisse l'afficher explicitement dans le hint.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { toDateString } from "@nodaq/shared";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

async function inscrire(nom: string): Promise<Locataire> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `impaye-sig-${nom}-${suffix}@test.nodaq`;
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

  // Le SIRET est obligatoire (`auditMentionsFR`) pour émettre une facture —
  // même SIRET déjà validé Luhn qu'ailleurs dans la suite (settings scopé
  // par tenant, pas de contrainte d'unicité globale).
  await request(serveurTest(app)).post("/api/onboarding/profil/confirmer").set("Cookie", cookie)
    .send({
      siret: "81234567600009", siren: "812345676", raison_sociale: `${nom} SARL`,
      adresse: "9 rue des Artisans", code_postal: "69001", commune: "Lyon",
    })
    .expect(200);

  return { cookie, tenantId };
}

async function definirVertical(l: Locataire, metier: string): Promise<void> {
  await request(serveurTest(app)).patch("/api/votre-metier").set("Cookie", l.cookie).send({ metier }).expect(200);
}

/** Facture émise, en retard de 15 jours pile (dueDate = aujourd'hui − 15 j). */
async function factureEnRetard15Jours(l: Locataire): Promise<void> {
  const il15Jours = new Date();
  il15Jours.setDate(il15Jours.getDate() - 15);
  // Composantes LOCALES, jamais toISOString() (décale le jour hors UTC).
  const dueDate = toDateString(il15Jours);

  const { body: f } = await request(serveurTest(app)).post("/api/factures").set("Cookie", l.cookie)
    .send({
      customerName: "Client Retard", issuedDate: dueDate, dueDate,
      lines: [{ description: "Prestation", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" }],
    })
    .expect(201);
  await request(serveurTest(app)).post(`/api/factures/${f.id}/emettre`).set("Cookie", l.cookie)
    .send({ issuedDate: dueDate, dueDate }).expect(200);
}

let commerce: Locataire;
let btp: Locataire;

beforeAll(async () => {
  commerce = await inscrire("commerce");
  await definirVertical(commerce, "retail");
  await factureEnRetard15Jours(commerce);

  btp = await inscrire("btp");
  await definirVertical(btp, "batiment");
  await factureEnRetard15Jours(btp);
}, 60_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("totalImpayeSignificatifCents — calibré par le délai usuel du secteur", () => {
  test("commerce (délai usuel 0j) : un retard de 15 jours est significatif", async () => {
    const { body } = await request(serveurTest(app)).get("/api/cockpit/kpis").set("Cookie", commerce.cookie).expect(200);
    expect(body.delaiPaiementUsuelJours).toBe(0);
    expect(body.totalImpayeCents).toBeGreaterThan(0);
    expect(body.totalImpayeSignificatifCents).toBe(body.totalImpayeCents);
  });

  test("bâtiment (délai usuel 30j) : le même retard de 15 jours n'est PAS significatif", async () => {
    const { body } = await request(serveurTest(app)).get("/api/cockpit/kpis").set("Cookie", btp.cookie).expect(200);
    expect(body.delaiPaiementUsuelJours).toBe(30);
    expect(body.totalImpayeCents).toBeGreaterThan(0);
    expect(body.totalImpayeSignificatifCents).toBe(0);
  });
});
