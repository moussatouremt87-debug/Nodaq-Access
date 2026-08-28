/**
 * Le cache des permis de construire.
 *
 * ── POURQUOI IL EXISTE ──────────────────────────────────────────────────────
 * PermisAPI plafonne le plan gratuit à **500 requêtes par mois**, et à un seul
 * département par compte. Chaque ouverture de l'écran Prospection consommait
 * une requête : React Query n'en garde que cinq minutes CÔTÉ NAVIGATEUR, et un
 * simple rechargement de page repartait à la source. Le quota s'est épuisé en
 * quelques jours de test, et la section s'est mise à répondre 429 — que l'écran
 * affichait « Impossible de charger les permis », ce qui ressemble à une panne
 * du produit alors que c'est un plafond de la source.
 *
 * Un appel par jour et par département ramène la consommation à une trentaine
 * de requêtes par mois. Les autorisations d'urbanisme sont publiées au mois :
 * une journée de retard ne fait perdre aucun chantier.
 *
 * ── POURQUOI EN BASE, ET PAS EN MÉMOIRE ─────────────────────────────────────
 * Le conteneur de production a `min_scale: 0` — il s'endort, et un cache
 * mémoire meurt avec lui : le premier visiteur du réveil rappellerait la
 * source. Il monte aussi jusqu'à cinq instances, qui ne partageraient rien.
 * Le disque est exclu par ailleurs : celui d'un conteneur est éphémère.
 *
 * ── PAS DE `withTenant` ICI, ET C'EST LE POINT DÉLICAT ──────────────────────
 * `cache_permis` est la seule table du schéma sans `tenant_id` : elle ne
 * contient que de l'open data publique, identique pour tous. La lire sous
 * `withTenant` n'apporterait rien — il n'y a pas de policy à activer — et
 * l'écrire par locataire ruinerait l'objectif même du cache.
 *
 * L'accès passe par le `db` Drizzle ordinaire — donc par `app_user`, rôle non
 * superutilisateur. Surtout PAS par un pool administrateur : le seul qui
 * existe dans ce dépôt est un utilitaire de test, et le faire entrer en
 * production ouvrirait un chemin qui contourne la RLS pour toutes les autres
 * tables.
 *
 * En contrepartie, RIEN de ce qui entre ici ne doit venir d'un locataire.
 * `departement` est déduit d'un code postal, et `assertDepartement` refuse
 * tout ce qui n'est pas deux ou trois caractères de code — une clé de cache
 * qui accepterait n'importe quoi finirait par transporter autre chose.
 */
import { db, cachePermisTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { PermisPublic } from "./permis-construire.js";

/**
 * Durée de vie d'une entrée.
 *
 * Vingt-quatre heures : la source publie au mois, et 500 requêtes mensuelles
 * autorisent au mieux une quinzaine d'appels par jour tous départements
 * confondus. Descendre à l'heure remettrait le quota en danger sans rien
 * apporter à l'artisan.
 */
export const TTL_CACHE_PERMIS_MS = 24 * 60 * 60 * 1000;

export interface EntreeCachePermis {
  readonly permis: readonly PermisPublic[];
  readonly chargeLe: Date;
  /** `false` quand l'entrée a dépassé le TTL — servie faute de mieux. */
  readonly frais: boolean;
}

/**
 * Refuse toute clé qui ne ressemble pas à un code de département.
 *
 * `departementDepuisCodePostal` ne rend déjà que ça, mais cette table n'a pas
 * de RLS pour rattraper une erreur : la garde est ici, à l'entrée.
 */
function assertDepartement(departement: string): void {
  if (!/^[0-9]{2,3}$/.test(departement)) {
    throw new Error(`Clé de cache invalide : ${JSON.stringify(departement)}`);
  }
}

/** L'entrée du département, fraîche ou non — `null` si elle n'existe pas. */
export async function lireCachePermis(
  departement: string,
  maintenant: Date = new Date(),
): Promise<EntreeCachePermis | null> {
  assertDepartement(departement);
  const lignes = await db
    .select({ chargeLe: cachePermisTable.chargeLe, donnees: cachePermisTable.donnees })
    .from(cachePermisTable)
    .where(eq(cachePermisTable.departement, departement));
  const ligne = lignes[0];
  if (!ligne) return null;

  const chargeLe = new Date(ligne.chargeLe);
  return {
    permis: ligne.donnees as PermisPublic[],
    chargeLe,
    frais: maintenant.getTime() - chargeLe.getTime() < TTL_CACHE_PERMIS_MS,
  };
}

/**
 * Enregistre la réponse de la source.
 *
 * `charge_le` est posé explicitement plutôt que laissé au défaut : les tests
 * doivent pouvoir fabriquer une entrée périmée sans attendre vingt-quatre
 * heures, et une garde qu'on ne peut pas éprouver ne protège rien.
 */
export async function ecrireCachePermis(
  departement: string,
  permis: readonly PermisPublic[],
  chargeLe: Date = new Date(),
): Promise<void> {
  assertDepartement(departement);
  await db
    .insert(cachePermisTable)
    .values({ departement, chargeLe, donnees: permis })
    .onConflictDoUpdate({
      target: cachePermisTable.departement,
      set: { chargeLe: sql`excluded.charge_le`, donnees: sql`excluded.donnees` },
    });
}
