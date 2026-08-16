/**
 * Vérification de signature des webhooks Bridge.
 *
 * En-tête `BridgeApi-Signature`, format `t=<horodatage>,v1=<hmac>` (un ou
 * plusieurs schémas séparés par virgule — seul `v1` est reconnu, tout autre
 * schéma est ignoré pour ne jamais accepter une rétrogradation vers un
 * algorithme plus faible). HMAC-SHA256 du corps BRUT (jamais reparsé — un
 * JSON.stringify(JSON.parse(...)) ne reproduit pas les octets signés) avec
 * le secret du webhook.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_HEADER = "bridgeapi-signature";

function extraireSignaturesV1(header: string): string[] {
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice("v1=".length));
}

/**
 * `rawBody` doit être les octets EXACTS reçus (voir `req.rawBody`,
 * `app.ts`) — jamais une resérialisation de `req.body`.
 */
export function verifierSignatureWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  webhookSecret: string,
): boolean {
  const brut = headers[SIGNATURE_HEADER];
  const header = Array.isArray(brut) ? brut[0] : brut;
  if (!header) return false;

  const signatures = extraireSignaturesV1(header);
  if (signatures.length === 0) return false;

  const attendu = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const attenduBuf = Buffer.from(attendu, "hex");

  return signatures.some((sig) => {
    // Buffer.from(str, "hex") ne lève jamais — une chaîne invalide produit
    // un buffer tronqué, rejeté par la comparaison de longueur ci-dessous.
    const recu = Buffer.from(sig, "hex");
    return recu.length === attenduBuf.length && timingSafeEqual(recu, attenduBuf);
  });
}
