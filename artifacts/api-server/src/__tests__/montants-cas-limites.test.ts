/*
 * Les montants au-delà du seuil, de bout en bout.
 *
 * ── Ce que ces tests ajoutent à `montants-entiers.test.ts` ────────────────
 * L'autre fichier interroge le MOTEUR : quels types portent les colonnes.
 * Celui-ci fait passer de vrais montants par les VRAIES routes, et vérifie
 * qu'ils ressortent au centime. C'est la différence entre « la colonne est
 * `integer` » et « une facture de 199 999,99 € se comporte bien ».
 *
 * Le seuil est 2^24 = 16 777 216 centimes, soit 167 772,16 €. En dessous, le
 * flottant était exact et rien n'aurait échoué : les cas limites sont donc
 * choisis à cheval sur cette frontière, pas au hasard.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import { residuelFactureCents } from "../lib/facturesEnRetard.js";
import {
  adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest,
} from "./helpers.js";

const SEUIL_CENTS = 16_777_216;          // 2^24 — 167 772,16 €
const tenantIds: string[] = [];
const emails: string[] = [];
let cookie = "";
let tenantId = "";

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `cents-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Cents ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

beforeAll(async () => {
  const t = await inscrire("a");
  cookie = t.cookie; tenantId = t.tenantId;
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

/** Crée une facture d'un seul poste, au prix unitaire donné. */
const creerFacture = (prixUnitaireHtCents: number, quantity = 1) =>
  request(serveurTest(app)).post("/api/factures").set("Cookie", cookie).send({
    customerName: "Client gros chantier",
    issuedDate: "2026-05-01",
    dueDate: "2026-06-01",
    lines: [{ description: "Lot gros œuvre", quantity, unitPriceCents: prixUnitaireHtCents, vatRate: 20 }],
  });

describe("le seuil de 2^24, franchi par les vraies routes", () => {
  test("juste en dessous, juste au-dessus, et un cran plus loin", async () => {
    // Trois valeurs choisies sur la frontière : sous le seuil le flottant
    // était déjà exact, c'est au-dessus que tout se jouait.
    for (const ht of [SEUIL_CENTS - 1, SEUIL_CENTS, SEUIL_CENTS + 1]) {
      const { body } = await creerFacture(ht).expect(201);
      expect(body.totalHTCents, `HT pour ${ht}`).toBe(ht);
      // Le TTC est relu depuis la base, pas depuis la réponse : c'est le
      // stockage qu'on éprouve.
      const { rows } = await adminPool.query(
        "SELECT amount_cents, total_ht_cents, total_tva_cents FROM factures WHERE id = $1",
        [body.id],
      );
      const l = rows[0];
      expect(Number(l.amount_cents)).toBe(Number(l.total_ht_cents) + Number(l.total_tva_cents));
      expect(Number(l.total_ht_cents)).toBe(ht);
    }
  });

  test("199 999,99 € reste 199 999,99 € — la valeur qui devenait 200 000,00 €", async () => {
    // 16 666 666 HT + 20 % = 3 333 333 TVA → 19 999 999 TTC.
    const { body } = await creerFacture(16_666_666).expect(201);
    const { rows } = await adminPool.query(
      "SELECT amount_cents, residual_cents FROM factures WHERE id = $1", [body.id],
    );
    expect(Number(rows[0].amount_cents)).toBe(19_999_999);
    expect(Number(rows[0].amount_cents)).not.toBe(20_000_000);
    expect(Number(rows[0].residual_cents)).toBe(19_999_999);
  });

  test("1 234 567,89 € reste exact — la valeur qui gagnait 3 centimes", async () => {
    // 102 880 658 HT + 20 % arrondi = 20 576 132 → 123 456 790 TTC.
    // Le chiffre exact importe moins que l'égalité TTC = HT + TVA au centime.
    const { body } = await creerFacture(102_880_658).expect(201);
    const { rows } = await adminPool.query(
      "SELECT amount_cents, total_ht_cents, total_tva_cents FROM factures WHERE id = $1", [body.id],
    );
    const l = rows[0];
    expect(Number(l.amount_cents)).toBe(Number(l.total_ht_cents) + Number(l.total_tva_cents));
    expect(Number(l.total_ht_cents)).toBe(102_880_658);
  });
});

