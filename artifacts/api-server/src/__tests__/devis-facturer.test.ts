/**
 * Facturer un devis accepté — ticket 4.21.
 *
 * Une facture est un document opposable à un client. Ce que ces tests
 * protègent, par ordre de gravité :
 *
 *   a. LA FACTURE VAUT LE DEVIS, au centime. Un devis applique sa remise au
 *      sous-total, une facture calcule ligne par ligne : reporter l'un dans
 *      l'autre sans vérifier, c'est facturer un autre montant que celui qui a
 *      été accepté ;
 *   b. un devis ne se facture QU'UNE FOIS — et c'est le moteur qui le tient ;
 *   c. la facture naît en BROUILLON, sans numéro : la numérotation appartient
 *      à l'émission, et un brouillon numéroté trouerait la séquence ;
 *   d. seul un devis ACCEPTÉ se facture.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie: string;
let tenantId: string;

/** Un devis, dans le statut demandé, avec ses totaux calculés par la route. */
async function devis(options: {
  lignes: Array<{ description: string; quantity: number; unitPriceCents: number }>;
  remise?: number;
  statut?: string;
}): Promise<{ id: string; totalTTCCents: number }> {
  const { body } = await request(app)
    .post("/api/devis")
    .set("Cookie", cookie)
    .send({
      clientName: "Delacroix",
      lines: options.lignes,
      tvaRate: 20,
      remise: options.remise ?? 0,
    })
    .expect(201);

  if (options.statut) {
    await adminPool.query(`UPDATE devis SET status = $1 WHERE id = $2`, [options.statut, body.id]);
  }
  return { id: body.id, totalTTCCents: body.totalTTCCents };
}

const facturer = (id: string) =>
  request(app).post(`/api/devis/${id}/facturer`).set("Cookie", cookie);

beforeAll(async () => {
  const email = `facturer-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Facturer SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
  cookie = reg.headers["set-cookie"][0];
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. La facture vaut le devis ────────────────────────────────────────────

describe("a — au centime près, ou rien", () => {
  test("sans remise : le total de la facture EST celui du devis", async () => {
    const d = await devis({
      lignes: [
        { description: "Pose carrelage", quantity: 10, unitPriceCents: 4500 },
        { description: "Fourniture", quantity: 1, unitPriceCents: 32000 },
      ],
      statut: "ACCEPTE",
    });

    const { body: facture } = await facturer(d.id).expect(201);
    expect(facture.amountCents).toBe(d.totalTTCCents);
    expect(facture.lines).toHaveLength(2);
  });

  test("avec remise : la remise est reportée sur chaque prix unitaire", async () => {
    // 10 % sur 450 € : chaque ligne descend, et le total suit exactement.
    const d = await devis({
      lignes: [{ description: "Pose", quantity: 10, unitPriceCents: 4500 }],
      remise: 10,
      statut: "ACCEPTE",
    });

    const { body: facture } = await facturer(d.id).expect(201);
    expect(facture.amountCents).toBe(d.totalTTCCents);
    expect(facture.lines[0].unitPriceCents).toBe(4050);
  });

  test("un écart d'arrondi REFUSE la facturation, et ne crée rien", async () => {
    // Le cas que la garde existe pour attraper : une remise qui ne tombe pas
    // juste ligne par ligne. Mieux vaut refuser que produire un document
    // opposable qui ne vaut pas ce qui a été signé.
    const d = await devis({
      lignes: [
        { description: "A", quantity: 1, unitPriceCents: 3333 },
        { description: "B", quantity: 1, unitPriceCents: 6667 },
      ],
      remise: 7,
      statut: "ACCEPTE",
    });

    const r = await facturer(d.id);
    if (r.status === 422) {
      expect(r.body.error).toMatch(/ne vaudrait pas le devis/i);
      const { rows } = await adminPool.query(
        `SELECT count(*)::int AS n FROM factures WHERE devis_id = $1`, [d.id],
      );
      expect(rows[0].n).toBe(0);
    } else {
      // Si l'arrondi tombe juste, la facture DOIT valoir le devis — c'est la
      // même exigence, vérifiée par l'autre chemin.
      expect(r.status).toBe(201);
      expect(r.body.amountCents).toBe(d.totalTTCCents);
    }
  });
});

// ── b. Une seule fois ──────────────────────────────────────────────────────

describe("b — un devis ne se facture qu'une fois", () => {
  test("deuxième appel → la MÊME facture, pas une seconde", async () => {
    const d = await devis({
      lignes: [{ description: "Pose", quantity: 1, unitPriceCents: 10000 }],
      statut: "ACCEPTE",
    });

    const { body: premiere } = await facturer(d.id).expect(201);
    const { body: seconde } = await facturer(d.id).expect(200);
    expect(seconde.id).toBe(premiere.id);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM factures WHERE devis_id = $1`, [d.id],
    );
    expect(rows[0].n).toBe(1);
  });

  test("l'unicité est tenue par le MOTEUR, pas par le contrôle applicatif", async () => {
    // Deux requêtes simultanées lisent toutes les deux « pas encore facturé ».
    // Sans l'index unique de la migration 049, les deux écriraient.
    const d = await devis({
      lignes: [{ description: "Pose", quantity: 1, unitPriceCents: 10000 }],
      statut: "ACCEPTE",
    });
    const { body: f } = await facturer(d.id).expect(201);

    await expect(
      adminPool.query(
        `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents, statut, lines, issued_date, due_date, devis_id)
         VALUES ($1, $2::uuid, '', 'Delacroix', 100, 'BROUILLON', '[]'::jsonb, CURRENT_DATE, CURRENT_DATE, $3)`,
        [crypto.randomUUID(), tenantId, d.id],
      ),
    ).rejects.toThrow(/unique/i);

    expect(f.devisId).toBe(d.id);
  });
});

// ── c. Un brouillon, jamais une émission ───────────────────────────────────

describe("c — facturer n'est pas émettre", () => {
  test("la facture naît en BROUILLON, sans numéro", async () => {
    const d = await devis({
      lignes: [{ description: "Pose", quantity: 1, unitPriceCents: 10000 }],
      statut: "ACCEPTE",
    });
    const { body: facture } = await facturer(d.id).expect(201);

    // Le numéro séquentiel est attribué à l'ÉMISSION : un brouillon numéroté
    // trouerait la séquence s'il était supprimé.
    expect(facture.statut).toBe("BROUILLON");
    expect(facture.number).toBe("");
  });
});

// ── d. Ce qui se facture, et ce qui ne se facture pas ──────────────────────

describe("d — seul un devis accepté se facture", () => {
  test.each(["BROUILLON", "ENVOYE", "REFUSE"])("statut %s → 422, rien créé", async (statut) => {
    const d = await devis({
      lignes: [{ description: "Pose", quantity: 1, unitPriceCents: 10000 }],
      statut,
    });

    const r = await facturer(d.id).expect(422);
    expect(r.body.error).toMatch(/accept/i);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM factures WHERE devis_id = $1`, [d.id],
    );
    expect(rows[0].n).toBe(0);
  });

  test("devis inconnu → 404", async () => {
    await facturer(crypto.randomUUID()).expect(404);
  });

  test("devis accepté SANS ligne → 422, il n'y a rien à facturer", async () => {
    const d = await devis({ lignes: [], statut: "ACCEPTE" });
    const r = await facturer(d.id).expect(422);
    expect(r.body.error).toMatch(/aucune ligne/i);
  });
});
