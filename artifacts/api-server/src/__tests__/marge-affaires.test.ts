/**
 * L'écran Marge doit voir ce qui a été facturé sur le chantier.
 *
 * Constaté le 29/08/2026 : 136 706 € facturés sur quatre chantiers, et un écran
 * qui affichait « 0,00 € », « marge non mesurée » et un tableau vide.
 *
 * La cause n'était pas le calcul de marge : c'est que `affaires
 * .invoiced_amount_cents` n'était JAMAIS écrit. Ni la facturation d'un devis,
 * ni l'émission ne le renseignent — seule une saisie manuelle sur chaque
 * chantier le fait. L'écran filtrait donc sur un champ toujours nul et se
 * vidait entièrement.
 *
 * Le montant facturé d'un chantier n'est pas une donnée à tenir à jour : c'est
 * la somme de ses factures. On le DÉRIVE.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { toDateString } from "@nodaq/shared";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

let cookie: string;
let tenantId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
// `toDateString` et non `toISOString().slice(0,10)` : passé midi UTC, la
// seconde donne déjà le lendemain à Auckland. Une garde du dépôt l'interdit.
const aujourdhui = toDateString(new Date());

async function affaire(opts: { invoicedAmountCents?: number | null } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO affaires (id, tenant_id, label, client_name, status, origine, invoiced_amount_cents)
     VALUES ($1, $2::uuid, 'Chantier test', 'Client Test', 'ACCEPTEE', 'DIRECT', $3)`,
    [id, tenantId, opts.invoicedAmountCents ?? null],
  );
  return id;
}

async function facture(opts: {
  affaireId: string | null; totalHtCents: number; totalTvaCents?: number; statut?: string;
}): Promise<void> {
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents,
                           total_ht_cents, total_tva_cents, due_date, issued_date,
                           statut, settled, affaire_id)
     VALUES ($1, $2::uuid, $3, 'Client Test', $4, $5, $6, $7, $7, $8, false, $9)`,
    [
      crypto.randomUUID(), tenantId, `F-${Math.random().toString(36).slice(2, 10)}`,
      opts.totalHtCents + (opts.totalTvaCents ?? 0),
      opts.totalHtCents, opts.totalTvaCents ?? 0,
      aujourdhui, opts.statut ?? "EMISE", opts.affaireId,
    ],
  );
}

beforeAll(async () => {
  const email = `marge-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Tenant Marge" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(serveurTest(app))
    .get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);
}, 120_000);

beforeEach(async () => {
  await adminPool.query(`DELETE FROM factures WHERE tenant_id = $1::uuid`, [tenantId]);
  await adminPool.query(`DELETE FROM affaires WHERE tenant_id = $1::uuid`, [tenantId]);
});

afterAll(async () => {
  for (const t of ["factures", "affaires"]) {
    await adminPool.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  }
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

const marge = () => request(serveurTest(app)).get("/api/marge").set("Cookie", cookie);

describe("le montant facturé d'un chantier est la somme de ses factures", () => {
  test("une facture émise sur le chantier le fait apparaître à l'écran", async () => {
    const a = await affaire();
    await facture({ affaireId: a, totalHtCents: 250_000, totalTvaCents: 50_000 });

    const res = await marge();
    expect(res.status).toBe(200);
    expect(res.body.totalRevenueCents).toBe(250_000);
    expect(res.body.affaires).toHaveLength(1);
    expect(res.body.affaires[0].invoicedAmountCents).toBe(250_000);
  });

  test("le montant est HT — la TVA n'est pas du chiffre d'affaires", async () => {
    const a = await affaire();
    await facture({ affaireId: a, totalHtCents: 100_000, totalTvaCents: 20_000 });
    // 120 000 serait le TTC : la même faute que celle corrigée sur le Cockpit.
    expect((await marge()).body.totalRevenueCents).toBe(100_000);
  });

  test("un BROUILLON ne compte pas : il n'a été envoyé à personne", async () => {
    const a = await affaire();
    await facture({ affaireId: a, totalHtCents: 400_000, statut: "BROUILLON" });
    expect((await marge()).body.totalRevenueCents).toBe(0);
  });

  test("deux factures sur le même chantier s'additionnent", async () => {
    const a = await affaire();
    await facture({ affaireId: a, totalHtCents: 150_000 });
    await facture({ affaireId: a, totalHtCents: 90_000 });
    expect((await marge()).body.totalRevenueCents).toBe(240_000);
  });

  test("une facture SANS chantier ne gonfle aucun chantier", async () => {
    const a = await affaire();
    await facture({ affaireId: a, totalHtCents: 100_000 });
    await facture({ affaireId: null, totalHtCents: 999_000 });
    expect((await marge()).body.totalRevenueCents).toBe(100_000);
  });

  /*
   * Le repli. Un chantier repris d'un ancien logiciel n'a aucune facture DANS
   * nodaq : sa seule source est le montant saisi à la main. Le dériver à zéro
   * effacerait le passé de l'entreprise — même raisonnement que le repli sur
   * le TTC des factures reprises, dans `productionVendue`.
   */
  test("un chantier sans facture garde le montant saisi à la main", async () => {
    await affaire({ invoicedAmountCents: 800_000 });
    expect((await marge()).body.totalRevenueCents).toBe(800_000);
  });

  test("dès qu'une facture existe, c'est elle qui fait foi", async () => {
    const a = await affaire({ invoicedAmountCents: 800_000 });
    await facture({ affaireId: a, totalHtCents: 300_000 });
    // La saisie manuelle est un repli, pas une addition.
    expect((await marge()).body.totalRevenueCents).toBe(300_000);
  });
});
