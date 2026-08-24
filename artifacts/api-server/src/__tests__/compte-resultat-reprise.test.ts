/*
 * Le compte de résultat, de bout en bout — US-A1.2 critère 3.
 *
 * `productionVendue.test.ts` éprouve le CALCUL. Celui-ci vérifie le CÂBLAGE :
 * que la route lit bien la reprise là où l'onboarding l'écrit, avec l'unité
 * qu'il emploie, et que les factures d'un autre tenant n'entrent jamais dans
 * ce document.
 *
 * Ce fichier est le premier test de cette route. Elle produit un document
 * comptable et n'en avait aucun.
 */
import { describe, test, expect, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `cr-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `CR ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

async function facture(
  tenantId: string,
  opts: { statut: string; ht: number; ttc: number; date?: string },
): Promise<void> {
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, customer_name, number, issued_date, due_date,
                           amount_cents, statut, total_ht_cents, total_tva_cents)
     VALUES ($1, $2::uuid, 'Client', 'F-1', $3, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), tenantId, opts.date ?? "2026-03-01", opts.ttc, opts.statut,
     opts.ht, opts.ttc - opts.ht],
  );
}

/** Ce que l'onboarding écrit : des EUROS, dans `settings`. */
async function reprise(tenantId: string, caEuros: string, debut?: string): Promise<void> {
  // `settings` n'a pas de colonne `id` : sa clé est (tenant_id, key).
  const poser = (k: string, v: string) => adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, k, v],
  );
  await poser("reprise.ca_facture_ytd", caEuros);
  if (debut) await poser("reprise.date_debut_exercice", debut);
}

const lire = (c: string, from = "2026-01-01", to = "2026-12-31") =>
  request(serveurTest(app))
    .get(`/api/compte-resultat?from=${from}&to=${to}`).set("Cookie", c);

/** La ligne qui porte le chiffre d'affaires. */
function production(body: unknown): { autoAmountCents: number; autoHint?: string } {
  const lignes = (body as { lines: { lineCode: string; autoAmountCents: number; autoHint?: string }[] }).lines;
  return lignes.find((l) => l.lineCode === "PRODUCTION_VENDUE_SERVICES")!;
}

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("le chiffre d'affaires repris entre dans le premier exercice", () => {
  test("85 000 € repris s'ajoutent aux factures de nodaq", async () => {
    // Le câblage qui casse en silence : l'onboarding enregistre 85000 — des
    // EUROS — et le compte de résultat compte en centimes. Une lecture naïve
    // afficherait 850 € au lieu de 85 000 €, un facteur cent dans un document
    // comptable. C'est pour ça que ce test vérifie le nombre exact.
    const t = await inscrire("reprise");
    await facture(t.tenantId, { statut: "EMISE", ht: 100_000, ttc: 120_000 });
    await reprise(t.tenantId, "85000", "2026-01-01");

    const { body } = await lire(t.cookie).expect(200);
    expect(production(body).autoAmountCents).toBe(8_500_000 + 100_000);
  });

  test("et le document DIT d'où vient l'écart", async () => {
    const t = await inscrire("dit");
    await reprise(t.tenantId, "85000", "2026-01-01");

    const { body } = await lire(t.cookie).expect(200);
    expect(production(body).autoHint).toMatch(/repris/);
  });

  test("sur un autre exercice, la reprise n'est pas recomptée", async () => {
    const t = await inscrire("autre");
    await reprise(t.tenantId, "85000", "2026-01-01");

    const { body } = await lire(t.cookie, "2027-01-01", "2027-12-31").expect(200);
    expect(production(body).autoAmountCents).toBe(0);
  });
});

describe("les défauts corrigés au passage", () => {
  test("un BROUILLON ne gonfle pas le résultat", async () => {
    const t = await inscrire("brouillon");
    await facture(t.tenantId, { statut: "BROUILLON", ht: 100_000, ttc: 120_000 });

    const { body } = await lire(t.cookie).expect(200);
    expect(production(body).autoAmountCents).toBe(0);
  });

  test("le produit est du HT, la TVA collectée n'en est pas un", async () => {
    const t = await inscrire("ht");
    await facture(t.tenantId, { statut: "EMISE", ht: 100_000, ttc: 120_000 });

    const { body } = await lire(t.cookie).expect(200);
    expect(production(body).autoAmountCents).toBe(100_000);   // et non 120 000
  });
});

describe("l'isolation", () => {
  test("les factures d'un tenant n'entrent pas dans le compte de résultat d'un autre", async () => {
    // Le pire défaut imaginable sur ce document : le chiffre d'affaires d'un
    // confrère dans sa propre liasse.
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    await facture(a.tenantId, { statut: "EMISE", ht: 777_777, ttc: 933_332 });
    await reprise(a.tenantId, "12345", "2026-01-01");

    const { body } = await lire(b.cookie).expect(200);
    expect(production(body).autoAmountCents).toBe(0);
    expect(JSON.stringify(body)).not.toContain("777777");
    expect(JSON.stringify(body)).not.toContain("12345");
  });
});
