/**
 * Bridge (ex-Bankin') — point de sortie UNIQUE pour l'agrégation bancaire
 * (connecteur « Banque »).
 *
 * INVARIANT (même discipline que `lib/llm`/`lib/plateforme-agreee`) : ce
 * fichier n'importe jamais de SDK fournisseur. Toute communication passe par
 * `fetch`. Tout secret vient de `getConfig()` — jamais de valeur par défaut,
 * jamais un secret en dur ailleurs dans le dépôt. La garde
 * `banque-agreee-single-exit.test.ts` fait respecter cet invariant.
 *
 * CONTRAT RÉEL, PAS PROVISOIRE : contrairement à `lib/plateforme-agreee`
 * (aucun fournisseur choisi), Bridge est le fournisseur RETENU. Le contrat
 * ci-dessous est sourcé sur docs.bridgeapi.io (vérifié le 2026-08-16) :
 *   - Identité PLATEFORME : Client-Id/Client-Secret (un seul compte Bridge
 *     pour tout NODAQ, jamais par tenant).
 *   - Un tenant = un « user » Bridge, créé une fois via `external_user_id`
 *     = notre tenantId — aucune table de correspondance à maintenir.
 *   - Le token utilisateur (2h) s'obtient à la demande et n'est JAMAIS
 *     persisté — le recréer coûte un aller-retour HTTP, pas une expiration
 *     à gérer en base.
 *
 * ZONES À VÉRIFIER CONTRE UN VRAI SANDBOX AVANT MISE EN PRODUCTION (notées
 * explicitement, pas masquées) :
 *   - L'unité du champ `balance` renvoyé par GET /accounts. Convention
 *     Bridge documentée : unité MAJEURE (ex. 1234.56 €), pas des centimes —
 *     d'où la conversion `Math.round(balance * 100)` ci-dessous. À
 *     confirmer sur une vraie réponse avant la vérification live de PR2.
 *   - L'authentification exacte de POST /users (Client-Id/Client-Secret
 *     supposés, comme pour /connect-sessions — la doc consultée ne montrait
 *     pas ce détail précis pour cet endpoint spécifique).
 */

import { BanqueConfigError, BanqueNetworkError, BanqueResponseError } from "./errors.js";

const BRIDGE_BASE_URL = "https://api.bridgeapi.io";
const BRIDGE_VERSION = "2025-01-15";

// ─── Config resolution ──────────────────────────────────────────────────────

export interface BanqueConfig {
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
}

/**
 * Resolve Bridge config from environment variables.
 *
 * Reads: BRIDGE_CLIENT_ID, BRIDGE_CLIENT_SECRET, BRIDGE_WEBHOOK_SECRET. No
 * default values — every missing variable throws BanqueConfigError. A
 * caller must catch it and respond 503, exactly like the other
 * provider-config routes do for their own config errors (LLM, plateforme
 * agréée).
 */
export function getConfig(): BanqueConfig {
  const clientId = process.env["BRIDGE_CLIENT_ID"];
  if (!clientId) throw new BanqueConfigError("BRIDGE_CLIENT_ID");

  const clientSecret = process.env["BRIDGE_CLIENT_SECRET"];
  if (!clientSecret) throw new BanqueConfigError("BRIDGE_CLIENT_SECRET");

  const webhookSecret = process.env["BRIDGE_WEBHOOK_SECRET"];
  if (!webhookSecret) throw new BanqueConfigError("BRIDGE_WEBHOOK_SECRET");

  return { clientId, clientSecret, webhookSecret };
}

/**
 * Secret du webhook de PAIEMENT (ticket 4.19), distinct de celui de
 * l'agrégation : chez Bridge, un webhook est déclaré par app avec son propre
 * secret, et l'app qui porte « Bank payment » n'est pas forcément celle qui
 * porte l'agrégation (une app sandbox ne partage rien avec la production).
 *
 * Rend `null` plutôt que de lever : un déploiement sans liens de paiement est
 * légitime, et la route répond alors 503. Jamais de repli sur le secret de
 * l'agrégation — accepter un webhook signé avec le mauvais secret reviendrait
 * à ne pas le vérifier du tout.
 */
export function secretWebhookPaiement(): string | null {
  return process.env["BRIDGE_PAYMENT_WEBHOOK_SECRET"] || null;
}

