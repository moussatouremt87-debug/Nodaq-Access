/**
 * État effectif des modules pour un tenant — point d'entrée UNIQUE.
 *
 * `resolveModules` (`lib/shared/src/moduleCatalog.ts`) était écrit, testé et
 * commenté depuis des mois sans être appelé nulle part. Ce fichier le branche
 * enfin, et il est le seul endroit du serveur qui sache lire les préférences
 * de modules : la navigation et la boîte à outils de l'agent en dépendent
 * toutes les deux, et deux lectures indépendantes finiraient par répondre
 * différemment sur le même tenant.
 *
 * ── Où vivent les choix ─────────────────────────────────────────────────
 * Dans `settings`, sous `modules.<id>`. C'est un réglage d'ENTREPRISE, pas de
 * personne : allumer « Facturation électronique » engage le compte, pas
 * l'écran de celui qui a cliqué. C'est la différence avec le mode simplifié
 * d'US-A8.4, qui est une préférence d'affichage et vit dans le navigateur.
 *
 * Une valeur non booléenne est ignorée par `resolveModules` plutôt que
 * d'exister à moitié : jamais d'exception, jamais de module fantôme.
 */
import { sql } from "drizzle-orm";
import { withTenant, settingsTable } from "@workspace/db";
import { resolveModules, type ResolvedModule } from "@nodaq/shared";
import { verticalDuTenant } from "./vertical-tenant.js";

/** Préfixe des clés de réglage portant un choix de module. */
export const PREFIXE_MODULE = "modules.";

/** `modules.stocks` → `stocks`. */
export function idDepuisCle(cle: string): string {
  return cle.slice(PREFIXE_MODULE.length);
}

/** `"true"` / `"false"` → booléen ; tout le reste → `undefined` (ignoré). */
function versBooleen(valeur: string): boolean | undefined {
  if (valeur === "true") return true;
  if (valeur === "false") return false;
  return undefined;
}

/**
 * L'état résolu de chaque module pour ce tenant : défaut du secteur, écrasé
 * par les choix explicites du propriétaire.
 */
export async function modulesDuTenant(tenantId: string): Promise<ResolvedModule[]> {
  const vertical = await verticalDuTenant(tenantId);

  const lignes = await withTenant(tenantId, async (tx) =>
    tx
      .select({ key: settingsTable.key, value: settingsTable.value })
      .from(settingsTable)
      .where(sql`${settingsTable.key} LIKE ${PREFIXE_MODULE + "%"}`),
  );

  const choix: Record<string, unknown> = {};
  for (const { key, value } of lignes) {
    const booleen = versBooleen(value);
    if (booleen !== undefined) choix[idDepuisCle(key)] = booleen;
  }

  return resolveModules(vertical, choix);
}
