/*
 * La liste des factures, paginée et triée par le SERVEUR.
 *
 * ── Le défaut corrigé ─────────────────────────────────────────────────────
 * La route rendait TOUTES les factures du tenant, sans limite, avec le détail
 * complet de chacune. À la troisième année d'activité, un artisan en a quatre
 * cents : quatre cents lignes chargées d'un coup, sur un téléphone.
 *
 * ── Ce qui porte le risque, et que ces tests visent ───────────────────────
 * Ce n'est pas la pagination, c'est ce qu'elle CASSE si on l'ajoute mal :
 *
 *   — un tri côté client trierait la PAGE, pas l'ensemble. Ça a l'air juste et
 *     c'est faux, ce qui est pire que pas de tri ;
 *   — des totaux calculés sur la page changeraient en tournant la page. Un
 *     indicateur qui bouge sans que rien ne bouge est pire qu'absent ;
 *   — `sum` d'un `integer` rend un `bigint`, livré en CHAÎNE par
 *     node-postgres : sans conversion, « 0 » et « 196100 » se concatènent en
 *     « 0196100 ». C'est arrivé, et le cockpit l'a affiché.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest,
} from "./helpers.js";

let cookie: string;
let tenantId: string;
const tenantIds: string[] = [];
const emails: string[] = [];

/** 120 factures : au-delà du défaut de 50, donc trois pages. */
const NOMBRE = 120;

beforeAll(async () => {
  const email = `pagi-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: "Pagination" })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantId = body.tenantId; tenantIds.push(tenantId);
  cookie = headers["set-cookie"][0];

  // Montants croissants et dates échelonnées : le tri devient vérifiable.
  const valeurs = Array.from({ length: NOMBRE }, (_, i) => [
    crypto.randomUUID(), tenantId, `Client ${String(i).padStart(3, "0")}`,
    `F-${String(i).padStart(3, "0")}`, "2026-01-01",
    // Une facture sur trois échue, donc en retard.
    i % 3 === 0 ? "2020-01-01" : "2030-01-01",
    (i + 1) * 1000, i % 3 === 0 ? "EMISE" : "PAYEE",
  ]);
  for (const v of valeurs) {
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, customer_name, number, issued_date, due_date,
                             amount_cents, statut, residual_cents)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $7)`, v,
    );
  }
}, 120_000);

afterAll(async () => {
  await adminPool.query(`DELETE FROM factures WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

const lire = (q = "") =>
  request(serveurTest(app)).get(`/api/factures${q}`).set("Cookie", cookie);

describe("la page, et rien que la page", () => {
  test("le défaut rend 50 factures, pas 120", async () => {
    const { body } = await lire().expect(200);
    expect(body.factures).toHaveLength(50);
    expect(body.total).toBe(NOMBRE);
  });

  test("le décalage atteint la dernière page", async () => {
    const { body } = await lire("?offset=100").expect(200);
    expect(body.factures).toHaveLength(20);
  });

  test("la limite est BORNÉE — sinon on retombe sur le défaut corrigé", async () => {
    await lire("?limit=5000").expect(400);
  });

  test("deux pages ne se recouvrent pas", async () => {
    // Un tri instable ferait réapparaître la même facture sur deux pages, et
    // disparaître une autre — invisible sans ce test.
    const p1 = (await lire("?limit=50&offset=0").expect(200)).body;
    const p2 = (await lire("?limit=50&offset=50").expect(200)).body;
    const ids = new Set([...p1.factures, ...p2.factures].map((f: { id: string }) => f.id));
    expect(ids.size).toBe(100);
  });
});

describe("le tri porte sur TOUT, pas sur la page", () => {
  test("par montant croissant, la première page commence au plus petit", async () => {
    const { body } = await lire("?tri=montant&sens=asc").expect(200);
    expect(body.factures[0].amountCents).toBe(1000);
    expect(body.factures[49].amountCents).toBe(50_000);
  });

  test("par montant décroissant, elle commence au plus GRAND des 120", async () => {
    // Le test qui distingue un tri serveur d'un tri client : trier la page
    // seulement rendrait 50 000, pas 120 000.
    const { body } = await lire("?tri=montant&sens=desc").expect(200);
    expect(body.factures[0].amountCents).toBe(NOMBRE * 1000);
  });

  test("une colonne de tri INCONNUE est refusée", async () => {
    // `?tri=` vient de l'extérieur : l'interpoler dans un ORDER BY serait une
    // injection. La liste blanche refuse, elle ne devine pas.
    await lire("?tri=amount_cents;DROP TABLE factures--").expect(400);
    await lire("?tri=inconnu").expect(400);
  });
});

describe("les totaux portent sur l'ensemble filtré", () => {
  test("le total ne change PAS d'une page à l'autre", async () => {
    // Un indicateur qui bouge quand on tourne la page est pire qu'absent.
    const p1 = (await lire("?offset=0").expect(200)).body;
    const p3 = (await lire("?offset=100").expect(200)).body;
    expect(p1.totalAmountCents).toBe(p3.totalAmountCents);
    expect(p1.totalOverdueCents).toBe(p3.totalOverdueCents);
  });

  test("il vaut la somme des 120, pas des 50 affichées", async () => {
    // 1000 + 2000 + … + 120000 = 1000 × (120 × 121 / 2)
    const attendu = 1000 * (NOMBRE * (NOMBRE + 1) / 2);
    const { body } = await lire().expect(200);
    expect(body.totalAmountCents).toBe(attendu);
  });

  test("les totaux sont des NOMBRES, jamais des chaînes concaténées", async () => {
    // `sum` d'un `integer` rend un `bigint`, livré en chaîne par
    // node-postgres. Sans conversion, « 0 » + « 196100 » donne « 0196100 ».
    const { body } = await lire().expect(200);
    expect(typeof body.totalAmountCents).toBe("number");
    expect(typeof body.totalOverdueCents).toBe("number");
    expect(typeof body.total).toBe("number");
  });

  test("le filtre de statut s'applique AVANT la pagination et les totaux", async () => {
    // Il se faisait en JavaScript après avoir tout chargé : la limite était
    // alors inopérante, et les totaux portaient sur le mauvais ensemble.
    const { body } = await lire("?statut=EMISE").expect(200);
    expect(body.total).toBe(40);   // une sur trois
    expect(body.factures.every((f: { statut: string }) => f.statut === "EMISE")).toBe(true);
  });
});

describe("l'isolation", () => {
  test("un autre tenant ne voit aucune de ces factures", async () => {
    const email = `pagi-b-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
    emails.push(email);
    const { body: reg, headers } = await request(serveurTest(app))
      .post("/api/auth/register")
      .send({ email, password: "test-pass-1234", nom: "P", tenantNom: "Pagination B" })
      .expect(201);
    await completeMfaForRegisteredOwner(reg.userId);
    tenantIds.push(reg.tenantId);

    const { body } = await request(serveurTest(app))
      .get("/api/factures").set("Cookie", headers["set-cookie"][0]).expect(200);
    expect(body.total).toBe(0);
    expect(body.totalAmountCents).toBe(0);
  });
});
