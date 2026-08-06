import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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

export default app;
