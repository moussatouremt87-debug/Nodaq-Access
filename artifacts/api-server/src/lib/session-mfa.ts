/**
 * Marquer une session comme ayant prouvé son second facteur.
 *
 * Extrait ici parce que trois chemins y mènent désormais — appareil reconnu,
 * code par courriel, application d'authentification — et qu'une troisième
 * recopie de cette écriture aurait fini par diverger, comme le reste.
 */
import { eq } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";

export async function marquerMfaVerifie(sessionId: string): Promise<void> {
  await db.update(sessionsTable)
    .set({ mfaVerifiedAt: new Date() })
    .where(eq(sessionsTable.id, sessionId));
}
