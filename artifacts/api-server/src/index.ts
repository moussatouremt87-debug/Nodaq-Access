import app from "./app";
import { logger } from "./lib/logger";

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
// LITELLM_BASE_URL and LLM_MODEL have safe defaults in getConfig(), so only
// the key is required — either LITELLM_API_KEY or the legacy MISTRAL_API_KEY.
const hasLitellmKey = Boolean(process.env["LITELLM_API_KEY"]);
const hasMistralKey = Boolean(process.env["MISTRAL_API_KEY"]);
if (!hasLitellmKey && !hasMistralKey) {
  throw new Error(
    "LLM configuration error: either \"LITELLM_API_KEY\" or \"MISTRAL_API_KEY\" must be set.",
  );
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