/**
 * Identité de l'app qui porte l'INITIATION DE PAIEMENT.
 *
 * Deux montages sont légitimes, et le choix appartient à l'exploitant :
 *
 *   — « Bank payment » activé sur l'app d'agrégation : rien à déclarer, les
 *     identifiants de `getConfig()` conviennent ;
 *   — une app SÉPARÉE (typiquement un bac à sable, dont la doc Bridge dit que
 *     rien n'y est transférable vers la production) : ses identifiants vivent
 *     alors dans `BRIDGE_PAYMENT_CLIENT_ID` / `_SECRET`.
 *
 * Ce n'est PAS une valeur par défaut au sens de la règle 2 : il n'y a pas de
 * secret inventé ici. Il y a un montage à une app et un montage à deux, et on
 * lit lequel l'exploitant a déclaré. Les deux variables vont ENSEMBLE — n'en
 * poser qu'une est une erreur de configuration, pas un montage : on lève,
 * plutôt que d'aller chercher la moitié manquante dans l'autre app.
 */
export function configPaiement(): BanqueConfig {
  const clientId = process.env["BRIDGE_PAYMENT_CLIENT_ID"];
  const clientSecret = process.env["BRIDGE_PAYMENT_CLIENT_SECRET"];

  if (!clientId && !clientSecret) return getConfig();

  if (!clientId) throw new BanqueConfigError("BRIDGE_PAYMENT_CLIENT_ID");
  if (!clientSecret) throw new BanqueConfigError("BRIDGE_PAYMENT_CLIENT_SECRET");

  return {
    clientId,
    clientSecret,
    // Le secret de webhook de `BanqueConfig` sert à l'agrégation ; celui du
    // paiement se lit par `secretWebhookPaiement()`, et la route de paiement
    // n'utilise que celui-là. On ne recopie donc rien ici.
    webhookSecret: "",
  };
}

