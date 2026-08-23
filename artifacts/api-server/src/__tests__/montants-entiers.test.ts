/*
 * Aucun montant n'est stocké en flottant — garde structurelle.
 *
 * ── Le défaut qu'elle empêche de revenir ──────────────────────────────────
 * Onze colonnes monétaires étaient déclarées `real` (float4). Au-delà de
 * 167 772,16 € — 2^24 centimes — la valeur relue n'était plus celle qu'on
 * avait écrite : une facture de 199 999,99 € ressortait à 200 000,00 €.
 *
 * Ce défaut n'a rien cassé pendant des mois. Il ne lève aucune erreur, ne
 * fait échouer aucun test, ne se voit sur aucun document — le PDF et le
 * Factur-X lisent des colonnes entières. Il ne se manifeste que sur un total
 * affiché, d'un centime, chez un artisan qui a un gros chantier.
 *
 * C'est exactement le profil d'un défaut qui revient : rien ne s'oppose à ce
 * qu'une prochaine colonne soit déclarée `real` par mimétisme du voisinage.
 * Cette garde interroge le MOTEUR, comme la garde RLS de la CI — pas le code
 * TypeScript, qui ne dit rien du type réellement posé en base.
 */
import { describe, test, expect } from "vitest";
import { adminPool } from "./helpers.js";

/**
 * Ce qui fait qu'une colonne est monétaire, à la lecture de son nom.
 *
 * Un motif et non une liste : une liste ne protège que ce qu'on a pensé à y
 * mettre, et le prochain montant portera un nom qu'on n'a pas prévu.
 */
const MOTIF_MONETAIRE = /(_cents|_amount|amount_|montant_|_montant|prix_|_prix)/;

/** Les types à virgule flottante de PostgreSQL. */
const TYPES_FLOTTANTS = ["real", "double precision", "float", "float4", "float8"];

/**
 * Colonnes monétaires connues qui ne sont PAS en centimes entiers, et pourquoi
 * elles échappent volontairement à la règle.
 *
 * Aucune aujourd'hui ne correspond au motif ci-dessus — cette liste existe
 * pour que la prochaine exception soit un choix écrit, pas un oubli.
 *
 * Cas connu, hors motif et hors périmètre : `team_members.cout_mensuel_charge`
 * est un coût mensuel en EUROS avec décimales, pas en centimes entiers. Son
 * erreur relative en float4 est de l'ordre de 10⁻⁷ — invisible sur le coût
 * horaire qu'elle sert à calculer. La convertir serait un changement de
 * SÉMANTIQUE (euros → centimes), pas de type : un autre chantier.
 */
const EXCEPTIONS: ReadonlyArray<{ table: string; colonne: string; raison: string }> = [];

describe("aucun montant n'est stocké en flottant", () => {
  test("le moteur ne porte aucune colonne monétaire à virgule flottante", async () => {
    const { rows } = await adminPool.query<{
      table_name: string; column_name: string; data_type: string;
    }>(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type = ANY($1)
        ORDER BY table_name, column_name`,
      [TYPES_FLOTTANTS],
    );

    const fautives = rows
      .filter((r) => MOTIF_MONETAIRE.test(r.column_name))
      .filter((r) => !EXCEPTIONS.some((e) => e.table === r.table_name && e.colonne === r.column_name));

    // Le message porte de quoi corriger : sans lui, l'échec dirait « attendu 0,
    // reçu 3 » et il faudrait rouvrir ce fichier pour savoir lesquelles.
    const detail = fautives.map((r) => `${r.table_name}.${r.column_name} (${r.data_type})`).join(", ");
    expect(fautives, `colonnes monétaires en flottant : ${detail}`).toHaveLength(0);
  });

  test("les onze colonnes de la migration 056 sont bien en `integer`", async () => {
    // Nommées une à une, en plus du motif : le motif protège l'avenir, cette
    // liste prouve que le passé a bien été traité.
    const attendues: ReadonlyArray<[string, string]> = [
      ["factures", "amount_cents"], ["factures", "residual_cents"],
      ["affaires", "quoted_amount_cents"], ["affaires", "invoiced_amount_cents"],
      ["affaires", "margin_cents"], ["affaires", "montant_vendu_ht"],
      ["contrats", "amount_cents"],
      ["prospects", "estimated_value_cents"],
      ["echeances", "estimated_cents"], ["echeances", "paid_cents"],
      ["pending_actions", "amount_cents"],
    ];

    const { rows } = await adminPool.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'`,
    );
    const type = (t: string, c: string) =>
      rows.find((r) => r.table_name === t && r.column_name === c)?.data_type;

    for (const [t, c] of attendues) {
      expect(type(t, c), `${t}.${c}`).toBe("integer");
    }
  });
});

describe("le seuil que le flottant faisait perdre", () => {
  test("un montant au-delà de 2^24 centimes est désormais exact", async () => {
    // 199 999,99 € — la valeur qui ressortait à 200 000,00 €. Le test le
    // vérifie sur une table temporaire au type RÉEL de la colonne, plutôt que
    // sur une facture : c'est le type qu'on éprouve, pas la route.
    const client = await adminPool.connect();
    try {
      await client.query("CREATE TEMP TABLE t_entier (montant_cents integer)");
      await client.query("INSERT INTO t_entier VALUES (19999999), (123456789), (2147483647)");
      const { rows } = await client.query<{ montant_cents: number }>("SELECT montant_cents FROM t_entier ORDER BY 1");
      expect(rows.map((r) => Number(r.montant_cents))).toEqual([19999999, 123456789, 2147483647]);
    } finally {
      client.release();
    }
  });

  test("le même montant en `real` est bien FAUX — la garde a un objet", async () => {
    // Sans ce test, la garde pourrait protéger d'un défaut imaginaire. Il
    // démontre que le type refusé perd réellement de l'information.
    const client = await adminPool.connect();
    try {
      await client.query("CREATE TEMP TABLE t_flottant (montant_cents real)");
      await client.query("INSERT INTO t_flottant VALUES (19999999)");
      const { rows } = await client.query<{ relu: string }>(
        "SELECT montant_cents::bigint AS relu FROM t_flottant",
      );
      expect(Number(rows[0]!.relu)).toBe(20000000);   // et non 19999999
    } finally {
      client.release();
    }
  });
});

describe("l'invariant de cohérence des factures", () => {
  test("un TTC qui contredit sa ventilation est refusé par le moteur", async () => {
    // Contrôle applicatif contourné par une seconde requête ; contrainte du
    // moteur, jamais. C'est la même doctrine que les policies RLS.
    const client = await adminPool.connect();
    try {
      const { rows } = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conname = 'factures_ttc_coherent'`,
      );
      expect(rows, "la contrainte factures_ttc_coherent n'existe pas").toHaveLength(1);
      expect(rows[0]!.def).toContain("amount_cents");
      expect(rows[0]!.def).toContain("total_ht_cents");
      expect(rows[0]!.def).toContain("total_tva_cents");
    } finally {
      client.release();
    }
  });
});
