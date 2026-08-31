import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const OAuthProviderSchema = z.enum(["PENNYLANE", "STRIPE", "GOOGLE_DRIVE", "SLACK"]);
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;

type ProviderDefinition = {
  clientIdEnv: string;
  clientSecretEnv: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeSeparator: " " | ",";
  tokenAuthentication: "FORM" | "BASIC_CLIENT" | "BASIC_PLATFORM";
  extraAuthorizationParameters?: Record<string, string>;
};

const PROVIDERS: Record<OAuthProvider, ProviderDefinition> = {
  PENNYLANE: {
    clientIdEnv: "PENNYLANE_OAUTH_CLIENT_ID",
    clientSecretEnv: "PENNYLANE_OAUTH_CLIENT_SECRET",
    authorizationUrl: "https://app.pennylane.com/oauth/authorize",
    tokenUrl: "https://app.pennylane.com/oauth/token",
    scopes: ["customers:readonly", "customer_invoices:all", "file_attachments:all"],
    scopeSeparator: " ",
    tokenAuthentication: "FORM",
  },
  STRIPE: {
    clientIdEnv: "STRIPE_OAUTH_CLIENT_ID",
    // Stripe Connect n'échange pas le code avec un « client secret » OAuth :
    // il authentifie la plateforme avec sa clé API secrète.
    clientSecretEnv: "STRIPE_PLATFORM_SECRET_KEY",
    authorizationUrl: "https://connect.stripe.com/oauth/authorize",
    tokenUrl: "https://connect.stripe.com/oauth/token",
    scopes: ["read_write"],
    scopeSeparator: " ",
    tokenAuthentication: "BASIC_PLATFORM",
  },
  GOOGLE_DRIVE: {
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    scopeSeparator: " ",
    tokenAuthentication: "FORM",
    extraAuthorizationParameters: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  SLACK: {
    clientIdEnv: "SLACK_OAUTH_CLIENT_ID",
    clientSecretEnv: "SLACK_OAUTH_CLIENT_SECRET",
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["incoming-webhook"],
    scopeSeparator: ",",
    tokenAuthentication: "BASIC_CLIENT",
  },
};

export class OAuthConnectorError extends Error {
  constructor(
    public readonly code: "NON_CONFIGURE" | "ETAT_INVALIDE" | "FOURNISSEUR_REFUSE" | "FOURNISSEUR_INDISPONIBLE",
    message: string,
  ) {
    super(message);
    this.name = "OAuthConnectorError";
  }
}

function platformCredentials(provider: OAuthProvider): { clientId: string; clientSecret: string } | null {
  const definition = PROVIDERS[provider];
  const clientId = process.env[definition.clientIdEnv]?.trim();
  const clientSecret = process.env[definition.clientSecretEnv]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function oauthAvailable(provider: OAuthProvider): boolean {
  return platformCredentials(provider) !== null;
}

const StatePayloadSchema = z.object({
  provider: OAuthProviderSchema,
  // Empreinte opaque de la session métier : les identifiants tenant et
  // utilisateur ne transitent jamais chez le fournisseur dans `state`.
  subject: z.string().length(43),
  nonce: z.string().min(32),
  expiresAt: z.number().int().positive(),
});
type StatePayload = z.infer<typeof StatePayloadSchema>;

function signingSecret(): string {
  const secret = process.env["SESSION_SECRET"]?.trim();
  if (!secret) throw new OAuthConnectorError("NON_CONFIGURE", "La connexion sécurisée n'est pas disponible.");
  return secret;
}

function signature(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

function sessionSubject(tenantId: string, userId: string): string {
  return createHmac("sha256", signingSecret())
    .update(`nodaq-oauth-subject\0${tenantId}\0${userId}`)
    .digest("base64url");
}

function createOAuthState(input: {
  provider: OAuthProvider;
  tenantId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}): string {
  const payload = Buffer.from(JSON.stringify({
    provider: input.provider,
    subject: sessionSubject(input.tenantId, input.userId),
    nonce: input.nonce,
    expiresAt: input.expiresAt,
  })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

/** Empreinte persistable d'une tentative : le nonce brut reste dans le cookie. */
export function oauthAttemptFingerprint(provider: OAuthProvider, nonce: string): string {
  return createHmac("sha256", signingSecret())
    .update(`nodaq-oauth-attempt\0${provider}\0${nonce}`)
    .digest("base64url");
}

export function verifyOAuthState(
  state: string,
  expected: { provider: OAuthProvider; tenantId: string; userId: string; nonce: string },
): StatePayload {
  const [payload, receivedSignature, extra] = state.split(".");
  if (!payload || !receivedSignature || extra) {
    throw new OAuthConnectorError("ETAT_INVALIDE", "Cette autorisation n'est plus valable. Recommencez la connexion.");
  }
  const expectedSignature = signature(payload);
  const received = Buffer.from(receivedSignature);
  const signed = Buffer.from(expectedSignature);
  if (received.length !== signed.length || !timingSafeEqual(received, signed)) {
    throw new OAuthConnectorError("ETAT_INVALIDE", "Cette autorisation n'est plus valable. Recommencez la connexion.");
  }
  let parsed: StatePayload;
  try {
    parsed = StatePayloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    throw new OAuthConnectorError("ETAT_INVALIDE", "Cette autorisation n'est plus valable. Recommencez la connexion.");
  }
  if (
    parsed.expiresAt < Date.now()
    || parsed.provider !== expected.provider
    || parsed.subject !== sessionSubject(expected.tenantId, expected.userId)
    || parsed.nonce !== expected.nonce
  ) {
    throw new OAuthConnectorError("ETAT_INVALIDE", "Cette autorisation n'est plus valable. Recommencez la connexion.");
  }
  return parsed;
}

export function createAuthorizationUrl(input: {
  provider: OAuthProvider;
  tenantId: string;
  userId: string;
  callbackUrl: string;
}): { url: string; nonce: string; expiresAt: Date } {
  const credentials = platformCredentials(input.provider);
  if (!credentials) throw new OAuthConnectorError("NON_CONFIGURE", "Cette connexion sera disponible prochainement.");
  const definition = PROVIDERS[input.provider];
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const state = createOAuthState({
    provider: input.provider,
    tenantId: input.tenantId,
    userId: input.userId,
    nonce,
    expiresAt: expiresAt.getTime(),
  });
  const url = new URL(definition.authorizationUrl);
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("redirect_uri", input.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", definition.scopes.join(definition.scopeSeparator));
  url.searchParams.set("state", state);
  for (const [key, value] of Object.entries(definition.extraAuthorizationParameters ?? {})) {
    url.searchParams.set(key, value);
  }
  return { url: url.toString(), nonce, expiresAt };
}

const StandardTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
});
const StripeTokenSchema = z.object({
  stripe_user_id: z.string().min(1),
  livemode: z.boolean(),
  scope: z.literal("read_write"),
});
const SlackTokenSchema = z.object({
  ok: z.literal(true),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  team: z.object({ id: z.string().min(1), name: z.string().min(1).optional() }).optional(),
  // Le seul droit demandé est incoming-webhook : une réponse qui ne fournit
  // pas ce webhook n'a donc pas accordé la capacité annoncée par l'écran.
  incoming_webhook: z.object({
    url: z.string().url().refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "hooks.slack.com";
    }),
  }),
});

const PennylaneProfileSchema = z.object({
  user: z.object({ id: z.union([z.string().min(1), z.number()]) }).passthrough(),
  company: z.object({
    id: z.union([z.string().min(1), z.number()]),
    name: z.string().min(1),
  }).passthrough(),
  scopes: z.array(z.string().min(1)).optional(),
}).passthrough();

export type OAuthTokens = {
  accessToken?: string;
  refreshToken?: string;
  webhookUrl?: string;
  expiresAt?: string;
  accountId?: string;
  accountLabel?: string;
  livemode?: boolean;
};

export type OAuthRevocationResult = "REVOKED" | "MANUAL_REQUIRED";

/**
 * Retire l'autorisation chez le fournisseur quand une API publique le permet.
 */
export async function revokeOAuthAuthorization(input: {
  provider: OAuthProvider;
  accessToken?: string;
  refreshToken?: string;
  accountId?: string;
}): Promise<OAuthRevocationResult> {
  // Ces retraits peuvent toucher une autorisation partagée (projet Google,
  // relation Stripe, ou installation Slack), pas seulement ce tenant. Sans
  // registre global prouvant l'unicité du compte externe, ils restent manuels.
  if (
    input.provider === "GOOGLE_DRIVE"
    || input.provider === "STRIPE"
    || input.provider === "SLACK"
  ) {
    return "MANUAL_REQUIRED";
  }

  let url: string;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  let body: URLSearchParams;

  const credentials = platformCredentials("PENNYLANE");
  const token = input.refreshToken ?? input.accessToken;
  if (!credentials || !token) return "MANUAL_REQUIRED";
  url = "https://app.pennylane.com/oauth/revoke";
  body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    token,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new OAuthConnectorError("FOURNISSEUR_INDISPONIBLE", "Le service externe ne répond pas.");
  }
  if (!response.ok) {
    throw new OAuthConnectorError("FOURNISSEUR_REFUSE", "Le service externe n'a pas confirmé la déconnexion.");
  }
  return "REVOKED";
}

/** Vérifie un jeton avancé avant de le présenter comme une connexion valide. */
export async function validatePennylaneApiToken(token: string): Promise<{ accountLabel?: string }> {
  let response: Response;
  try {
    response = await fetch("https://app.pennylane.com/api/external/v2/me", {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new OAuthConnectorError("FOURNISSEUR_INDISPONIBLE", "Pennylane ne répond pas. Réessayez dans quelques instants.");
  }
  if (!response.ok) {
    throw new OAuthConnectorError("FOURNISSEUR_REFUSE", "Ce jeton Pennylane n'est pas reconnu ou ne dispose pas des droits nécessaires.");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new OAuthConnectorError("FOURNISSEUR_REFUSE", "Pennylane a renvoyé une réponse inattendue.");
  }
  try {
    const parsed = PennylaneProfileSchema.parse(raw);
    if (parsed.scopes) {
      const scopes = new Set(parsed.scopes);
      const customers = scopes.has("customers:readonly") || scopes.has("customers:all");
      if (!customers || !scopes.has("customer_invoices:all") || !scopes.has("file_attachments:all")) {
        throw new OAuthConnectorError(
          "FOURNISSEUR_REFUSE",
          "Ce jeton Pennylane est valide, mais il ne possède pas les droits requis.",
        );
      }
    } else {
      // Certaines variantes historiques de /me n'exposent pas `scopes`.
      // Deux lectures minimales prouvent alors les capacités non destructives
      // avant de conserver le jeton. Les droits d'écriture restent ceux
      // sélectionnés dans Pennylane, conformément au mode avancé accompagné.
      for (const path of ["customers", "customer_invoices"] as const) {
        let capability: Response;
        try {
          capability = await fetch(`https://app.pennylane.com/api/external/v2/${path}?limit=1`, {
            method: "GET",
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
            redirect: "error",
          });
        } catch {
          throw new OAuthConnectorError("FOURNISSEUR_INDISPONIBLE", "Pennylane ne répond pas. Réessayez dans quelques instants.");
        }
        if (!capability.ok) {
          throw new OAuthConnectorError(
            "FOURNISSEUR_REFUSE",
            "Ce jeton Pennylane est valide, mais il ne possède pas les droits requis.",
          );
        }
      }
    }
    return { accountLabel: parsed.company.name };
  } catch (error) {
    if (error instanceof OAuthConnectorError) throw error;
    throw new OAuthConnectorError("FOURNISSEUR_REFUSE", "Pennylane a renvoyé une réponse inattendue.");
  }
}

export async function exchangeOAuthCode(input: {
  provider: OAuthProvider;
  code: string;
  callbackUrl: string;
}): Promise<OAuthTokens> {
  const credentials = platformCredentials(input.provider);
  if (!credentials) throw new OAuthConnectorError("NON_CONFIGURE", "Cette connexion sera disponible prochainement.");
  const definition = PROVIDERS[input.provider];
  const body = new URLSearchParams({ code: input.code, grant_type: "authorization_code" });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (definition.tokenAuthentication === "FORM") {
    body.set("client_id", credentials.clientId);
    body.set("client_secret", credentials.clientSecret);
    body.set("redirect_uri", input.callbackUrl);
  } else {
    const basicIdentity = definition.tokenAuthentication === "BASIC_CLIENT"
      ? `${credentials.clientId}:${credentials.clientSecret}`
      : `${credentials.clientSecret}:`;
    headers["Authorization"] = `Basic ${Buffer.from(basicIdentity).toString("base64")}`;
    // Slack exige le même redirect_uri quand il figurait à l'autorisation.
    if (definition.tokenAuthentication === "BASIC_CLIENT") body.set("redirect_uri", input.callbackUrl);
  }

  let response: Response;
  try {
    response = await fetch(definition.tokenUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
      // Un 307/308 ne doit jamais transporter les identifiants de plateforme
      // vers une destination choisie par un intermédiaire.
      redirect: "error",
    });
  } catch {
    throw new OAuthConnectorError("FOURNISSEUR_INDISPONIBLE", "Le service externe ne répond pas. Réessayez dans quelques instants.");
  }
  if (!response.ok) throw new OAuthConnectorError("FOURNISSEUR_REFUSE", "Le service externe a refusé la connexion.");
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new OAuthConnectorError("FOURNISSEUR_REFUSE", "Le service externe a renvoyé une réponse inattendue.");
  }
  try {
    if (input.provider === "STRIPE") {
      const parsed = StripeTokenSchema.parse(raw);
      if (
        process.env["NODE_ENV"] === "production"
        && !parsed.livemode
        && process.env["STRIPE_CONNECT_ALLOW_TEST_MODE"] !== "true"
      ) {
        throw new OAuthConnectorError("FOURNISSEUR_REFUSE", "Stripe a autorisé un compte de test dans l'environnement de production.");
      }
      return {
        accountId: parsed.stripe_user_id,
        accountLabel: parsed.stripe_user_id,
        livemode: parsed.livemode,
      };
    }
    if (input.provider === "SLACK") {
      const parsed = SlackTokenSchema.parse(raw);
      return {
        accessToken: parsed.access_token,
        ...(parsed.refresh_token ? { refreshToken: parsed.refresh_token } : {}),
        webhookUrl: parsed.incoming_webhook.url,
        ...(parsed.expires_in ? { expiresAt: new Date(Date.now() + parsed.expires_in * 1000).toISOString() } : {}),
        ...(parsed.team ? { accountId: parsed.team.id, accountLabel: parsed.team.name ?? parsed.team.id } : {}),
      };
    }
    const parsed = StandardTokenSchema.parse(raw);
    return {
      accessToken: parsed.access_token,
      ...(parsed.refresh_token ? { refreshToken: parsed.refresh_token } : {}),
      ...(parsed.expires_in ? { expiresAt: new Date(Date.now() + parsed.expires_in * 1000).toISOString() } : {}),
    };
  } catch (error) {
    if (error instanceof OAuthConnectorError) throw error;
    throw new OAuthConnectorError("FOURNISSEUR_REFUSE", "Le service externe a renvoyé une réponse inattendue.");
  }
}
