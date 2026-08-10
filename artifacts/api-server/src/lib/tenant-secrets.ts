/**
 * Accès au magasin de secrets — LE seul chemin de code qui chiffre et déchiffre.
 *
 * Tout passe par ici, sans exception. C'est ce qui rend la garde structurelle
 * possible : une colonne `*_password` ailleurs signifie forcément qu'on a
 * contourné ce fichier.
 *
 * ── Ce qui ne sort jamais d'ici ─────────────────────────────────────────────
 * Une valeur en clair n'est ni journalisée, ni rendue dans une réponse HTTP, ni
 * incluse dans un message d'erreur. Les fonctions qui lisent rendent la valeur
 * à leur appelant immédiat et rien d'autre : au-dessus, on manipule des
 * booléens (« un mot de passe est-il enregistré ? ») et jamais la valeur.
 */
import { eq, and } from "drizzle-orm";
import { withTenant, tenantSecretsTable } from "@workspace/db";
import { chiffrer, dechiffrer, type IdentiteSecret } from "@nodaq/crypto";

/**
 * Enregistre ou remplace un secret.
 *
 * `versionCle` repart de 1 : le chiffré est neuf, il n'a jamais été re-clé.
 */
export async function enregistrerSecret(
  tenantId: string,
  cle: string,
  clair: string,
): Promise<void> {
  const identite: IdentiteSecret = { tenantId, cle };
  const { valeur, versionCle } = chiffrer(clair, identite);

  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(tenantSecretsTable)
      .values({ tenantId, cle, valeurChiffree: valeur, versionCle })
      .onConflictDoUpdate({
        target: [tenantSecretsTable.tenantId, tenantSecretsTable.cle],
        set: { valeurChiffree: valeur, versionCle, updatedAt: new Date() },
      });
  });
}

/**
 * Lit un secret en clair. `null` s'il n'y en a pas.
 *
 * Lève si la ligne existe mais ne se déchiffre pas — mauvaise clé, chiffré
 * altéré, ligne recopiée depuis un autre tenant. On ne rend PAS `null` dans ce
 * cas : « pas de mot de passe » et « le mot de passe est illisible » appellent
 * deux réactions opposées, et les confondre ferait retomber l'envoi en repli
 * sans que personne ne comprenne pourquoi.
 */
export async function lireSecret(tenantId: string, cle: string): Promise<string | null> {
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .select({ valeurChiffree: tenantSecretsTable.valeurChiffree })
      .from(tenantSecretsTable)
      .where(and(eq(tenantSecretsTable.tenantId, tenantId), eq(tenantSecretsTable.cle, cle))),
  );
  if (!ligne) return null;
  return dechiffrer(ligne.valeurChiffree, { tenantId, cle });
}

/**
 * Un secret est-il enregistré ? Sans le déchiffrer.
 *
 * C'est ce que les routes exposent à l'interface — « mot de passe enregistré :
 * oui » — plutôt qu'une valeur masquée, qui obligerait à la lire pour l'étoiler.
 */
export async function secretExiste(tenantId: string, cle: string): Promise<boolean> {
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .select({ cle: tenantSecretsTable.cle })
      .from(tenantSecretsTable)
      .where(and(eq(tenantSecretsTable.tenantId, tenantId), eq(tenantSecretsTable.cle, cle))),
  );
  return ligne !== undefined;
}

/** Révoque un secret. Une table non append-only sert exactement à ça. */
export async function revoquerSecret(tenantId: string, cle: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .delete(tenantSecretsTable)
      .where(and(eq(tenantSecretsTable.tenantId, tenantId), eq(tenantSecretsTable.cle, cle))),
  );
}
