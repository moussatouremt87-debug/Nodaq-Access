/**
 * L'appareil déjà prouvé — le vrai levier de simplicité.
 *
 * Le facteur choisi compte moins que sa FRÉQUENCE. Le second facteur était
 * redemandé à chaque connexion : plusieurs centaines de fois par an pour un
 * patron qui ouvre son cockpit tous les matins. Une fois l'appareil reconnu,
 * il ne l'est plus que trois ou quatre fois par an.
 *
 * ── CE QUE CE JETON N'EST PAS ───────────────────────────────────────────────
 *
 * Ce n'est pas une session : il ne donne accès à rien tout seul. Il atteste
 * seulement qu'un second facteur a DÉJÀ été prouvé sur cet appareil. Il faut
 * toujours le mot de passe pour ouvrir une session — voler ce cookie sans le
 * mot de passe ne sert à rien.
 *
 * C'est aussi ce qui le distingue de `sessions.mfaVerifiedAt`, qui reste
 * délibérément lié à UNE session : un cookie de session volé n'hérite jamais
 * d'un second facteur prouvé ailleurs.
 */
import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, appareilsConfianceTable } from "@workspace/db";

export const DUREE_CONFIANCE_JOURS = 90;
export const COOKIE_APPAREIL = "nodaq_appareil";

function condensat(jeton: string): string {
  return crypto.createHash("sha256").update(jeton).digest("hex");
}

/**
 * Un libellé GROSSIER, pour que l'utilisateur reconnaisse son appareil dans
 * « Sécurité du compte » et puisse le révoquer.
 *
 * Volontairement pauvre : on ne construit pas une empreinte de navigateur. Un
 * identifiant fin servirait à pister, et n'aiderait personne à se relire.
 */
export function libelleAppareil(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const nav =
    /Edg\//.test(ua) ? "Edge" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const sys =
    /iPhone|iPad/.test(ua) ? "iPhone" :
    /Android/.test(ua) ? "Android" :
    /Mac OS X|Macintosh/.test(ua) ? "Mac" :
    /Windows/.test(ua) ? "Windows" : "appareil inconnu";
  return `${nav} sur ${sys}`;
}

/** Pose un appareil de confiance et rend le jeton EN CLAIR, pour le cookie. */
export async function poserAppareil(userId: string, userAgent?: string): Promise<string> {
  const jeton = crypto.randomBytes(32).toString("hex");
  await db.insert(appareilsConfianceTable).values({
    userId,
    jetonSha256: condensat(jeton),
    libelle: libelleAppareil(userAgent),
    expiresAt: new Date(Date.now() + DUREE_CONFIANCE_JOURS * 24 * 60 * 60 * 1000),
  });
  return jeton;
}

/**
 * Cet appareil a-t-il déjà prouvé un second facteur pour CET utilisateur ?
 *
 * Le jeton est lié à l'utilisateur : présenté pour quelqu'un d'autre, il ne
 * vaut rien. Sans cette condition, un jeton volé ouvrirait le compte du
 * voleur — et le lien entre les deux passerait inaperçu.
 */
export async function appareilReconnu(userId: string, jeton: string | undefined): Promise<boolean> {
  if (!jeton) return false;
  const [trouve] = await db
    .select({ id: appareilsConfianceTable.id })
    .from(appareilsConfianceTable)
    .where(and(
      eq(appareilsConfianceTable.jetonSha256, condensat(jeton)),
      eq(appareilsConfianceTable.userId, userId),
      isNull(appareilsConfianceTable.revokedAt),
      gt(appareilsConfianceTable.expiresAt, new Date()),
    ))
    .limit(1);
  if (!trouve) return false;
  await db.update(appareilsConfianceTable)
    .set({ derniereVue: new Date() })
    .where(eq(appareilsConfianceTable.id, trouve.id));
  return true;
}

/** Options du cookie — mêmes exigences qu'une session, durée bien plus longue. */
export function optionsCookieAppareil(): {
  httpOnly: true; sameSite: "lax"; secure: boolean; maxAge: number; path: string;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    maxAge: DUREE_CONFIANCE_JOURS * 24 * 60 * 60 * 1000,
    path: "/",
  };
}
