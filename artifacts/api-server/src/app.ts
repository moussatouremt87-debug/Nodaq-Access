import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const app: Express = express();

// ── CORS: strict allowlist — localhost and the exact Replit dev domain ──────
const devDomain = process.env.REPLIT_DEV_DOMAIN; // e.g. "abc123.id.repl.co"

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests and server-to-server calls have no Origin header.
      if (!origin) { callback(null, true); return; }

      // Exact localhost / 127.0.0.1 match (any port)
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin) ||
          /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }

      // Exact Replit dev domain — both bare and with explicit port
      if (devDomain) {
        const bare  = `https://${devDomain}`;
        const bare2 = `http://${devDomain}`;
        if (origin === bare || origin === bare2 ||
            origin.startsWith(`${bare}:`) || origin.startsWith(`${bare2}:`)) {
          callback(null, true);
          return;
        }
      }

      callback(new Error(`CORS: origin not allowed: ${origin}`));
    },
    credentials: true,
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Signed-cookie support — SESSION_SECRET is required; fail fast if absent
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error("[app] SESSION_SECRET environment variable is required");
  process.exit(1);
}
app.use(cookieParser(sessionSecret));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ── DB role verification — runs once at startup ───────────────────────────────
// The application pool must run as app_user (non-owner) so that PostgreSQL RLS
// policies are enforced. If current_user comes back as the table owner (e.g.
// "postgres"), RLS policies are bypassed and data isolation is broken.
pool.query("SELECT current_user").then((result) => {
  const currentUser: string = result.rows[0]?.current_user ?? "unknown";
  if (currentUser !== "app_user") {
    logger.error(
      { currentUser },
      "[startup] SECURITY: DB pool is running as '%s' instead of 'app_user'. " +
        "Set DATABASE_URL_APP to a connection string that authenticates as app_user. " +
        "Without this, PostgreSQL RLS policies will be bypassed.",
      currentUser,
    );
    // Do not exit — the app remains reachable so the error is visible in logs.
    // Phase 3 RLS enforcement will make this critical; address it before then.
  } else {
    logger.info("[startup] DB user verified: %s ✓", currentUser);
  }
}).catch((err: Error) => {
  logger.error({ err }, "[startup] Could not verify DB user: %s", err.message);
});

export default app;
