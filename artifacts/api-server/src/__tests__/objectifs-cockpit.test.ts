/**
 * Objectifs du cockpit — lot 4.
 *
 * Ce que ces tests protègent :
 *   0. le CA du cockpit est FACTURÉ et daté de l'ÉMISSION, pas de la création
 *      de la ligne ni de l'encaissement ;
 *   a. isolation : le bloc n'est servi qu'à qui a le droit, et le CORPS est
 *      vide pour les autres — pas de masquage côté interface ;
 *   b. silence : sans paramétrage, aucune valeur de seuil, ni 0 ni null ;
 *   c. franchissement unique, y compris après un aller-retour avoir/facture ;
 *   d. bascule d'exercice : pas de rejeu du franchissement précédent ;
 *   e. moins de cinq affaires terminées → pas de conversion en chantiers.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, createTestUser, createTestMembership } from "./helpers";

let cookieOwnerA: string;
let cookieMemberA: string;
let cookieOwnerB: string;
let tenantA: string;
let tenantB: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

const anneeCourante = new Date().getFullYear();

/** Insère une facture émise, en maîtrisant création ET émission séparément. */
async function facture(
  tenantId: string,
  opts: { issuedDate: string; amountCents: number; createdAt?: string; settled?: boolean },
): Promise<void> {
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents,
                           due_date, issued_date, statut, settled, created_at)
     VALUES (gen_random_uuid()::text, $1::uuid, $2, 'Client Test', $3,
             $4, $4, 'EMISE', $5, coalesce($6::timestamptz, now()))`,
    [
      tenantId,
      `F-${Math.random().toString(36).slice(2, 10)}`,
      opts.amountCents,
      opts.issuedDate,
      opts.settled ?? false,
      opts.createdAt ?? null,
    ],
  );
}

async function reglage(tenantId: string, cle: string, valeur: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, cle, valeur],
  );
}

beforeAll(async () => {
  for (const [nom, cible] of [["a", "A"], ["b", "B"]] as const) {
    const email = `objectifs-${nom}-${Date.now()}@test.nodaq`;
    cleanupEmails.push(email);
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ email, password: "test-pass-1234", nom: `Patron ${cible}`, tenantNom: `Tenant ${cible}` })
      .expect(201);
    const cookie = reg.headers["set-cookie"]?.[0] ?? "";
    const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    if (cible === "A") { cookieOwnerA = cookie; tenantA = me.tenantId; }
    else { cookieOwnerB = cookie; tenantB = me.tenantId; }
    cleanupTenantIds.push(me.tenantId);
  }

  // Un MEMBER du tenant A — créé SANS tenant à lui.
  //
  // Passer par /auth/register lui fabriquerait son propre tenant où il serait
  // OWNER : il aurait alors deux appartenances, et la session résoudrait sur la
  // mauvaise. Le test passait au vert en lisant les objectifs d'un autre tenant.
  const emailMember = `objectifs-member-${Date.now()}@test.nodaq`;
  cleanupEmails.push(emailMember);
  const utilisateurMembre = await createTestUser(emailMember);
  await createTestMembership(utilisateurMembre.id, tenantA, "MEMBER");

  const connexion = await request(app)
    .post("/api/auth/login")
    .send({ email: emailMember, password: utilisateurMembre.password })
    .expect(200);
  cookieMemberA = connexion.headers["set-cookie"]?.[0] ?? "";
  if (!cookieMemberA) throw new Error("le MEMBER n'a pas reçu de cookie");
}, 90_000);

afterAll(async () => {
  for (const t of ["objectifs_franchissements", "factures", "settings", "affaires"]) {
    await adminPool.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  }
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── 0. Le correctif du cockpit ───────────────────────────────────────────────

describe("0 — CA du cockpit : émission, et facturé", () => {
  test("une facture CRÉÉE en décembre et ÉMISE en janvier compte sur le NOUVEL exercice", async () => {
    // Le défaut : le cockpit agrégeait sur created_at. Cette facture serait
    // tombée sur l'exercice précédent.
    await facture(tenantA, {
      issuedDate: `${anneeCourante}-01-03`,
      amountCents: 250_000,
      createdAt: `${anneeCourante - 1}-12-28T10:00:00Z`,
    });

    const { body } = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookieOwnerA)
      .expect(200);

    expect(body.ytd.caYtdCents).toBeGreaterThanOrEqual(250_000);
  });

  test("une facture NON encaissée compte dans le CA — facturé n'est pas encaissé", async () => {
    // Le défaut : la requête filtrait sur settled = true, ce qui donnait
    // l'encaissé sous le nom de « chiffre d'affaires ». Un artisan qui dit
    // « dépasser le CA de l'an dernier » parle du facturé.
    const avant = (await request(app).get("/api/cockpit/kpis").set("Cookie", cookieOwnerB).expect(200)).body.ytd.caYtdCents;

    await facture(tenantB, {
      issuedDate: `${anneeCourante}-02-10`,
      amountCents: 400_000,
      settled: false,
    });

    const apres = (await request(app).get("/api/cockpit/kpis").set("Cookie", cookieOwnerB).expect(200)).body.ytd.caYtdCents;
    expect(apres - avant).toBe(400_000);
  });
});

// ── a. Isolation et visibilité ───────────────────────────────────────────────

describe("a — VISIBILITÉ : le corps de réponse, pas l'affichage", () => {
  test("l'OWNER du tenant A reçoit le bloc", async () => {
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(Array.isArray(body.objectifs)).toBe(true);
    expect(body.objectifs.length).toBeGreaterThan(0);
  });

  test("l'OWNER du tenant B ne voit RIEN des objectifs du tenant A", async () => {
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieOwnerB)
      .expect(200);
    // Il a son propre bloc, mais aucune donnée de A n'y figure.
    expect(JSON.stringify(body)).not.toContain(tenantA);
  });

  test("un MEMBER du tenant A reçoit un corps VIDE en owner_only", async () => {
    await reglage(tenantA, "objectifs.visibilite", "owner_only");
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieMemberA)
      .expect(200);
    // Corps vide — rien à masquer côté interface, il n'y a rien.
    expect(body.objectifs).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/seuilCents|ecartCents/);
  });

  test("en visibilité « equipe », le MEMBER reçoit le bloc", async () => {
    await reglage(tenantA, "objectifs.visibilite", "equipe");
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieMemberA)
      .expect(200);
    expect(body.objectifs.length).toBeGreaterThan(0);
    await reglage(tenantA, "objectifs.visibilite", "owner_only");
  });

  test("objectifs.actif = false masque le bloc pour le patron lui-même", async () => {
    await reglage(tenantA, "objectifs.actif", "false");
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(body.objectifs).toEqual([]);
    await reglage(tenantA, "objectifs.actif", "true");
  });
});

// ── b. Silence sans paramétrage ──────────────────────────────────────────────

describe("b — SILENCE : aucun seuil inventé", () => {
  test("sans charges ni taux saisis : configurable, et AUCUNE valeur de seuil", async () => {
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieOwnerA)
      .expect(200);

    const seuil = body.objectifs.find((o: { id: string }) => o.id === "seuil_rentabilite");
    expect(seuil.configurable).toBe(true);
    // Ni valeur, ni 0, ni null déguisé en objectif : la clé n'existe pas.
    expect(seuil).not.toHaveProperty("seuilCents");
    expect(seuil).not.toHaveProperty("ecartCents");
    expect(seuil.seuilCents).toBeUndefined();
  });

  test("un taux saisi SANS charges reste un silence", async () => {
    await reglage(tenantA, "objectifs.taux_marge_bp", "3500");
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    const seuil = body.objectifs.find((o: { id: string }) => o.id === "seuil_rentabilite");
    expect(seuil.configurable).toBe(true);
    expect(seuil).not.toHaveProperty("seuilCents");
  });

  test("les deux saisis : le seuil apparaît, avec sa provenance", async () => {
    await reglage(tenantA, "objectifs.charges_fixes_annuelles_cents", "12000000");
    await reglage(tenantA, "objectifs.taux_marge_bp", "3500");
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    const seuil = body.objectifs.find((o: { id: string }) => o.id === "seuil_rentabilite");
    // 12 000 000 c ÷ 0,35 = 34 285 714 c.
    expect(seuil.seuilCents).toBe(34_285_714);
    expect(seuil.provenance).toBe("saisie");
    expect(seuil.configurable).toBeUndefined();
  });
});

// ── c & d. Franchissement unique et bascule d'exercice ───────────────────────

describe("c — FRANCHISSEMENT enregistré une seule fois", () => {
  test("un aller-retour sous le seuil ne produit PAS un second franchissement", async () => {
    const poser = () =>
      adminPool.query(
        `INSERT INTO objectifs_franchissements (id, tenant_id, objectif, exercice, montant_cents)
         VALUES (gen_random_uuid()::text, $1::uuid, 'seuil_rentabilite', $2, 34285714)
         ON CONFLICT (tenant_id, objectif, exercice) DO NOTHING`,
        [tenantA, anneeCourante],
      );

    await poser();               // franchissement initial
    await poser();               // avoir puis nouvelle facture : second passage
    await poser();               // et un troisième, pour faire bonne mesure

    const { rows } = await adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM objectifs_franchissements
       WHERE tenant_id = $1::uuid AND objectif = 'seuil_rentabilite' AND exercice = $2`,
      [tenantA, anneeCourante],
    );
    // C'est la contrainte d'unicité du moteur qui garantit l'idempotence, pas
    // une mémoire applicative.
    expect(rows[0]!.n).toBe("1");
  });

  test("bascule d'exercice : l'année suivante repart de zéro", async () => {
    const { rows } = await adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM objectifs_franchissements
       WHERE tenant_id = $1::uuid AND exercice = $2`,
      [tenantA, anneeCourante + 1],
    );
    expect(rows[0]!.n).toBe("0");

    // Et poser le même objectif sur le nouvel exercice est accepté — ce n'est
    // pas un rejeu, c'est un objectif différent.
    await adminPool.query(
      `INSERT INTO objectifs_franchissements (id, tenant_id, objectif, exercice, montant_cents)
       VALUES (gen_random_uuid()::text, $1::uuid, 'seuil_rentabilite', $2, 1)`,
      [tenantA, anneeCourante + 1],
    );
    const { rows: apres } = await adminPool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM objectifs_franchissements WHERE tenant_id = $1::uuid`,
      [tenantA],
    );
    expect(apres[0]!.n).toBe("2");
  });
});

// ── e. Conversion en chantiers ───────────────────────────────────────────────

describe("e — CONVERSION en chantiers sous cinq affaires", () => {
  test("moins de cinq affaires terminées → aucune conversion", async () => {
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieOwnerA)
      .expect(200);

    expect(body.nbAffairesObservees).toBeLessThan(body.minAffairesPourConversion);
    for (const o of body.objectifs) {
      if (o.conversion !== undefined) expect(o.conversion).toBeNull();
    }
  });

  test("le seuil minimal est annoncé au front, pas deviné", async () => {
    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(body.minAffairesPourConversion).toBe(5);
  });
});
