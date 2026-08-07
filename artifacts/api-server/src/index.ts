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
