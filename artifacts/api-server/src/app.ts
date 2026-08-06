import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ── CORS: restrict to the Replit dev domain + localhost ────────────────────
const allowedOrigins: (string | RegExp)[] = [
  /^http:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

const devDomain = process.env.REPLIT_DEV_DOMAIN;
if (devDomain) {
  allowedOrigins.push(new RegExp(`https?://${devDomain.replace(".", "\\.")}.*`));
}

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true, // allow cookies to be sent
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
