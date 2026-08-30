/**
 * Un avoir doit rester possible APRÈS l'encaissement.
 *
 * Constaté le 29/08/2026 : « L'avoir ne peut référencer qu'une facture EMISE
 * (statut actuel : PAYEE). » Un geste commercial consenti après le paiement, ou
 * une erreur découverte plus tard, n'avait aucun chemin dans le produit.
 *
 * ── POURQUOI CE N'ÉTAIT PAS UN SIMPLE OUBLI ────────────────────────────────
 *
 * Tout le mécanisme est bâti sur `residual_cents` : l'avoir réduit ce qui reste
 * DÛ, et le ramène à zéro dans le cas d'une annulation totale. Sur une facture
 * payée, il ne reste rien à réduire — l'avoir n'est plus une remise sur une
 * dette, c'est un REMBOURSEMENT.
 *
 * L'invariant change donc de nature. Il ne s'agit plus de « ne pas dépasser le
 * solde restant » mais de « ne pas rendre plus que ce qui a été facturé » : le
 * cumul des avoirs d'une facture ne peut excéder son montant.
 *
 * ── CE QUE CE LOT NE FAIT PAS ──────────────────────────────────────────────
 *
 * Il produit le DOCUMENT. Le remboursement lui-même — le virement au client —
 * reste hors du produit, et rien ne le suit. C'est une absence assumée, pas un
 * oubli : l'inventer ici serait ajouter une créance fantôme que personne ne
 * solderait.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

let cookie: string;
let tenantId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

/** Une facture de 1 200 € TTC (1 000 HT + 200 TVA), dans le statut demandé. */
async function facture(statut: "EMISE" | "PAYEE"): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents,
                           total_ht_cents, total_tva_cents, residual_cents,
                           due_date, issued_date, statut, settled)
     VALUES ($1, $2::uuid, $3, 'Client Test', 120000, 100000, 20000, $4,
             '2026-08-01', '2026-08-01', $5, $6)`,
    [id, tenantId, `F-${Math.random().toString(36).slice(2, 8)}`,
     statut === "PAYEE" ? 0 : 120000, statut, statut === "PAYEE"],
  );
  return id;
}

const creerAvoir = (factureRefId: string, htCents: number, tvaCents: number) =>
  request(serveurTest(app)).post("/api/avoirs").set("Cookie", cookie).send({
    factureRefId, montantHtCents: htCents, montantTvaCents: tvaCents,
    motif: "Geste commercial après encaissement",
  });

beforeAll(async () => {
  const email = `avoir-payee-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Tenant Avoirs" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(serveurTest(app))
    .get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);
}, 120_000);

beforeEach(async () => {
  for (const t of ["archived_pdfs", "avoirs", "factures"]) {
    await adminPool.query(`DELETE FROM ${t} WHERE tenant_id = $1::uuid`, [tenantId]);
  }
});

afterAll(async () => {
  for (const t of ["archived_pdfs", "avoirs", "factures"]) {
    await adminPool.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  }
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

async function relire(id: string) {
  const { rows } = await adminPool.query(
    "SELECT statut, residual_cents, settled FROM factures WHERE id = $1", [id]);
  return rows[0] as { statut: string; residual_cents: number; settled: boolean };
}

describe("un avoir après encaissement", () => {
  test("il est accepté sur une facture PAYEE", async () => {
    const f = await facture("PAYEE");
    const res = await creerAvoir(f, 20_000, 4_000);
    expect(res.status).toBe(201);
    expect(res.body.numero ?? res.body.reference).toBeTruthy();
  });

  /*
   * La facture RESTE payée. Elle l'a été : le journal des encaissements en
   * porte la trace, et la réécrire nierait un fait. L'avoir vit à côté, et
   * c'est lui qui porte la correction — exactement comme pour un avoir partiel
   * sur une facture émise, où `amount_cents` n'est jamais retouché.
   */
  test("la facture reste PAYEE et son solde reste à zéro", async () => {
    const f = await facture("PAYEE");
    await creerAvoir(f, 20_000, 4_000).expect(201);
    const apres = await relire(f);
    expect(apres.statut).toBe("PAYEE");
    expect(apres.residual_cents).toBe(0);
    expect(apres.settled).toBe(true);
  });

  test("on ne peut pas rendre plus que ce qui a été facturé", async () => {
    const f = await facture("PAYEE");
    // 1 200 € facturés ; un avoir de 1 500 € TTC n'a aucun sens.
    const res = await creerAvoir(f, 125_000, 25_000);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/dépasse/i);
  });

  test("le CUMUL des avoirs est borné, pas seulement chacun", async () => {
    const f = await facture("PAYEE");
    await creerAvoir(f, 80_000, 16_000).expect(201);   // 96 000 TTC
    // 96 000 + 36 000 = 132 000 > 120 000 : refusé.
    const second = await creerAvoir(f, 30_000, 6_000);
    expect(second.status).toBe(422);
  });

  test("deux avoirs qui tiennent dans le total passent tous les deux", async () => {
    const f = await facture("PAYEE");
    await creerAvoir(f, 50_000, 10_000).expect(201);   // 60 000 TTC
    await creerAvoir(f, 40_000, 8_000).expect(201);    // 48 000 TTC → 108 000 ≤ 120 000
  });
});

describe("le chemin d'une facture ÉMISE n'a pas bougé", () => {
  test("l'avoir partiel décrémente toujours le solde restant dû", async () => {
    const f = await facture("EMISE");
    await creerAvoir(f, 20_000, 4_000).expect(201);
    const apres = await relire(f);
    expect(apres.residual_cents).toBe(120_000 - 24_000);
    expect(apres.statut).toBe("EMISE");
  });

  test("l'avoir total bascule toujours en ANNULEE_PAR_AVOIR", async () => {
    const f = await facture("EMISE");
    await creerAvoir(f, 100_000, 20_000).expect(201);
    const apres = await relire(f);
    expect(apres.statut).toBe("ANNULEE_PAR_AVOIR");
    expect(apres.residual_cents).toBe(0);
  });
});
