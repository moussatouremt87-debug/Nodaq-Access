/*
 * Facturer une mission ponctuelle à son terme — US-B8.1.
 *
 * ── Le trou que ce lot comble ─────────────────────────────────────────────
 * Le produit savait facturer un DEVIS accepté, et depuis US-A2.3 un CONTRAT
 * récurrent. Entre les deux, rien : une mission menée sans devis — une course,
 * un déménagement, une intervention convenue au téléphone — n'avait aucun
 * chemin vers une facture. Pour un transporteur qui fait cinq courses par
 * jour, retaper chaque facture EST le métier.
 *
 * ── Le risque principal n'est pas l'absence, c'est le DOUBLON ─────────────
 * Contrairement aux contrats, on ne peut pas confier l'unicité au moteur : une
 * affaire porte légitimement plusieurs factures (acompte, situations, solde).
 * La protection est donc applicative — refus par défaut, seconde facture
 * possible mais VOULUE — et c'est précisément le genre de garde qu'il faut
 * éprouver plutôt que supposer.
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
  const email = `mis-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Transport ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

async function mission(
  tenantId: string,
  opts: { montant?: number | null; label?: string; status?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO affaires (id, tenant_id, label, client_name, status, montant_vendu_ht)
     VALUES ($1, $2::uuid, $3, 'Transports Delacroix', $4, $5)`,
    [id, tenantId, opts.label ?? "Livraison Lyon — Marseille",
     opts.status ?? "TERMINEE", opts.montant === undefined ? 48_000 : opts.montant],
  );
  return id;
}

/** Un devis accepté rattaché à la mission. */
async function devisAccepte(tenantId: string, affaireId: string, htCents: number): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO devis (id, tenant_id, reference, client_name, status, lines, tva_rate,
                        remise, accepted_at, affaire_id, total_ht_cents, total_ttc_cents)
     VALUES ($1, $2::uuid, 'DEV-MIS', 'Transports Delacroix', 'ACCEPTE', $3::jsonb, 20, 0,
             now(), $4, $5, $6)`,
    [id, tenantId, JSON.stringify([{
      id: crypto.randomUUID(), description: "Déménagement 3 pièces",
      quantity: 1, unitPriceCents: htCents,
    }]), affaireId, htCents, Math.round(htCents * 1.2)],
  );
  return id;
}

const facturer = (cookie: string, affaireId: string, corps: Record<string, unknown> = {}) =>
  request(serveurTest(app)).post(`/api/affaires/${affaireId}/facturer`)
    .set("Cookie", cookie).send(corps);

afterAll(async () => {
  // Les factures d'abord — elles référencent devis ET affaires.
  await adminPool.query(`DELETE FROM factures WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await adminPool.query(`DELETE FROM devis WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("une mission sans devis se facture depuis son montant vendu", () => {
  test("une course terminée devient une facture en un geste", async () => {
    const t = await inscrire("course");
    const m = await mission(t.tenantId, { montant: 48_000 });

    const { body } = await facturer(t.cookie, m).expect(201);
    expect(body.source).toBe("montant_vendu");
    expect(body.facture.totalHTCents).toBe(48_000);
    expect(body.facture.totalTVACents).toBe(9_600);
    expect(body.facture.affaireId).toBe(m);
  });

  test("le libellé de la mission devient celui de la ligne", async () => {
    // Cinq courses le même jour ne se distinguent que par là.
    const t = await inscrire("libelle");
    const m = await mission(t.tenantId, { label: "Livraison Lyon — Marseille" });

    const { body } = await facturer(t.cookie, m).expect(201);
    expect(body.facture.lines[0].description).toBe("Livraison Lyon — Marseille");
  });

  test("elle naît en BROUILLON, sans numéro", async () => {
    // Générer n'est pas émettre : le numéro séquentiel et l'archive PDF
    // appartiennent à l'émission, qui reste un geste délibéré.
    const t = await inscrire("brouillon");
    const m = await mission(t.tenantId);

    const { body } = await facturer(t.cookie, m).expect(201);
    expect(body.facture.statut).toBe("BROUILLON");
    expect(body.facture.number).toBe("");
  });

  test("elle entre au Classeur", async () => {
    const t = await inscrire("classeur");
    const m = await mission(t.tenantId);
    const { body } = await facturer(t.cookie, m).expect(201);

    const { rows } = await adminPool.query(
      "SELECT source_id FROM classeur_documents WHERE tenant_id = $1 AND source_type = 'FACTURE'",
      [t.tenantId],
    );
    expect(rows.map((r) => r.source_id)).toContain(body.facture.id);
  });
});

describe("un devis accepté l'emporte, et n'est pas réinventé", () => {
  test("la facture vient du DEVIS, pas du montant de la mission", async () => {
    // Le montant de l'affaire et celui du devis diffèrent exprès : si la
    // facture valait 48 000, c'est que le devis a été ignoré — et on
    // facturerait autre chose que ce qui a été signé.
    const t = await inscrire("devis");
    const m = await mission(t.tenantId, { montant: 48_000 });
    await devisAccepte(t.tenantId, m, 61_000);

    const { body } = await facturer(t.cookie, m).expect(201);
    expect(body.source).toBe("devis");
    expect(body.facture.totalHTCents).toBe(61_000);
  });

  test("la facture reste rattachée au devis — la traçabilité n'est pas perdue", async () => {
    const t = await inscrire("trace");
    const m = await mission(t.tenantId);
    const d = await devisAccepte(t.tenantId, m, 61_000);

    const { body } = await facturer(t.cookie, m).expect(201);
    expect(body.facture.devisId).toBe(d);
  });

  test("un devis ACCEPTÉ PUIS ANNULÉ ne sert pas de source", async () => {
    // Le cas que l'injection a révélé manquant. Un devis annulé garde son
    // `accepted_at` — l'horodatage est un fait, il ne s'efface pas. Seul le
    // STATUT dit si l'accord tient encore. Un test qui ne pose que
    // `accepted_at IS NULL` laisse donc passer la suppression du contrôle de
    // statut sans rien voir : c'est exactement ce qui s'est produit.
    const t = await inscrire("annule");
    const m = await mission(t.tenantId, { montant: 48_000 });
    await adminPool.query(
      `INSERT INTO devis (id, tenant_id, reference, client_name, status, lines, tva_rate,
                          remise, accepted_at, affaire_id, total_ht_cents, total_ttc_cents)
       VALUES ($1, $2::uuid, 'DEV-ANN', 'X', 'ANNULE', $3::jsonb, 20, 0, now(), $4, 61000, 73200)`,
      [crypto.randomUUID(), t.tenantId, JSON.stringify([{
        id: crypto.randomUUID(), description: "Annulé", quantity: 1, unitPriceCents: 61_000,
      }]), m],
    );

    const { body } = await facturer(t.cookie, m).expect(201);
    expect(body.source).toBe("montant_vendu");
    expect(body.facture.totalHTCents).toBe(48_000);   // et non 61 000
  });

  test("un devis NON accepté ne sert pas de source — on retombe sur le montant", async () => {
    // Sinon US-B6.4 serait contournée par une porte de derrière : facturer
    // une prestation que le client n'a jamais acceptée.
    const t = await inscrire("nonacc");
    const m = await mission(t.tenantId, { montant: 48_000 });
    await adminPool.query(
      `INSERT INTO devis (id, tenant_id, reference, client_name, status, lines, tva_rate,
                          remise, affaire_id, total_ht_cents, total_ttc_cents)
       VALUES ($1, $2::uuid, 'DEV-NON', 'X', 'ENVOYE', '[]'::jsonb, 20, 0, $3, 61000, 73200)`,
      [crypto.randomUUID(), t.tenantId, m],
    );

    const { body } = await facturer(t.cookie, m).expect(201);
    expect(body.source).toBe("montant_vendu");
    expect(body.facture.totalHTCents).toBe(48_000);
  });
});

describe("le double clic ne facture pas deux fois", () => {
  test("la seconde tentative est REFUSÉE, et nomme la facture existante", async () => {
    // Un index unique serait faux ici — acompte puis solde sont légitimes.
    // La protection est donc applicative, et c'est pour ça qu'elle doit être
    // éprouvée plutôt que supposée.
    const t = await inscrire("double");
    const m = await mission(t.tenantId);
    await facturer(t.cookie, m).expect(201);

    const { body } = await facturer(t.cookie, m).expect(409);
    expect(body.error).toMatch(/déjà/);
    expect(body.existantes).toHaveLength(1);

    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM factures WHERE affaire_id = $1", [m],
    );
    expect(rows[0].n).toBe(1);
  });

  test("une seconde facture VOULUE passe — acompte puis solde", async () => {
    // Refuser tout serait aussi faux que ne rien refuser : une mission
    // longue se facture en plusieurs fois, et l'interdire obligerait à
    // fabriquer les acomptes à la main.
    const t = await inscrire("acompte");
    const m = await mission(t.tenantId);
    await facturer(t.cookie, m).expect(201);
    await facturer(t.cookie, m, { confirmerSecondeFacture: true }).expect(201);

    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM factures WHERE affaire_id = $1", [m],
    );
    expect(rows[0].n).toBe(2);
  });
});

describe("les refus expliquent", () => {
  test("une mission sans montant ni devis dit quoi faire", async () => {
    const t = await inscrire("vide");
    const m = await mission(t.tenantId, { montant: null });

    const { body } = await facturer(t.cookie, m).expect(422);
    expect(body.error).toMatch(/Renseignez le montant vendu/);
  });

  test("le refus emploie le mot du SECTEUR", async () => {
    // « La mission est introuvable » pour un transporteur, « le chantier »
    // pour un maçon. Un mot d'un autre métier se lit comme un outil conçu
    // pour quelqu'un d'autre.
    const t = await inscrire("mot");
    await adminPool.query(
      // `votre-metier.metier` — LA clé, déclarée une seule fois dans
      // `vertical-tenant.ts` après que neuf fichiers en aient eu chacun une.
      `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, 'votre-metier.metier', 'transport')
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [t.tenantId],
    );

    const { body } = await facturer(t.cookie, crypto.randomUUID()).expect(404);
    expect(body.error.toLowerCase()).toContain("mission");
  });

  test("une mission d'un AUTRE tenant est introuvable", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    const m = await mission(a.tenantId, { montant: 48_000 });

    await facturer(b.cookie, m).expect(404);
    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM factures WHERE affaire_id = $1", [m],
    );
    expect(rows[0].n).toBe(0);
  });
});
