/*
 * Aucune réparation facturée sans accord préalable — US-B6.4.
 *
 * ── Pourquoi ce fichier, alors que le mécanisme existait déjà ─────────────
 * La story le dit elle-même : « s'appuie directement sur le mécanisme
 * d'acceptation publique de devis déjà existant côté bâtiment, transposé tel
 * quel ». C'est vrai — `facturerDevis` refuse tout devis qui n'est pas
 * ACCEPTE, et l'acceptation publique est éprouvée par douze tests.
 *
 * Mais le REFUS, lui, n'était prouvé nulle part. Or c'est le deuxième critère
 * d'acceptation, et c'est le seul qui protège le client : « étant donné
 * l'absence d'accord, alors aucune facturation de travaux ne peut être émise ».
 *
 * La règle 7 du dépôt tranche ce cas exactement : une garde structurelle qu'on
 * n'a jamais vue se déclencher n'est pas une garde. Un garagiste qui facture
 * une réparation non autorisée s'expose à un litige qu'il perd — et le code
 * qui l'en empêchait n'avait jamais été mis à l'épreuve.
 *
 * ── Le forfait de diagnostic, nommé plutôt que sous-entendu ───────────────
 * Le critère porte une exception entre parenthèses : « hors éventuel forfait
 * de diagnostic ». Un réparateur DOIT pouvoir facturer son diagnostic quand le
 * client refuse la réparation — c'est souvent son seul revenu sur ce dossier.
 * Le dernier bloc vérifie que ce chemin reste ouvert.
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
  const email = `rep-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Garage ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

/** Un devis de réparation, dans le statut voulu. */
async function devisReparation(
  tenantId: string, status: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    // `total_ttc_cents` est POSÉ, et c'est essentiel : `facturerDevis`
    // compare ce qu'il s'apprête à facturer au montant accepté, et refuse en
    // cas d'écart. Un fixture qui le laisse à zéro fait répondre cette
    // garde-là au lieu de celle qu'on éprouve.
    `INSERT INTO devis (id, tenant_id, reference, client_name, status, lines,
                        tva_rate, remise, accepted_at, total_ht_cents, total_ttc_cents)
     VALUES ($1, $2::uuid, 'DEV-REP-1', 'Madame Martin', $3,
             $4::jsonb, 20, 0, $5, 34000, 40800)`,
    [id, tenantId, status, JSON.stringify([{
      id: crypto.randomUUID(),
      description: "Remplacement du limiteur de couple",
      quantity: 1, unitPriceCents: 34_000,
    }]), status === "ACCEPTE" ? new Date() : null],
  );
  return id;
}

const facturer = (cookie: string, devisId: string) =>
  request(serveurTest(app)).post(`/api/devis/${devisId}/facturer`).set("Cookie", cookie);

afterAll(async () => {
  // Les FACTURES d'abord : `factures.devis_id` référence `devis`, et l'ordre
  // inverse fait échouer le nettoyage sur une violation de clé étrangère —
  // sans qu'aucun test ne soit rouge, ce qui rend l'échec facile à mal lire.
  await adminPool.query(`DELETE FROM factures WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await adminPool.query(`DELETE FROM devis WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("sans accord du client, la réparation ne se facture pas", () => {
  // Tous les statuts par lesquels un devis passe AVANT l'accord — et celui
  // qu'il prend quand le client dit non. Aucun ne doit produire de facture.
  test.each(["BROUILLON", "ENVOYE", "REFUSE", "EXPIRE"])(
    "un devis en %s est refusé à la facturation",
    async (statut) => {
      const t = await inscrire(`st-${statut.toLowerCase()}`);
      const d = await devisReparation(t.tenantId, statut);

      const { body } = await facturer(t.cookie, d).expect(422);
      expect(body.error).toMatch(/Seul un devis accepté se facture/);

      // Et surtout : RIEN n'a été créé. Un refus qui laisserait un brouillon
      // derrière lui serait pire qu'un accord — l'artisan le trouverait plus
      // tard, sans savoir qu'il n'a jamais été autorisé.
      const { rows } = await adminPool.query(
        "SELECT count(*)::int AS n FROM factures WHERE devis_id = $1", [d],
      );
      expect(rows[0].n).toBe(0);
    },
  );

  test("le refus DIT dans quel état est le devis", async () => {
    // « Non autorisé » sans plus laisse chercher. Nommer l'état dit quoi
    // faire : le devis est encore en brouillon, il faut l'envoyer.
    const t = await inscrire("message");
    const d = await devisReparation(t.tenantId, "BROUILLON");

    const { body } = await facturer(t.cookie, d).expect(422);
    expect(body.error).toContain("BROUILLON");
  });
});

describe("avec l'accord, la facturation passe", () => {
  test("un devis ACCEPTE produit une facture au montant du devis", async () => {
    // Le pendant indispensable : une garde qui refuserait TOUT passerait les
    // tests ci-dessus sans protéger personne.
    const t = await inscrire("accepte");
    const d = await devisReparation(t.tenantId, "ACCEPTE");

    const { body } = await facturer(t.cookie, d).expect(201);
    expect(body.totalHTCents).toBe(34_000);
    expect(body.statut).toBe("BROUILLON");
    expect(body.number).toBe("");
  });

  test("refacturer le même devis rend la MÊME facture, pas une seconde", async () => {
    const t = await inscrire("idem");
    const d = await devisReparation(t.tenantId, "ACCEPTE");

    const premier = await facturer(t.cookie, d).expect(201);
    const second = await facturer(t.cookie, d).expect(200);
    expect(second.body.id).toBe(premier.body.id);
  });
});

describe("le forfait de diagnostic reste facturable", () => {
  test("une facture directe n'est PAS bloquée par le refus du devis", async () => {
    // L'exception du critère : « hors éventuel forfait de diagnostic ». Un
    // réparateur doit pouvoir facturer son diagnostic quand le client refuse
    // la réparation — c'est souvent son seul revenu sur ce dossier. La garde
    // porte sur la conversion d'un devis, pas sur le droit de facturer.
    const t = await inscrire("diag");
    const d = await devisReparation(t.tenantId, "REFUSE");
    await facturer(t.cookie, d).expect(422);

    const { body } = await request(serveurTest(app))
      .post("/api/factures").set("Cookie", t.cookie)
      .send({
        customerName: "Madame Martin",
        issuedDate: "2026-08-24",
        dueDate: "2026-09-23",
        lines: [{ description: "Forfait de diagnostic", quantity: 1, unitPriceCents: 4_500, vatRate: 20 }],
      })
      .expect(201);

    expect(body.totalHTCents).toBe(4_500);
    // Elle ne se rattache à aucun devis : c'est une facture à part entière.
    expect(body.devisId ?? null).toBeNull();
  });
});
