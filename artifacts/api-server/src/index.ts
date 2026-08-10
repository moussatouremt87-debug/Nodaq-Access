import app from "./app";
import { logger } from "./lib/logger";
import { verifierConfigurationChiffrement } from "@nodaq/crypto";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── PUBLIC_URL guard ──────────────────────────────────────────────────────────
// PUBLIC_URL is the canonical origin of this deployment (scheme + host, no path).
// Example: https://app.nodaq.fr
// In production this is required so CORS, cookies and links work correctly
// without any dependency on Replit-specific environment variables.
// In development, REPLIT_DEV_DOMAIN is accepted as a fallback with a warning.
if (!process.env["PUBLIC_URL"]) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "PUBLIC_URL environment variable is required in production. " +
        "Set it to the canonical origin of this deployment (e.g. https://app.nodaq.fr).",
    );
  } else if (process.env["REPLIT_DEV_DOMAIN"]) {
    // Dev fallback — Replit provides REPLIT_DEV_DOMAIN automatically
    console.warn(
      "[startup] PUBLIC_URL not set — falling back to REPLIT_DEV_DOMAIN for CORS. " +
        "Set PUBLIC_URL on any non-Replit host.",
    );
  }
}

// ── LLM configuration guard ──────────────────────────────────────────────────
// Fail fast at startup so a misconfigured deployment is immediately visible.
// All three routing variables are required — no defaults, no fallbacks.
if (!process.env["LLM_BASE_URL"]) {
  throw new Error("LLM configuration error: LLM_BASE_URL must be set.");
}
if (!process.env["LLM_API_KEY"]) {
  throw new Error("LLM configuration error: LLM_API_KEY must be set.");
}
if (!process.env["LLM_MODEL_CHAT"]) {
  throw new Error("LLM configuration error: LLM_MODEL_CHAT must be set.");
}

// ── Encryption configuration guard ───────────────────────────────────────────
// ENCRYPTION_KEY absente, mal encodée ou de mauvaise longueur : on s'arrête.
//
// JAMAIS DE REPLI EN CLAIR. Un démarrage qui « fonctionne » sans clé et range
// les secrets en clair est le pire résultat possible — personne ne le remarque,
// et le jour où on s'en aperçoit tous les secrets sont à révoquer.
//
// Le message d'erreur ne porte que le NOM de la variable. La valeur, même
// tronquée, n'apparaît nulle part : les journaux de démarrage sont archivés.
verifierConfigurationChiffrement();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
