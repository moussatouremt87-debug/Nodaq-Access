/**
 * MFA (TOTP) — LE seul chemin de code qui touche un secret TOTP ou un code de
 * récupération. Ticket 4.15, phase 1.
 *
 * Même doctrine à guichet unique que tenant-secrets.ts : une valeur en clair
 * n'est ni journalisée, ni rendue dans une réponse HTTP au-delà de ce qui est
 * strictement nécessaire à l'enrôlement (le secret et le QR code doivent
 * atteindre le navigateur une fois, pour être scannés — c'est inévitable).
 * Au-dessus de ce fichier, on manipule des booléens et des codes à vérifier,
 * jamais un secret déjà persisté.
 *
 * ── Pourquoi le secret n'est pas persisté avant le premier code correct ──────
 * Verrouiller un secret que l'utilisateur n'a jamais réussi à scanner avec
 * succès le laisserait bloqué à sa prochaine connexion, sans recours. Le
 * secret provisoire fait l'aller-retour via la réponse HTTP jusqu'à la
 * vérification ; seule celle-ci l'écrit en base.
 */
import { randomBytes } from "node:crypto";
import { generate, generateSecret, generateURI, verify } from "otplib";
import { toDataURL } from "qrcode";
import { eq } from "drizzle-orm";
import { db, usersTable, type CodeRecuperationMfa } from "@workspace/db";
import { chiffrer, dechiffrer } from "@nodaq/crypto";
import { hashPassword, verifyPassword } from "./password.js";

const CLE_SECRET_TOTP = "mfa.totp_secret";
const EMETTEUR = "NODAQ";

/** Tolérance de dérive d'horloge : un pas de 30 s de chaque côté, pas plus — un intervalle plus large élargit la fenêtre de rejeu. */
const TOLERANCE_EPOCH_SECONDES = 30;

const NB_CODES_RECUPERATION = 10;

export interface SecretProvisoire {
  readonly secret: string;
  readonly otpauthUri: string;
}

/** Génère un secret TOTP et son URI de provisionnement. Ne persiste rien. */
export function genererSecretProvisoire(email: string): SecretProvisoire {
  const secret = generateSecret();
  const otpauthUri = generateURI({ issuer: EMETTEUR, label: email, secret });
  return { secret, otpauthUri };
}

/** Rend le QR code en data-URI — aucune librairie QR n'est nécessaire côté front. */
export async function genererQrDataUri(otpauthUri: string): Promise<string> {
  return toDataURL(otpauthUri);
}

/** Vérifie un code à 6 chiffres contre un secret TOTP en clair. */
export async function verifierCode(secretClair: string, code: string): Promise<boolean> {
  const resultat = await verify({
    secret: secretClair,
    token: code,
    epochTolerance: TOLERANCE_EPOCH_SECONDES,
  });
  return resultat.valid;
}

/** Génère le code TOTP courant — réservé aux tests, jamais appelé en dehors. */
export async function genererCodeCourant(secretClair: string): Promise<string> {
  return generate({ secret: secretClair });
}

/** Persiste le secret TOTP chiffré et marque l'enrôlement comme terminé. */
export async function enregistrerSecretMfa(userId: string, secretClair: string): Promise<void> {
  const { valeur } = chiffrer(secretClair, { scope: userId, cle: CLE_SECRET_TOTP });
  await db
    .update(usersTable)
    .set({ mfaSecretChiffre: valeur, mfaEnabledAt: new Date() })
    .where(eq(usersTable.id, userId));
}

/**
 * Lit le secret TOTP en clair. `null` si l'utilisateur n'est pas enrôlé.
 *
 * Lève si la ligne existe mais ne se déchiffre pas — même doctrine que
 * `lireSecret` dans tenant-secrets.ts : un secret illisible n'est PAS un
 * secret absent.
 */
export async function lireSecretMfa(userId: string): Promise<string | null> {
  const [ligne] = await db
    .select({ mfaSecretChiffre: usersTable.mfaSecretChiffre })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!ligne?.mfaSecretChiffre) return null;
  return dechiffrer(ligne.mfaSecretChiffre, { scope: userId, cle: CLE_SECRET_TOTP });
}

/** Dix codes à usage unique, lisibles à la main — jamais persistés en clair. */
export function genererCodesRecuperation(): string[] {
  return Array.from({ length: NB_CODES_RECUPERATION }, () => {
    const brut = randomBytes(5).toString("hex").toUpperCase(); // 10 caractères hex, 40 bits
    return `${brut.slice(0, 4)}-${brut.slice(4, 8)}-${brut.slice(8, 10)}`;
  });
}

/** Hache les codes de récupération (bcrypt, même mécanisme qu'un mot de passe). */
export async function hacherCodesRecuperation(codes: string[]): Promise<CodeRecuperationMfa[]> {
  return Promise.all(
    codes.map(async (code) => ({ hash: await hashPassword(code), usedAt: null })),
  );
}

/**
 * Consomme un code de récupération. Rend `true` s'il était valide et non
 * déjà utilisé — dans ce cas, le marque consommé dans le même mouvement.
 *
 * Lecture-modification-écriture sur la ligne `users` complète (pas de
 * mise à jour partielle du jsonb) — deux requêtes concurrentes pour le même
 * code liraient le même état `usedAt: null` et le consommeraient toutes les
 * deux si on ne reposait pas la liste ENTIÈRE en une seule UPDATE atomique ;
 * la fenêtre de course reste theoriquement ouverte ici (pas de verrou de
 * ligne explicite) — acceptable pour une opération rare, déclenchée par un
 * utilisateur légitime perdant son appareil, pas un chemin à fort débit.
 */
export async function consommerCodeRecuperation(userId: string, code: string): Promise<boolean> {
  const [ligne] = await db
    .select({ mfaRecoveryCodes: usersTable.mfaRecoveryCodes })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const codes = ligne?.mfaRecoveryCodes ?? [];

  for (let i = 0; i < codes.length; i++) {
    const entree = codes[i]!;
    if (entree.usedAt !== null) continue;
    if (!(await verifyPassword(code, entree.hash))) continue;

    const misAJour = [...codes];
    misAJour[i] = { ...entree, usedAt: new Date().toISOString() };
    await db.update(usersTable).set({ mfaRecoveryCodes: misAJour }).where(eq(usersTable.id, userId));
    return true;
  }
  return false;
}
