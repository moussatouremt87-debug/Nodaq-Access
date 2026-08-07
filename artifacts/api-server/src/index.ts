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
// Each error names the exact missing variable — never logs its value.
const LLM_REQUIRED = ["LITELLM_BASE_URL", "LITELLM_API_KEY", "LLM_MODEL"] as const;
for (const varName of LLM_REQUIRED) {
  if (!process.env[varName]) {
    throw new Error(
      `LLM configuration error: environment variable "${varName}" is required but was not provided.`,
    );
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
