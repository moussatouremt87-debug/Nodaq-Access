/**
 * Le second facteur, par un code à six chiffres reçu par courriel.
 *
 * ── POURQUOI CE CHEMIN EXISTE ───────────────────────────────────────────────
 *
 * L'application d'authentification imposait un téléchargement, un scan de
 * QR code et une horloge synchronisée. Pour un artisan peu à l'aise avec le
 * numérique, ce n'est pas une gêne : c'est un mur. Et une authentification
 * qu'on ne sait pas franchir ne protège rien — elle fait abandonner
 * l'inscription, ou elle finit désactivée pour tout le monde.
 *
 * Le courriel n'abaisse pas le plafond de sécurité autant qu'il y paraît : la
 * réinitialisation du mot de passe passe DÉJÀ par cette boîte. Qui la contrôle
 * contrôlait déjà le compte. Ce qu'on retire, c'est l'application.
 *
 * ── CE QUI REND SIX CHIFFRES SUFFISANTS ─────────────────────────────────────
 *
 * Un million de combinaisons se force en quelques minutes si on laisse
 * essayer. Trois garde-fous, et c'est leur CONJONCTION qui tient :
 *
 *   1. durée de vie courte      — dix minutes, pas davantage ;
 *   2. plafond d'essais         — cinq, puis le code est mort ;
 *   3. usage unique             — un code accepté ne resservira jamais.
 *
 * Le code n'est jamais stocké en clair, jamais journalisé, jamais rendu dans
 * une réponse HTTP (règle 6). Il ne vit qu'entre le générateur et le courriel.
 */
import crypto from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, codesConnexionTable } from "@workspace/db";

export const DUREE_CODE_MINUTES = 10;
export const MAX_TENTATIVES = 5;
/** Plafond d'émission : au-delà, on cesse d'envoyer (et de facturer l'e-mail). */
export const MAX_CODES_PAR_HEURE = 5;

/** Six chiffres, tirés du générateur cryptographique — jamais `Math.random`. */
export function genererCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function condensat(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Comparaison à durée constante : une comparaison naïve fuit le préfixe. */
function memeCondensat(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export type ResultatEmission =
  | { readonly kind: "ok"; readonly code: string; readonly expireLe: Date }
  | { readonly kind: "trop_de_demandes" };

/**
 * Pose un code neuf et rend sa valeur EN CLAIR — au seul appelant, qui doit
 * l'envoyer par courriel et ne jamais le journaliser ni le renvoyer au client.
 *
 * Les codes précédents encore vivants sont consommés : en demander un nouveau
 * annule l'ancien, sans quoi plusieurs codes valides cohabiteraient et
 * multiplieraient les essais autorisés.
 */
export async function poserCode(userId: string): Promise<ResultatEmission> {
  const ilYaUneHeure = new Date(Date.now() - 60 * 60 * 1000);
  const [{ recents }] = await db
    .select({ recents: sql<number>`count(*)::int` })
    .from(codesConnexionTable)
    .where(and(
      eq(codesConnexionTable.userId, userId),
      gt(codesConnexionTable.createdAt, ilYaUneHeure),
    ));
  if ((recents ?? 0) >= MAX_CODES_PAR_HEURE) return { kind: "trop_de_demandes" };

  await db.update(codesConnexionTable)
    .set({ usedAt: new Date() })
    .where(and(
      eq(codesConnexionTable.userId, userId),
      isNull(codesConnexionTable.usedAt),
    ));

  const code = genererCode();
  const expireLe = new Date(Date.now() + DUREE_CODE_MINUTES * 60 * 1000);
  await db.insert(codesConnexionTable).values({
    userId, codeSha256: condensat(code), expiresAt: expireLe,
  });
  return { kind: "ok", code, expireLe };
}

export type ResultatVerification =
  | { readonly kind: "ok" }
  | { readonly kind: "aucun_code" }
  | { readonly kind: "expire" }
  | { readonly kind: "trop_d_essais" }
  | { readonly kind: "incorrect"; readonly essaisRestants: number };

/**
 * Vérifie un code. Le compteur d'essais monte AVANT la comparaison : un
 * attaquant qui coupe la connexion juste après l'envoi ne doit pas obtenir un
 * essai gratuit.
 */
export async function verifierCode(userId: string, saisi: string): Promise<ResultatVerification> {
  const [courant] = await db
    .select()
    .from(codesConnexionTable)
    .where(and(
      eq(codesConnexionTable.userId, userId),
      isNull(codesConnexionTable.usedAt),
    ))
    .orderBy(desc(codesConnexionTable.createdAt))
    .limit(1);

  if (!courant) return { kind: "aucun_code" };
  if (courant.expiresAt.getTime() <= Date.now()) return { kind: "expire" };
  if (courant.tentatives >= MAX_TENTATIVES) return { kind: "trop_d_essais" };

  const [apres] = await db.update(codesConnexionTable)
    .set({ tentatives: sql`${codesConnexionTable.tentatives} + 1` })
    .where(eq(codesConnexionTable.id, courant.id))
    .returning({ tentatives: codesConnexionTable.tentatives });

  if (!memeCondensat(condensat(saisi.trim()), courant.codeSha256)) {
    const restants = Math.max(0, MAX_TENTATIVES - (apres?.tentatives ?? MAX_TENTATIVES));
    return { kind: "incorrect", essaisRestants: restants };
  }

  await db.update(codesConnexionTable)
    .set({ usedAt: new Date() })
    .where(eq(codesConnexionTable.id, courant.id));
  return { kind: "ok" };
}
