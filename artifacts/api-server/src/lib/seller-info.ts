/**
 * Chargement des coordonnées vendeur (`SellerInfo`) depuis les réglages du
 * tenant — module unique remplaçant trois copies indépendantes
 * (`factures.ts`, `avoirs.ts`, `pdf-devis.ts`) qui avaient dérivé : c'est
 * exactement cette duplication qui a causé le bug corrigé par
 * `vendeur-cle-onboarding.test.ts` (clés de settings legacy lues par deux
 * des trois copies mais jamais par la troisième). Un seul mapping
 * `settings → SellerInfo`, une seule fois.
 */
import { sql } from "drizzle-orm";
import { withTenant, settingsTable } from "@workspace/db";
import type { SellerInfo } from "./pdf-generation.js";

/** Réglages `company.*` bruts d'un tenant, clé → valeur. Une seule requête. */
export async function loadCompanySettings(tenantId: string): Promise<Record<string, string>> {
  const rows = await withTenant(tenantId, async tx =>
    tx.select().from(settingsTable).where(sql`${settingsTable.tenantId} = ${tenantId}::uuid`),
  );
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

/**
 * Traduit les réglages bruts en `SellerInfo`. PURE — exportée séparément
 * pour les appelants qui ont besoin d'une AUTRE donnée dérivée des mêmes
 * réglages dans la même requête (`factures.ts` a aussi besoin du vertical
 * du tenant pour `auditMentionsFR`) plutôt que d'interroger `settings` deux
 * fois.
 */
export function sellerInfoFromSettings(byKey: Record<string, string>): SellerInfo {
  return {
    nom: (byKey["company.raison_sociale"] as string | undefined) ?? "Entreprise",
    formeJuridique: byKey["company.forme_juridique"] as string | undefined,
    siret: (byKey["company.siret"] as string | undefined) ?? "",
    siren: byKey["company.siren"] as string | undefined,
    tvaIntracom: byKey["company.tva_intracom"] as string | undefined,
    adresse: byKey["company.adresse"] as string | undefined,
    codePostal: byKey["company.code_postal"] as string | undefined,
    ville: byKey["company.commune"] as string | undefined,
    decennaleAssureur: byKey["company.decennale_assureur"] as string | undefined,
    decennaleNumero: byKey["company.decennale_numero"] as string | undefined,
    decennaleCouverture: byKey["company.decennale_couverture"] as string | undefined,
    numeroOrdre: byKey["company.numero_ordre"] as string | undefined,
    capitalSocial: byKey["company.capital"] as string | undefined,
    rcsVille: byKey["company.rcs_ville"] as string | undefined,
    tvaFranchise: byKey["company.tva_franchise"] === "true",
  };
}

/** Coordonnées de l'émetteur, lues dans les réglages du tenant. */
export async function loadSellerInfo(tenantId: string): Promise<SellerInfo> {
  return sellerInfoFromSettings(await loadCompanySettings(tenantId));
}
