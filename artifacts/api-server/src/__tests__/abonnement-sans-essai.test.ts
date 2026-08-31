/**
 * Plus d'essai gratuit — décision fondateur du 31/08/2026.
 *
 * Les 50 places Fondateurs à 29 €/mois se paient dès l'inscription. Une
 * poignée de TPE sélectionnées à la main sont offertes, par dérogation de
 * remise sur leur ligne — jamais par un essai.
 *
 * ── CE QUE CES TESTS PROTÈGENT ──────────────────────────────────────────────
 *
 * Un essai gratuit se réintroduit en une ligne : il suffit de reposer un
 * `trialEndsAt` à la création. Rien n'échouerait — l'application marcherait
 * même très bien, elle donnerait simplement le produit. C'est un défaut qui ne
 * se voit qu'en lisant un relevé bancaire.
 *
 * Et la réciproque compte autant : les essais DÉJÀ OUVERTS doivent continuer
 * de fonctionner jusqu'à leur terme. Un essai accordé est une promesse faite.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminPool, cleanupTenants, cleanupUsers } from "./helpers";
import { withTenant, subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { creerAbonnementEnAttente } from "../lib/abonnement";
import {
  MESSAGE_ABONNEMENT_EN_ATTENTE,
  MESSAGE_ABONNEMENT_LECTURE_SEULE,
  STATUTS_SANS_ECRITURE,
  messageBlocage,
} from "../middleware/abonnementLectureSeule";

const tenantIds: string[] = [];
const emails: string[] = [];

async function tenantNu(): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO tenants (id, nom) VALUES ($1::uuid, $2)`,
    [id, `Sans essai ${crypto.randomBytes(3).toString("hex")}`],
  );
  tenantIds.push(id);
  return id;
}

beforeAll(async () => { /* rien à préparer */ }, 30_000);
afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("un tenant neuf naît EN_ATTENTE, sans date qui court", () => {
  test("aucun essai n'est ouvert à la création", async () => {
    const tenantId = await tenantNu();
    /*
     * `withTenant` et non `db` : `subscriptions` porte la RLS en FORCE, et la
     * fonction est appelée depuis la transaction de création du tenant. La
     * première version de ce test passait `db` — l'insertion a été refusée,
     * ce qui est le comportement voulu. C'est le test qui avait tort.
     */
    await withTenant(tenantId, (tx) => creerAbonnementEnAttente(tx, tenantId));

    const [sub] = await withTenant(tenantId, (tx) => tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.tenantId, tenantId)));

    expect(sub!.statut).toBe("EN_ATTENTE");
    // LA propriété. Une date d'échéance signifierait qu'un essai court.
    expect(sub!.trialEndsAt, "un essai a été ouvert").toBeNull();
  });

  test("le défaut de la colonne ne rouvre pas d'essai non plus", async () => {
    /*
     * Un INSERT qui omettrait le statut — un script, une reprise, un test —
     * ne doit pas retomber sur TRIAL. La migration 071 déplace le DEFAULT ;
     * sans elle, la porte se rouvrirait par le bas.
     */
    const tenantId = await tenantNu();
    await adminPool.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_id) VALUES ($1, $2::uuid, 'equipe')`,
      [crypto.randomUUID(), tenantId],
    );
    const { rows } = await adminPool.query(
      `SELECT statut, trial_ends_at FROM subscriptions WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    expect(rows[0].statut).toBe("EN_ATTENTE");
    expect(rows[0].trial_ends_at).toBeNull();
  });

  test("EN_ATTENTE est accepté par la base — la contrainte a bien suivi", async () => {
    // Si la migration 071 manquait, l'INSERT ci-dessus aurait déjà échoué.
    // Ce test le dit explicitement plutôt que de laisser deviner la cause.
    const { rows } = await adminPool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'subscriptions_statut_check'`,
    );
    expect(rows[0]?.def ?? "").toContain("EN_ATTENTE");
  });
});

describe("les essais en cours ne sont pas révoqués", () => {
  test("TRIAL reste un statut valide en base", async () => {
    /*
     * Retirer TRIAL de la contrainte aurait cassé les essais ouverts avant le
     * 31/08 — une promesse rompue sans prévenir, et des lignes soudain
     * illisibles. Ils s'éteignent d'eux-mêmes ; on ne les tue pas.
     */
    const tenantId = await tenantNu();
    await adminPool.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, statut, trial_ends_at)
       VALUES ($1, $2::uuid, 'equipe', 'TRIAL', now() + interval '3 days')`,
      [crypto.randomUUID(), tenantId],
    );
    const { rows } = await adminPool.query(
      `SELECT statut FROM subscriptions WHERE tenant_id = $1::uuid`, [tenantId],
    );
    expect(rows[0].statut).toBe("TRIAL");
  });
});

describe("les deux blocages se disent différemment", () => {
  test("EN_ATTENTE et READONLY bloquent tous les deux l'écriture", () => {
    expect([...STATUTS_SANS_ECRITURE].sort()).toEqual(["EN_ATTENTE", "READONLY"]);
  });

  test("mais ne racontent pas la même chose", () => {
    /*
     * « L'essai est terminé » à quelqu'un qui n'a jamais eu d'essai, c'est le
     * genre de phrase qui fait douter du sérieux d'un produit dans sa première
     * minute — même travers que l'agent renvoyant vers un expert-comptable.
     */
    expect(messageBlocage("EN_ATTENTE")).toBe(MESSAGE_ABONNEMENT_EN_ATTENTE);
    expect(messageBlocage("READONLY")).toBe(MESSAGE_ABONNEMENT_LECTURE_SEULE);
    expect(MESSAGE_ABONNEMENT_EN_ATTENTE).not.toMatch(/essai/i);
  });

  test("le message d'attente ne menace pas et nomme le chemin", () => {
    // Règle 3 bis : jamais de refus sans chemin. Et aucune date ne court, donc
    // aucune urgence à agiter.
    expect(MESSAGE_ABONNEMENT_EN_ATTENTE).toMatch(/Réglages → Abonnement/);
    expect(MESSAGE_ABONNEMENT_EN_ATTENTE).toMatch(/conserv/i);
    for (const menace of ["supprim", "perdu", "définitiv", "dernier délai"]) {
      expect(MESSAGE_ABONNEMENT_EN_ATTENTE.toLowerCase()).not.toContain(menace);
    }
  });
});

describe("l'essai ne peut pas revenir par la porte de service", () => {
  test("aucune création d'abonnement ne pose de date d'essai", () => {
    /*
     * Garde STRUCTURELLE : c'est une ligne qui rouvrirait l'essai, et rien
     * n'échouerait — le produit serait simplement donné. Personne ne s'en
     * apercevrait avant de lire un relevé bancaire.
     */
    const src = readFileSync(join(__dirname, "..", "lib", "abonnement.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const creation = /export function creerAbonnementEnAttente[\s\S]*?\n}/.exec(src)?.[0] ?? "";
    expect(creation, "creerAbonnementEnAttente introuvable").not.toBe("");
    expect(creation).not.toMatch(/trialEndsAt/);
    expect(creation).toMatch(/statut:\s*"EN_ATTENTE"/);
  });

  test("`creerAbonnementEssai` n'existe plus sous son ancien nom", () => {
    // Un appelant oublié qui l'importerait encore rouvrirait des essais sans
    // que rien ne le signale.
    const src = readFileSync(join(__dirname, "..", "lib", "abonnement.ts"), "utf8");
    expect(src).not.toMatch(/creerAbonnementEssai/);
  });
});