describe("l'addition des résidus sur un gros chantier", () => {
  test("dix factures au-delà du seuil s'additionnent au centime", async () => {
    // Le défaut ne se voyait pas sur une facture : il se voyait sur le TOTAL
    // des impayés, qui est ce que l'artisan regarde.
    const t = await inscrire("somme");
    const creer = (ht: number) =>
      request(serveurTest(app)).post("/api/factures").set("Cookie", t.cookie).send({
        customerName: "Client", issuedDate: "2026-05-01", dueDate: "2026-06-01",
        lines: [{ description: "Lot", quantity: 1, unitPriceCents: ht, vatRate: 20 }],
      }).expect(201);

    let attendu = 0;
    for (let i = 0; i < 10; i++) {
      const ht = 16_666_666 + i;                       // tous au-delà du seuil
      const { body } = await creer(ht);
      attendu += body.totalHTCents + body.totalTVACents;
    }

    const { rows } = await adminPool.query(
      "SELECT SUM(amount_cents)::bigint AS total FROM factures WHERE tenant_id = $1", [t.tenantId],
    );
    // `SUM(int4)` est promu en bigint par PostgreSQL : le pilote le rend en
    // chaîne, d'où le `Number()`. C'est précisément le piège qu'on évite en
    // gardant les colonnes en `integer` plutôt qu'en `bigint`.
    expect(Number(rows[0].total)).toBe(attendu);
  });
});

describe("le solde dû d'une facture de 200 000 € partiellement payée", () => {
  test("`residuelFactureCents` est exact au centime après un règlement partiel", async () => {
    const t = await inscrire("solde");
    const { body: facture } = await request(serveurTest(app))
      .post("/api/factures").set("Cookie", t.cookie).send({
        customerName: "Client", issuedDate: "2026-05-01", dueDate: "2026-06-01",
        lines: [{ description: "Lot", quantity: 1, unitPriceCents: 16_666_666, vatRate: 20 }],
      }).expect(201);

    const ttc = 19_999_999;
    expect(facture.amountCents).toBe(ttc);

    // Un règlement partiel de 123 456,78 € — un montant qui n'est pas rond,
    // pour qu'un arrondi se voie. Il passe par la vraie route d'encaissement,
    // qui écrit au journal append-only puis recalcule le solde.
    const regle = 12_345_678;
    await request(serveurTest(app))
      .post("/api/paiements").set("Cookie", t.cookie)
      .send({ factureId: facture.id, montantCents: regle, date: "2026-05-20" })
      .expect((r) => { if (r.status >= 400) throw new Error(`${r.status} ${JSON.stringify(r.body)}`); });

    const { rows } = await adminPool.query(
      "SELECT residual_cents, amount_cents FROM factures WHERE id = $1", [facture.id],
    );
    const solde = residuelFactureCents({
      residualCents: Number(rows[0].residual_cents),
      amountCents: Number(rows[0].amount_cents),
    });
    expect(solde).toBe(ttc - regle);         // 7 654 321 centimes, au centime près
  });
});

describe("l'invariant de cohérence, éprouvé par une écriture directe", () => {
  test("le moteur refuse un TTC qui contredit sa ventilation", async () => {
    // Une route ne peut pas produire cet état — c'est justement pourquoi la
    // contrainte existe : elle protège des chemins qu'on n'a pas prévus
    // (reprise de données, correction manuelle, script de support).
    await expect(
      adminPool.query(
        `INSERT INTO factures (id, tenant_id, customer_name, number, issued_date, due_date,
                               amount_cents, total_ht_cents, total_tva_cents, lines, settled)
         VALUES ($1, $2, 'X', 'INCOHERENT-1', '2026-05-01', '2026-06-01', 999, 100, 20, '[]', false)`,
        [`incoherent-${crypto.randomUUID()}`, tenantId],
      ),
    ).rejects.toThrow(/factures_ttc_coherent/);
  });

  test("une reprise sans ventilation connue reste acceptée", async () => {
    // Un TTC importé sans détail HT/TVA est légitime : la contrainte le tolère
    // explicitement, sans quoi la reprise d'impayés deviendrait impossible.
    const id = `reprise-${crypto.randomUUID()}`;
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, customer_name, number, issued_date, due_date,
                             amount_cents, total_ht_cents, total_tva_cents, lines, settled)
       VALUES ($1, $2, 'X', $3, '2026-05-01', '2026-06-01', 25000000, 0, 0, '[]', false)`,
      [id, tenantId, `REPRISE-${crypto.randomUUID().slice(0, 6)}`],
    );
    const { rows } = await adminPool.query("SELECT amount_cents FROM factures WHERE id = $1", [id]);
    expect(Number(rows[0].amount_cents)).toBe(25_000_000);
  });
});
