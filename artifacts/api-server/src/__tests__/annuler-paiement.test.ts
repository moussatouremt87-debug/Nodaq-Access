/**
 * Annuler un « marquer comme payée » — ticket 4.26.
 *
 * Verbatim du test du 22/08 : « J'ai cliqué sur "marquer comme payée" par
 * accident mais je n'ai pas de moyen de revenir en arrière. »
 *
 * Une action qui change un état FINANCIER et qu'on ne peut pas défaire
 * transforme un geste de trop en écriture fausse définitive.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
} from "./helpers.js";

interface Locataire { tenantId: string; cookie: string }

const tenantIds: string[] = [];
const emails: string[] = [];

async function inscrire(nom: string): Promise<Locataire> {
  const email = `annul-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: `Annul ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  const cookie = headers["set-cookie"][0];
  // Sans SIRET ni raison sociale, l'émission refuse — l'audit des mentions
  // obligatoires fait son travail. On passe par la vraie route de paramètres,
  // comme le fait `facturation.test.ts`.
  await request(app)
    .patch("/api/parametres")
    .set("Cookie", cookie)
    .send({ "company.siret": "81234567600009", "company.raison_sociale": "Annul SARL" })
    .expect(200);
  return { tenantId: body.tenantId, cookie };
}

/**
 * Une facture ÉMISE, par le vrai chemin. Rend son id ET son total TTC.
 *
 * TVA à 20 % et non à 0 : une facture sans TVA exige une mention justificative
 * (art. 293 B du CGI ou autoliquidation), et l'audit Factur-X refuse de
 * l'émettre sans elle. Il a raison — c'est mon raccourci qui était faux.
 */
async function factureEmise(
  l: Locataire,
  htCents: number,
): Promise<{ id: string; ttc: number }> {
  const { body } = await request(app)
    .post("/api/factures")
    .set("Cookie", l.cookie)
    .send({
      customerName: "Delacroix",
      issuedDate: "2026-08-01",
      dueDate: "2026-09-01",
      lines: [{ description: "Pose", quantity: 1, unitPriceCents: htCents, vatRate: 20, vatCategory: "S" }],
    })
    .expect(201);
  // `.send({})` et non rien : sans corps, `EmettreBody.safeParse(undefined)`
  // échoue et la route rend 400 avant même de regarder la facture.
  await request(app).post(`/api/factures/${body.id}/emettre`).set("Cookie", l.cookie).send({}).expect(200);
  return { id: body.id, ttc: body.amountCents as number };
}

/**
 * Le solde NET encaissé, contre-passations comprises.
 *
 * Même calcul qu'`encaisseSurFacture` : `paiements` est en ajout seul (voir
 * `APPEND_ONLY_TABLES`), donc une annulation est une écriture en sens inverse,
 * jamais une suppression. Compter les seuls ENCAISSEMENT ferait croire que
 * rien n'a été annulé.
 */
const solde = async (id: string): Promise<number> => {
  const { rows } = await adminPool.query(
    `SELECT coalesce(sum(CASE WHEN sens = 'ENCAISSEMENT' THEN montant_cents
                              ELSE -montant_cents END), 0)::int AS n
       FROM paiements WHERE facture_id = $1`, [id],
  );
  return rows[0].n as number;
};

