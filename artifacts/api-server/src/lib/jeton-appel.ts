/**
 * Le jeton de service du worker vocal — ticket 4.18, lot 6.
 *
 * Le worker est une MACHINE : pas de session, pas de cookie. Il lui faut donc
 * une authentification de service — et c'est là que se joue la règle 1 du
 * CLAUDE.md.
 *
 * Un jeton de service unique aurait authentifié la machine, mais le `tenantId`
 * serait alors venu du CORPS de la requête. Sur la donnée la plus sensible du
 * produit — à qui appartient l'appel en cours — ce serait précisément le défaut
 * que la règle interdit.
 *
 * D'où un jeton par APPEL. Le tenant est LU depuis la ligne que le jeton
 * désigne, jamais reçu. Un corps forgé ne peut rien changer, puisqu'il ne porte
 * aucun tenant.
 *
 * ── Le jeton n'est pas en base ─────────────────────────────────────────────
 * Seul son condensat SHA-256 y est rangé, comme le jeton d'acceptation de devis
 * (migration 014). Le jeton en clair ne vit que dans ce qu'on remet au worker
 * au moment de composer. Qui lit une sauvegarde ne peut pas se faire passer
 * pour un appel en cours.
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * 256 bits. Le jeton ouvre une conversation avec un débiteur : l'énumération
 * doit rester hors de portée, y compris pour qui connaîtrait le format.
 */
const OCTETS_JETON = 32;

export interface JetonAppel {
  /** Remis au worker, une seule fois. N'est jamais relu ensuite. */
  readonly jeton: string;
  /** Rangé en base. C'est tout ce que le serveur conserve. */
  readonly sha256: string;
}

/** Le condensat rangé en base. Le jeton, lui, ne quitte pas l'appelant. */
export function condensatJeton(jeton: string): string {
  return crypto.createHash("sha256").update(jeton).digest("hex");
}

/** Frappe un jeton pour un appel qu'on s'apprête à composer. */
export function frapperJetonAppel(): JetonAppel {
  const jeton = crypto.randomBytes(OCTETS_JETON).toString("base64url");
  return { jeton, sha256: condensatJeton(jeton) };
}

export interface AppelResolu {
  readonly appelId: string;
  readonly tenantId: string;
  readonly campagneId: string;
}

/**
 * Retrouve l'appel désigné par un jeton, via la policy étroite.
 *
 * `set_config(..., true)` et non `SET LOCAL` : Drizzle envoie l'interpolation
 * comme paramètre lié, et PostgreSQL n'accepte pas de paramètre dans un `SET`.
 * Le troisième argument à `true` est OBLIGATOIRE — la portée doit être la
 * transaction, sinon le réglage fuit d'une requête à l'autre à cause du
 * pooling, et l'appel d'un tenant deviendrait lisible pendant la requête d'un
 * autre. Même patron que `lookupByToken` dans `routes/public.ts`.
 *
 * La policy exige en plus `statut IN ('PLANIFIE','EN_COURS')` : un appel
 * terminé ne rouvre rien. La révocation est donc automatique, sans liste noire.
 */
export async function resoudreAppelParJeton(jeton: string): Promise<AppelResolu | null> {
  const sha = condensatJeton(jeton);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.voice_call_token_sha256', ${sha}, true)`);
    // Projection EXPLICITE : `select()` sans projection ramènerait la
    // transcription et le condensat lui-même. Le premier est du verbatim de
    // conversation, le second est le secret de la table.
    const lignes = await tx.execute<{ id: string; tenant_id: string; campagne_id: string }>(
      sql`SELECT id, tenant_id, campagne_id FROM appels_relance`,
    );
    const ligne = lignes.rows[0];
    return ligne
      ? { appelId: ligne.id, tenantId: ligne.tenant_id, campagneId: ligne.campagne_id }
      : null;
  });
}
