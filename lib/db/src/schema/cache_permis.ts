import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Cache des permis de construire, PAR DÉPARTEMENT.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SEULE TABLE DU SCHÉMA SANS `tenant_id`, ET C'EST DÉLIBÉRÉ.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ── Pourquoi pas de `tenant_id` ─────────────────────────────────────────────
 * Elle ne contient AUCUNE donnée de locataire. Son contenu est une réponse
 * d'open data publique — la base Sitadel des autorisations d'urbanisme —
 * identique pour tous, indexée par un simple code de département. Deux
 * artisans du même département doivent lire la MÊME ligne.
 *
 * Lui coller un `tenant_id` aurait l'air plus prudent et serait exactement le
 * contraire : la source est plafonnée à 500 requêtes par mois sur le plan
 * gratuit, et un cache par locataire multiplierait les appels par le nombre de
 * locataires au lieu de les diviser. Le cache n'aurait plus servi à rien.
 *
 * La règle 1 du dépôt vise les tables MÉTIER — celles qui portent la donnée
 * d'un client. La garde CI (`pg_class` dans `ci.yml`) le formule de la même
 * façon : elle exige `ENABLE`+`FORCE` de toute table QUI PORTE un `tenant_id`,
 * et ne dit rien de celles qui n'en portent pas. Cette table est donc dans le
 * périmètre de la règle, du bon côté, et non une exception qu'on s'accorde.
 *
 * ── La contrepartie, à tenir ────────────────────────────────────────────────
 * Rien ici ne doit JAMAIS venir d'un locataire ni le distinguer : ni son
 * identifiant, ni sa commune, ni un filtre calculé depuis ses réglages. Le
 * `departement` est déduit d'un code postal public. Si un jour ce cache devait
 * porter la moindre donnée propre à un client, il changerait de nature et
 * devrait redevenir une table à `tenant_id` — cache ou pas.
 *
 * ── Pourquoi en BASE et pas en mémoire ──────────────────────────────────────
 * Le conteneur de production a `min_scale: 0` : il s'endort, et un cache
 * mémoire meurt avec lui — le premier visiteur du réveil rappellerait la
 * source. Il monte aussi jusqu'à 5 instances, qui ne partageraient rien. Un
 * cache mémoire aurait donc consommé le quota plusieurs fois par jour au lieu
 * d'une. Le disque est exclu par ailleurs : il est éphémère.
 */
export const cachePermisTable = pgTable("cache_permis", {
  /** Code département tel que la source l'attend (« 75 », « 971 »). */
  departement: text("departement").primaryKey(),
  /** Quand la source a répondu. Sert au TTL et s'affiche quand on sert périmé. */
  chargeLe: timestamp("charge_le", { withTimezone: true }).notNull().defaultNow(),
  /**
   * La liste de `PermisPublic`, telle que `chercherPermis` l'a rendue.
   *
   * Colonne volumineuse : AUCUNE route ne liste cette table, elle se lit
   * uniquement par clé primaire. C'est la même précaution que celle qui a
   * fait sortir les PDF dans `archived_pdfs` — un `select()` sans projection
   * sur une table listée renverrait tout dans la réponse JSON.
   */
  donnees: jsonb("donnees").notNull(),
});

export type CachePermis = typeof cachePermisTable.$inferSelect;