const statut = async (id: string): Promise<string> => {
  const { rows } = await adminPool.query(`SELECT statut FROM factures WHERE id = $1`, [id]);
  return rows[0].statut as string;
};

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("a — le geste de trop se défait", () => {
  let t: Locataire;
  beforeAll(async () => { t = await inscrire("base"); }, 90_000);

  test("payé par erreur → annulé → la facture redevient ÉMISE, sans règlement", async () => {
    const { id, ttc } = await factureEmise(t, 100000);
    await request(app).post(`/api/factures/${id}/payer`).set("Cookie", t.cookie).expect(200);
    expect(await statut(id)).toBe("PAYEE");
    expect(await solde(id)).toBe(ttc);

    const { body } = await request(app)
      .post(`/api/factures/${id}/annuler-paiement`).set("Cookie", t.cookie).expect(200);

    expect(body.montantAnnuleCents).toBe(ttc);
    // Le statut n'est pas écrit à la main : il est REDÉDUIT du journal.
    expect(await statut(id)).toBe("EMISE");
    // Solde net à zéro — et non « la ligne a disparu » : le journal est en
    // ajout seul, la correction est une écriture en sens inverse.
    expect(await solde(id)).toBe(0);

    // Les DEUX écritures sont là, et la seconde désigne la première.
    const { rows } = await adminPool.query(
      `SELECT id, sens, reference FROM paiements WHERE facture_id = $1 ORDER BY created_at`, [id],
    );
    expect(rows.map((r: { sens: string }) => r.sens)).toEqual(["ENCAISSEMENT", "ANNULATION"]);
    // La seconde écriture DÉSIGNE la première : c'est ce lien qui rend le
    // journal relisable et l'annulation non rejouable.
    expect(rows[1].reference).toBe(`annulation:${rows[0].id}`);
  });

  test("deux clics d’annulation n’annulent pas deux fois", async () => {
    const { id, ttc } = await factureEmise(t, 40000);
    await request(app).post(`/api/factures/${id}/payer`).set("Cookie", t.cookie).expect(200);
    await request(app).post(`/api/factures/${id}/annuler-paiement`).set("Cookie", t.cookie).expect(200);
    // Sans le lien par `reference`, le second clic contre-passerait le même
    // règlement une seconde fois et creuserait un solde NÉGATIF.
    await request(app).post(`/api/factures/${id}/annuler-paiement`).set("Cookie", t.cookie).expect(409);
    expect(await solde(id)).toBe(0);
    expect(ttc).toBeGreaterThan(0);
  });

  test("la trace dit qui, quoi, et l’état avant → après", async () => {
    const { id } = await factureEmise(t, 50000);
    await request(app).post(`/api/factures/${id}/payer`).set("Cookie", t.cookie).expect(200);
    await request(app).post(`/api/factures/${id}/annuler-paiement`).set("Cookie", t.cookie).expect(200);

    const { rows } = await adminPool.query(
      `SELECT label, meta FROM activity
        WHERE tenant_id = $1 AND type = 'facture_paiement_annule'
        ORDER BY created_at DESC LIMIT 1`, [t.tenantId],
    );
    expect(rows).toHaveLength(1);
    // 500 € HT + 20 % = 600,00 € encaissés.
    expect(rows[0].meta).toContain("600.00 €");
    expect(rows[0].meta).toContain("PAYEE → EMISE");
    expect(rows[0].meta).toContain("@test.nodaq");
  });
});

describe("b — on ne défait QUE le geste de trop", () => {
  test("un acompte réellement versé n’est pas emporté", async () => {
    const t = await inscrire("acompte");
    const { id, ttc } = await factureEmise(t, 100000);

    // Le client a vraiment versé 300 € — cette ligne-là est vraie.
    await adminPool.query(
      `INSERT INTO paiements (id, tenant_id, facture_id, date, montant_cents, sens, moyen, nature)
       VALUES ($1, $2::uuid, $3, current_date, 30000, 'ENCAISSEMENT', 'CHEQUE', 'ACOMPTE')`,
      [crypto.randomUUID(), t.tenantId, id],
    );
    // Puis on clique « payée » par erreur : le reste dû s'inscrit.
    await request(app).post(`/api/factures/${id}/payer`).set("Cookie", t.cookie).expect(200);
    expect(await solde(id)).toBe(ttc);

    await request(app).post(`/api/factures/${id}/annuler-paiement`).set("Cookie", t.cookie).expect(200);

    // Effacer TOUS les règlements serait une seconde erreur pour en corriger
    // une première : l'acompte est un fait, il reste.
    expect(await solde(id)).toBe(30000);
    expect(await statut(id)).toBe("EMISE");
  });
});

describe("c — les refus", () => {
  let t: Locataire;
  beforeAll(async () => { t = await inscrire("refus"); }, 90_000);

  test("rien à annuler → 409, et aucune écriture", async () => {
    const { id } = await factureEmise(t, 10000);
    await request(app)
      .post(`/api/factures/${id}/annuler-paiement`).set("Cookie", t.cookie).expect(409);
    expect(await statut(id)).toBe("EMISE");
  });

  test("facture inconnue → 404", async () => {
    await request(app)
      .post(`/api/factures/${crypto.randomUUID()}/annuler-paiement`)
      .set("Cookie", t.cookie).expect(404);
  });

  test("une facture annulée par avoir ne se dépaye pas", async () => {
    const { id, ttc } = await factureEmise(t, 20000);
    await request(app).post(`/api/factures/${id}/payer`).set("Cookie", t.cookie).expect(200);
    // L'avoir est le document qui fait foi ; toucher au règlement ici
    // casserait la chaîne comptable.
    await adminPool.query(`UPDATE factures SET statut = 'ANNULEE_PAR_AVOIR' WHERE id = $1`, [id]);

    await request(app)
      .post(`/api/factures/${id}/annuler-paiement`).set("Cookie", t.cookie).expect(409);
    expect(await solde(id)).toBe(ttc);
  });
});

describe("d — isolation : on n'annule pas le règlement du voisin", () => {
  test("un autre tenant ne peut pas dépayer cette facture", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    const { id, ttc } = await factureEmise(a, 70000);
    await request(app).post(`/api/factures/${id}/payer`).set("Cookie", a.cookie).expect(200);

    // La RLS ne rend pas la ligne : pour B, cette facture n'existe pas.
    await request(app)
      .post(`/api/factures/${id}/annuler-paiement`).set("Cookie", b.cookie).expect(404);
    expect(await solde(id)).toBe(ttc);
  });
});
