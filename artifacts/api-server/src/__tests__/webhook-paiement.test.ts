/**
 * Le webhook de paiement Bridge — ticket 4.19, lot D.
 *
 * C'est le SEUL endroit du produit où un encaissement s'écrit sans qu'un
 * humain le saisisse. Ce que ces tests protègent, par ordre de gravité :
 *
 *   a. rien ne s'écrit sans SIGNATURE valide — un webhook de paiement ouvert,
 *      c'est un inconnu qui déclare des règlements dans la comptabilité d'un
 *      artisan ;
 *   b. le TENANT vient de la ligne, jamais du payload ;
 *   c. l'IDEMPOTENCE : Bridge rejoue, `paiements` est append-only, et un
 *      doublon serait un encaissement qui n'a jamais eu lieu ;
 *   d. un lien NON terminal n'écrit rien — « en cours » n'est pas « payé » ;
 *   e. le montant écrit est celui FIGÉ à l'émission, pas un montant du payload.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

const SECRET = "secret-webhook-paiement-test";
const MONTANT = 42_800;

const tenantIds: string[] = [];
const emails: string[] = [];
let tenantId: string;
let campagneId: string;

/**
 * Signature calculée sur la chaîne EXACTE envoyée : le corps est passé en
 * `.send(chaîne)` et non en objet, sinon les octets signés et ceux reçus
 * divergeraient silencieusement. Même patron que banque-connexion.test.ts.
 */
function signer(corps: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret).update(corps).digest("hex");
  return `t=${Date.now()},v1=${hmac}`;
}

/** Un lien de paiement EMIS, prêt à recevoir son retour de webhook. */
async function lienEmis(): Promise<string> {
  const appelId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO appels_relance (id, tenant_id, campagne_id, facture_id, empreinte_numero, statut)
     VALUES ($1, $2::uuid, $3, 'F-WH', $4, 'TERMINE')`,
    [appelId, tenantId, campagneId, `emp-${appelId}`],
  );
  const lienId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO liens_paiement
       (id, tenant_id, appel_id, facture_id, empreinte_numero, montant_cents, statut, bridge_link_id)
     VALUES ($1, $2::uuid, $3, 'F-WH', $4, $5, 'EMIS', $6)`,
    [lienId, tenantId, appelId, `emp-${lienId}`, MONTANT, `pl-${lienId}`],
  );
  return lienId;
}

const evenementPaye = (reference: string, transactionId = `tx-${reference}`) =>
  JSON.stringify({
    type: "payment.link.updated",
    content: {
      payment_link_id: `pl-${reference}`,
      payment_link_status: "completed",
      payment_link_client_reference: reference,
      payment_status: "initiated_in_success",
      payment_transaction_id: transactionId,
    },
  });

const poster = (corps: string, secret: string | null) => {
  const requete = request(app).post("/api/webhooks/paiement").set("Content-Type", "application/json");
  if (secret) requete.set("BridgeApi-Signature", signer(corps, secret));
  return requete.send(corps);
};

/** Les lignes de `paiements` écrites pour un lien donné. */
async function paiementsDuLien(lienId: string) {
  const { rows } = await adminPool.query(
    `SELECT montant_cents, sens, moyen, facture_id FROM paiements WHERE reference = $1`,
    [`lien-paiement:${lienId}`],
  );
  return rows;
}

beforeAll(async () => {
  const email = `wh-paiement-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Webhook SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);

  campagneId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO campagnes_relance (id, tenant_id, pending_action_id, mandat)
     VALUES ($1, $2::uuid, 'pa-wh', '{}'::jsonb)`,
    [campagneId, tenantId],
  );
}, 120_000);

beforeEach(() => {
  process.env["BRIDGE_PAYMENT_WEBHOOK_SECRET"] = SECRET;
});

