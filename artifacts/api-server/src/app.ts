import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

const app: Express = express();

// ── Confiance dans le mandataire ─────────────────────────────────────────────
// `req.ip` détermine deux choses qui comptent : la limitation de débit des
// routes publiques, et `devis.accepted_ip`, qui est une preuve d'engagement.
//
// Lire `x-forwarded-for` à la main, comme le faisait ce serveur, revient à
// laisser le CLIENT choisir son adresse : il contourne la limite en variant
// l'en-tête, et il inscrit l'adresse de son choix dans la preuve. L'en-tête
// n'est digne de foi que derrière un mandataire qui le réécrit.
//
// `trust proxy` non défini ⇒ Express rend l'adresse de la SOCKET, qui ne se
// forge pas. C'est le défaut sûr. En production derrière un répartiteur, poser
// TRUST_PROXY=1 (ou le nombre de sauts) pour retrouver l'adresse du client —
// sans quoi tous les clients partagent le compteur du répartiteur.
const trustProxy = process.env["TRUST_PROXY"];
if (trustProxy) {
  const sauts = Number(trustProxy);
  app.set("trust proxy", Number.isInteger(sauts) && sauts > 0 ? sauts : trustProxy);
}

// ── CORS ─────────────────────────────────────────────────────────────────────
// Allowed origins, in priority order:
//   1. localhost / 127.0.0.1 (any port) — dev convenience
//   2. PUBLIC_URL — the canonical production origin (e.g. https://app.nodaq.fr)
//   3. REPLIT_DEV_DOMAIN — dev fallback when no PUBLIC_URL; not set on Scaleway
//   4. IP privée de réseau local, EN DÉVELOPPEMENT SEULEMENT — pour tester
//      depuis un téléphone sur le même Wi-Fi que le Mac qui sert l'appli.
//
// NOTE: REPLIT_DEV_DOMAIN is intentionally a fallback — it must never be the
// sole allowed origin in production. Set PUBLIC_URL on any non-Replit host.
const publicUrl   = process.env.PUBLIC_URL;         // e.g. "https://app.nodaq.fr"
const devDomain   = process.env.REPLIT_DEV_DOMAIN;  // e.g. "abc123.id.repl.co"

// RFC 1918 — 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16. HTTP seulement (jamais
// de certificat valide sur une IP locale) et jamais en production : un artisan
// qui teste depuis son téléphone sur son propre Wi-Fi n'a rien à voir avec un
// déploiement public, où seule PUBLIC_URL doit compter.
const ORIGINE_RESEAU_LOCAL =
  /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

function isAllowedOrigin(origin: string): boolean {
  // Exact localhost / 127.0.0.1 match (any port)
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
    return true;
  }

  // PUBLIC_URL — canonical production origin (scheme + host only, no trailing slash)
  if (publicUrl) {
    const base = publicUrl.replace(/\/$/, "");
    if (origin === base || origin.startsWith(`${base}:`)) return true;
  }

  // REPLIT_DEV_DOMAIN — dev-only fallback (absent on Scaleway and other hosts)
  if (devDomain) {
    const bare  = `https://${devDomain}`;
    const bare2 = `http://${devDomain}`;
    if (origin === bare || origin === bare2 ||
        origin.startsWith(`${bare}:`) || origin.startsWith(`${bare2}:`)) {
      return true;
    }
  }

  // PAS un test sur NODE_ENV : cette variable vaut "production" même en
  // local, dès qu'on sert le SPA construit (app.ts plus bas) — ce test-là
  // serait donc systématiquement vrai, y compris en local. PUBLIC_URL
  // pointant sur localhost, en revanche, ne peut JAMAIS être vrai pour un
  // déploiement public réel : c'est le signal fiable que cette instance sert
  // un test local, pas un déploiement.
  const estInstanceLocale = Boolean(
    publicUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl),
  );

  // IP de réseau local — test depuis un téléphone sur le même Wi-Fi que le
  // Mac qui sert l'appli.
  if (estInstanceLocale && ORIGINE_RESEAU_LOCAL.test(origin)) {
    return true;
  }

  // Tunnel loca.lt — test depuis un lieu qui n'est PAS sur le même réseau que
  // la machine qui sert l'appli (ex. bureau, Mac resté à la maison). Sous-
  // domaine engendré à chaque tunnel, jamais fixé en dur : n'importe lequel
  // est accepté tant que cette instance reste une instance locale.
  if (estInstanceLocale && /^https:\/\/[a-z0-9-]+\.loca\.lt$/.test(origin)) {
    return true;
  }

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests and server-to-server calls have no Origin header.
      if (!origin) { callback(null, true); return; }
      if (isAllowedOrigin(origin)) { callback(null, true); return; }
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

// ── Static frontend (production only) ─────────────────────────────────────────
// In the Docker image the Vite build is copied to /app/public/.
// At runtime __dirname resolves to the bundle directory (/app/dist/), so
// the public dir is one level up.  In development this directory does not exist
// and the condition below keeps the dev server unaffected.
if (process.env.NODE_ENV === "production") {
  const publicDir = path.resolve(__dirname, "..", "public");
  app.use(express.static(publicDir));

  // SPA fallback — serve index.html for any unmatched path so client-side
  // routing (wouter) works correctly when the user navigates directly to a deep URL.
  app.use((_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

// ── DB role verification — runs once at startup ───────────────────────────────
// The application pool MUST run as app_user (non-owner) so that PostgreSQL RLS
// policies are enforced. If current_user is the table owner, RLS is bypassed
// and tenant data isolation cannot be guaranteed. We therefore exit hard.
pool.query("SELECT current_user").then((result) => {
  const currentUser: string = result.rows[0]?.current_user ?? "unknown";
  if (currentUser !== "app_user") {
    logger.error(
      { currentUser },
      "[startup] FATAL: DB pool is running as '%s' instead of 'app_user'. " +
        "DATABASE_URL_APP must point to a connection authenticated as app_user. " +
        "Run `node lib/db/scripts/create-app-role.cjs` and update the secret. " +
        "Shutting down to prevent RLS bypass.",
      currentUser,
    );
    process.exit(1);
  }
  logger.info("[startup] DB user verified: %s ✓", currentUser);
}).catch((err: Error) => {
  logger.error(
    { err },
    "[startup] FATAL: Could not verify DB user (%s). Shutting down.",
    err.message,
  );
  process.exit(1);
});

export default app;