function appHeaders(config: BanqueConfig): Record<string, string> {
  return {
    "Bridge-Version": BRIDGE_VERSION,
    "Client-Id": config.clientId,
    "Client-Secret": config.clientSecret,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function readJsonOrThrow(res: Response, contexte: string): Promise<unknown> {
  if (!res.ok) {
    const corps = await res.text().catch(() => "(no body)");
    throw new BanqueNetworkError(res.status, corps);
  }
  try {
    return await res.json();
  } catch {
    throw new BanqueResponseError(`${contexte} : réponse non-JSON`);
  }
}

// ─── Utilisateur Bridge (un par tenant) ─────────────────────────────────────

export interface BanqueUtilisateur {
  uuid: string;
}

/**
 * Crée le « user » Bridge d'un tenant, avec `external_user_id` = tenantId.
 * Idempotent côté appelant : `bank_connections` ne stocke qu'une ligne par
 * tenant — n'appeler qu'une fois, à la première connexion.
 */
export async function creerUtilisateur(
  config: BanqueConfig,
  tenantId: string,
): Promise<BanqueUtilisateur> {
  const t0 = Date.now();
  let httpStatus = 0;
  try {
    const res = await fetch(`${BRIDGE_BASE_URL}/v3/aggregation/users`, {
      method: "POST",
      headers: appHeaders(config),
      body: JSON.stringify({ external_user_id: tenantId }),
    });
    httpStatus = res.status;
    const data = (await readJsonOrThrow(res, "creerUtilisateur")) as { uuid?: string };
    console.info(
      "[banque-agreee] créer utilisateur ok",
      JSON.stringify({ status: httpStatus, durationMs: Date.now() - t0 }),
    );
    if (typeof data.uuid !== "string") {
      throw new BanqueResponseError("creerUtilisateur : uuid manquant");
    }
    return { uuid: data.uuid };
  } catch (err) {
    console.info(
      "[banque-agreee] créer utilisateur error",
      JSON.stringify({ status: httpStatus, durationMs: Date.now() - t0 }),
    );
    throw err;
  }
}

/**
 * Token utilisateur (2h), obtenu à la demande — JAMAIS persisté. Interne :
 * seules les fonctions ci-dessous, agissant AU NOM d'un tenant déjà
 * provisionné, en ont besoin.
 */
async function obtenirTokenUtilisateur(config: BanqueConfig, tenantId: string): Promise<string> {
  const res = await fetch(`${BRIDGE_BASE_URL}/v3/aggregation/authorization/token`, {
    method: "POST",
    headers: appHeaders(config),
    body: JSON.stringify({ external_user_id: tenantId }),
  });
  const data = (await readJsonOrThrow(res, "obtenirTokenUtilisateur")) as { access_token?: string };
  if (typeof data.access_token !== "string") {
    throw new BanqueResponseError("obtenirTokenUtilisateur : access_token manquant");
  }
  return data.access_token;
}

// ─── Session de connexion (Bridge Connect) ──────────────────────────────────

export interface SessionConnexion {
  id: string;
  /** URL du funnel hébergé par Bridge — à rediriger le navigateur dessus. */
  url: string;
}

/**
 * Crée une session Bridge Connect pour un tenant déjà provisionné
 * (`creerUtilisateur` déjà appelé) : choix de la banque + consentement,
 * hébergé par Bridge. `callbackUrl` ramène l'utilisateur chez nous après.
 */
export async function creerSessionConnexion(
  config: BanqueConfig,
  tenantId: string,
  callbackUrl: string,
): Promise<SessionConnexion> {
  const t0 = Date.now();
  let httpStatus = 0;
  try {
    const token = await obtenirTokenUtilisateur(config, tenantId);
    const res = await fetch(`${BRIDGE_BASE_URL}/v3/aggregation/connect-sessions`, {
      method: "POST",
      headers: {
        "Bridge-Version": BRIDGE_VERSION,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ callback_url: callbackUrl }),
    });
    httpStatus = res.status;
    const data = (await readJsonOrThrow(res, "creerSessionConnexion")) as {
      id?: string;
      url?: string;
    };
    console.info(
      "[banque-agreee] créer session connexion ok",
      JSON.stringify({ status: httpStatus, durationMs: Date.now() - t0 }),
    );
    if (typeof data.id !== "string" || typeof data.url !== "string") {
      throw new BanqueResponseError("creerSessionConnexion : id ou url manquant");
    }
    return { id: data.id, url: data.url };
  } catch (err) {
    console.info(
      "[banque-agreee] créer session connexion error",
      JSON.stringify({ status: httpStatus, durationMs: Date.now() - t0 }),
    );
    throw err;
  }
}

// ─── Comptes ─────────────────────────────────────────────────────────────

export interface CompteBancaire {
  /** Identifiant Bridge du compte. */
  id: string;
  label: string;
  balanceCents: number;
  devise: string;
}

/** Liste les comptes bancaires connectés d'un tenant, avec leur solde. */
export async function listerComptes(
  config: BanqueConfig,
  tenantId: string,
): Promise<CompteBancaire[]> {
  const t0 = Date.now();
  let httpStatus = 0;
  try {
    const token = await obtenirTokenUtilisateur(config, tenantId);
    const res = await fetch(`${BRIDGE_BASE_URL}/v3/aggregation/accounts`, {
      method: "GET",
      headers: {
        "Bridge-Version": BRIDGE_VERSION,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    httpStatus = res.status;
    const data = (await readJsonOrThrow(res, "listerComptes")) as {
      resources?: Array<{ id?: number | string; name?: string; balance?: number; currency_code?: string }>;
    };
    console.info(
      "[banque-agreee] lister comptes ok",
      JSON.stringify({ status: httpStatus, durationMs: Date.now() - t0, count: data.resources?.length ?? 0 }),
    );
    if (!Array.isArray(data.resources)) {
      throw new BanqueResponseError("listerComptes : resources manquant");
    }
    return data.resources.map((c, i) => {
      if (c.id === undefined || typeof c.balance !== "number") {
        throw new BanqueResponseError(`listerComptes : compte[${i}] incomplet`);
      }
      return {
        id: String(c.id),
        label: c.name ?? "Compte",
        // Bridge renvoie le solde en unité MAJEURE — voir l'avertissement en
        // tête de fichier.
        balanceCents: Math.round(c.balance * 100),
        devise: c.currency_code ?? "EUR",
      };
    });
  } catch (err) {
    console.info(
      "[banque-agreee] lister comptes error",
      JSON.stringify({ status: httpStatus, durationMs: Date.now() - t0 }),
    );
    throw err;
  }
}