afterEach(() => {
  delete process.env["BRIDGE_PAYMENT_WEBHOOK_SECRET"];
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. Sans signature valide, rien ─────────────────────────────────────────

describe("a — la signature commande, et elle est vérifiée AVANT toute lecture", () => {
  test("signature absente → 401, et aucun encaissement", async () => {
    const lienId = await lienEmis();
    await poster(evenementPaye(lienId), null).expect(401);
    expect(await paiementsDuLien(lienId)).toHaveLength(0);
  });

  test("signature calculée avec le MAUVAIS secret → 401", async () => {
    const lienId = await lienEmis();
    await poster(evenementPaye(lienId), "pas-le-bon-secret").expect(401);
    expect(await paiementsDuLien(lienId)).toHaveLength(0);
  });

  test("corps modifié après signature → 401", async () => {
    // Le point : la signature porte sur les octets BRUTS. Un montant réécrit
    // en vol doit invalider la signature.
    const lienId = await lienEmis();
    const corps = evenementPaye(lienId);
    const entete = signer(corps, SECRET);
    await request(app)
      .post("/api/webhooks/paiement")
      .set("Content-Type", "application/json")
      .set("BridgeApi-Signature", entete)
      .send(corps.replace("completed", "complete_"))
      .expect(401);
    expect(await paiementsDuLien(lienId)).toHaveLength(0);
  });

  test("secret non configuré → 503, jamais un 500", async () => {
    delete process.env["BRIDGE_PAYMENT_WEBHOOK_SECRET"];
    const lienId = await lienEmis();
    await poster(evenementPaye(lienId), SECRET).expect(503);
  });
});

// ── b. Le chemin nominal ───────────────────────────────────────────────────

describe("b — un lien réglé écrit l'encaissement, une fois", () => {
  test("le paiement est écrit avec le montant FIGÉ à l'émission", async () => {
    const lienId = await lienEmis();
    const r = await poster(evenementPaye(lienId), SECRET).expect(200);
    expect(r.body.traite).toBe(true);

    const lignes = await paiementsDuLien(lienId);
    expect(lignes).toHaveLength(1);
    // Le montant vient de NOTRE ligne, pas du payload — un webhook qui
    // dicterait le montant encaissé serait un webhook qui écrit la compta.
    expect(lignes[0].montant_cents).toBe(MONTANT);
    expect(lignes[0].sens).toBe("ENCAISSEMENT");
    expect(lignes[0].moyen).toBe("VIREMENT");
    expect(lignes[0].facture_id).toBe("F-WH");

    const { rows } = await adminPool.query(
      `SELECT statut, paye_le, bridge_transaction_id FROM liens_paiement WHERE id = $1`,
      [lienId],
    );
    expect(rows[0].statut).toBe("PAYE");
    expect(rows[0].paye_le).not.toBeNull();
  });

  test("REJEU du même événement : aucun second encaissement", async () => {
    // Bridge rejoue. `paiements` est append-only : un doublon serait un
    // encaissement qui n'a jamais eu lieu, et il fausserait la trésorerie.
    const lienId = await lienEmis();
    await poster(evenementPaye(lienId), SECRET).expect(200);
    const r2 = await poster(evenementPaye(lienId), SECRET).expect(200);

    expect(r2.body.deja).toBe(true);
    expect(await paiementsDuLien(lienId)).toHaveLength(1);
  });
});

// ── c. Ce qui n'écrit rien ─────────────────────────────────────────────────

describe("c — tout ce qui n'est pas un règlement abouti est accusé sans rien écrire", () => {
  test("un lien encore en cours n'est PAS un encaissement", async () => {
    const lienId = await lienEmis();
    const corps = JSON.stringify({
      type: "payment.link.updated",
      content: {
        payment_link_client_reference: lienId,
        payment_link_status: "pending",
        payment_status: "initiated",
      },
    });
    const r = await poster(corps, SECRET).expect(200);
    expect(r.body.traite).toBe(false);
    expect(await paiementsDuLien(lienId)).toHaveLength(0);
  });

  test("un autre type d'événement est accusé en 200 — jamais en erreur", async () => {
    // Un webhook qui répond en erreur est un webhook que Bridge rejoue,
    // puis désactive au bout de N échecs. On accuse, on n'agit pas.
    const lienId = await lienEmis();
    const corps = JSON.stringify({
      type: "payment.transaction.created",
      content: { client_reference: lienId, payment_transaction_id: "tx-1" },
    });
    const r = await poster(corps, SECRET).expect(200);
    expect(r.body.traite).toBe(false);
    expect(await paiementsDuLien(lienId)).toHaveLength(0);
  });

  test("référence inconnue → accusée, sans confirmer qu'elle est inconnue", async () => {
    const r = await poster(evenementPaye(crypto.randomUUID()), SECRET).expect(200);
    expect(r.body.traite).toBe(false);
  });
});

// ── d. Ce que le webhook NE touche PAS ─────────────────────────────────────

describe("d — l'issue de l'appel n'est pas réécrite par un paiement", () => {
  test("l'appel garde l'issue de la CONVERSATION", async () => {
    // `ISSUES_APPEL` ne connaît que `paid_claimed` — « la personne DIT avoir
    // payé ». Un virement confirmé est plus fort : le dégrader en « déclaré »
    // serait mentir dans l'autre sens. La vérité de l'encaissement vit dans
    // `paiements`, table comptable ; l'appel décrit la conversation.
    const lienId = await lienEmis();
    const { rows: avant } = await adminPool.query(
      `SELECT issue FROM appels_relance WHERE id = (SELECT appel_id FROM liens_paiement WHERE id = $1)`,
      [lienId],
    );
    await poster(evenementPaye(lienId), SECRET).expect(200);
    const { rows: apres } = await adminPool.query(
      `SELECT issue FROM appels_relance WHERE id = (SELECT appel_id FROM liens_paiement WHERE id = $1)`,
      [lienId],
    );
    expect(apres[0].issue).toBe(avant[0].issue);
  });
});
