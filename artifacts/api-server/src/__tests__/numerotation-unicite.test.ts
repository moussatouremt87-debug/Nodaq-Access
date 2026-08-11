/**
 * Unicité du numéro de facture — tenue par le MOTEUR.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNE NUMÉROTATION LÉGALE NE SE CONFIE PAS À UNE INSTRUCTION.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * `assignNextNumero` prend un `SELECT … FOR UPDATE` sur `facture_sequences`, et
 * cette logique a l'air correcte. Mais la numérotation d'une facture est une
 * obligation légale, continue et chronologique, opposable à un contrôle : c'est
 * exactement le genre de garantie que ce dépôt refuse de laisser à du code
 * quand le moteur peut la tenir — la même raison qui met `archived_pdfs` en
 * `SELECT`/`INSERT` seulement.
 *
 * Avant la migration 024, deux factures émises pouvaient porter le même numéro
 * sans que rien ne proteste. Le doublon ne se serait vu qu'au contrôle fiscal.
 *
 * ── POURQUOI CES TESTS PASSENT PAR `adminPool` ──────────────────────────────
 * On éprouve ici une contrainte du SCHÉMA, pas une route. Insérer directement
 * permet de provoquer le doublon que l'application, elle, refuse de produire —
 * c'est le seul moyen de voir la garde se déclencher. Tout se joue dans une
 * transaction annulée : rien ne subsiste.
 */
import { describe, test, expect } from "vitest";
import { adminPool } from "./helpers";

const COLONNES = "(id, tenant_id, customer_name, number, issued_date, due_date, amount_cents)";

/** Joue un scénario dans une transaction TOUJOURS annulée. */
async function dansUneTransactionAnnulee<T>(
  scenario: (
    inserer: (id: string, numero: string) => Promise<unknown>,
  ) => Promise<T>,
): Promise<T> {
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "INSERT INTO tenants (id, nom) VALUES (gen_random_uuid(), 'Épreuve unicité') RETURNING id",
    );
    const tenantId = rows[0].id as string;
    const inserer = (id: string, numero: string) =>
      client.query(
        `INSERT INTO factures ${COLONNES}
         VALUES ($1, $2, 'Client', $3, '2026-08-01', '2026-09-01', 1000)`,
        [id, tenantId, numero],
      );
    return await scenario(inserer);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe("numérotation — l'unicité vient du moteur", () => {
  test("l'index unique partiel existe sur (tenant_id, number)", async () => {
    const { rows } = await adminPool.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'factures_tenant_number_unique'",
    );
    const definition = rows[0]?.indexdef as string | undefined;

    // Trois propriétés, et chacune compte : unique, par tenant, et PARTIEL.
    expect(definition).toBeDefined();
    expect(definition).toMatch(/CREATE UNIQUE INDEX/);
    expect(definition).toMatch(/\(tenant_id, number\)/);
    expect(definition).toMatch(/WHERE \(number <> ''::text\)/);
  });

  test("deux factures émises de même numéro sont refusées par le moteur", async () => {
    const erreur = await dansUneTransactionAnnulee(async (inserer) => {
      await inserer("dup-1", "FACT-2026-0001");
      try {
        await inserer("dup-2", "FACT-2026-0001");
        return null;
      } catch (e) {
        return e as { code?: string; constraint?: string };
      }
    });

    // `null` voudrait dire que le doublon est passé : la protection n'existe pas.
    expect(erreur).not.toBeNull();
    expect(erreur?.code).toBe("23505"); // unique_violation
    expect(erreur?.constraint).toBe("factures_tenant_number_unique");
  });

  test("plusieurs brouillons coexistent — l'index ne contraint que les émises", async () => {
    // Un brouillon porte `number = ''`. Un index unique TOTAL refuserait le
    // deuxième brouillon d'un tenant et casserait l'usage le plus courant du
    // produit. C'est toute la raison de la clause `WHERE number <> ''`.
    const echec = await dansUneTransactionAnnulee(async (inserer) => {
      try {
        await inserer("br-1", "");
        await inserer("br-2", "");
        await inserer("br-3", "");
        return null;
      } catch (e) {
        return e as Error;
      }
    });

    expect(echec).toBeNull();
  });

  test("deux tenants peuvent porter le même numéro", async () => {
    // Chaque artisan a sa propre séquence : deux FACT-2026-0001 chez deux
    // tenants distincts est la situation NORMALE. Une unicité globale casserait
    // le multi-tenant.
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      const a = await client.query(
        "INSERT INTO tenants (id, nom) VALUES (gen_random_uuid(), 'Tenant A') RETURNING id",
      );
      const b = await client.query(
        "INSERT INTO tenants (id, nom) VALUES (gen_random_uuid(), 'Tenant B') RETURNING id",
      );
      const inserer = (id: string, tenantId: string) =>
        client.query(
          `INSERT INTO factures ${COLONNES}
           VALUES ($1, $2, 'Client', 'FACT-2026-0001', '2026-08-01', '2026-09-01', 1000)`,
          [id, tenantId],
        );
      await inserer("t-a", a.rows[0].id);
      await expect(inserer("t-b", b.rows[0].id)).resolves.toBeDefined();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
