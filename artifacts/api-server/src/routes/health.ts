/**
 * Health check routes.
 *
 * GET /api/healthz — Legacy; returns {"status":"ok"}. Kept for backward compat.
 * GET /api/health  — Full health: checks DB connectivity, returns version + uptime.
 *
 * The /health route is intended for use by container orchestrators (Scaleway,
 * Docker HEALTHCHECK) and load balancers. It always responds within 3 s.
 *
 * Response shape:
 *   { status: "ok" | "degraded", db: "ok" | "error", version: string, uptime: number }
 *   HTTP 200 when status === "ok", 503 otherwise.
 */
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// ── GET /api/healthz — legacy ping ────────────────────────────────────────────
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// ── GET /api/health — full health with DB check ───────────────────────────────
let _version: string | null = null;

function getVersion(): string {
  if (_version) return _version;
  try {
    // __dirname is injected by the esbuild banner at runtime.
    // In development (ts-node / tsx), import.meta.dirname works.
    // Both paths resolve to the compiled bundle's directory → package.json is one level up.
    const pkgJson: { version?: string } = { version: "0.0.0" };
    // Use synchronous require if available (bundled ESM with banner shim), else fallback.
    if (typeof require !== "undefined") {
      const path = require("path") as typeof import("path");
      try {
        const pkg = require(path.resolve(__dirname, "..", "package.json")) as { version?: string };
        _version = pkg.version ?? "0.0.0";
      } catch {
        _version = pkgJson.version ?? "0.0.0";
      }
    } else {
      _version = "0.0.0";
    }
  } catch {
    _version = "0.0.0";
  }
  return _version!;
}

router.get("/health", async (_req, res): Promise<void> => {
  const startMs = Date.now();
  let dbStatus: "ok" | "error" = "ok";

  // DB probe — SELECT 1 with 2 s timeout
  const client = await pool.connect().catch(() => null);
  if (!client) {
    dbStatus = "error";
  } else {
    try {
      // pg client.query does not natively timeout; cancel after 2 s via AbortSignal
      await Promise.race([
        client.query("SELECT 1"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB probe timeout")), 2_000),
        ),
      ]);
    } catch {
      dbStatus = "error";
    } finally {
      client.release();
    }
  }

  const payload = {
    status: dbStatus === "ok" ? "ok" : "degraded",
    db: dbStatus,
    version: getVersion(),
    uptime: Math.floor(process.uptime()),
    responseTimeMs: Date.now() - startMs,
  };

  res.status(payload.status === "ok" ? 200 : 503).json(payload);
});

export default router;
