import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { withTenant, connectorsTable, bankConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getConfig, creerUtilisateur, creerSessionConnexion, BanqueConfigError } from "@nodaq/banque-agreee";
import { messageValidation } from "../lib/message-validation.js";
import {
  ConflitConnexionConnecteurError,
  annulerAutorisationOAuthConnecteur,
  confirmerRetraitExterneConnecteur,
  confirmerRetraitExterneManuellement,
  deconnecterConnecteur,
  enregistrerConnexionConnecteur,
  marquerRetraitExterneApresOAuthAmbigu,
  preparerAutorisationOAuthConnecteur,
  preparerValidationAvanceeConnecteur,
  resoudreTentativeOAuthCompensee,
  revendiquerAutorisationOAuthConnecteur,
} from "../lib/tenant-secrets.js";
import { abonnementCourant } from "../lib/abonnement.js";
import { COOKIE_OPTS } from "./auth.js";
import { oauthCallbackUrl } from "../lib/app-origin.js";
import {
  OAuthConnectorError,
  OAuthProviderSchema,
  createAuthorizationUrl,
  exchangeOAuthCode,
  oauthAttemptFingerprint,
  oauthAvailable,
  revokeOAuthAuthorization,
  validatePennylaneApiToken,
  verifyOAuthState,
} from "../lib/connecteurs-oauth.js";

const router: IRouter = Router();

const UpdateConnectorBody = z.object({
  status: z.enum(["NON_CONNECTE", "CONNECTE", "ERREUR"]).optional(),
  config: z.record(z.string()).optional(),
  externalRevocationConfirmed: z.literal(true).optional(),
  externalRevocationId: z.string().uuid().optional(),
  connectionId: z.string().uuid().optional(),
});

const DEFAULTS = [
  { type: "BANQUE",       label: "Banque",        description: "Synchronisation des transactions bancaires", status: "NON_CONNECTE" },
  { type: "PENNYLANE",    label: "Pennylane",     description: "Comptabilité et facturation synchronisées",  status: "NON_CONNECTE" },
  { type: "STRIPE",       label: "Stripe",        description: "Paiements en ligne et abonnements",           status: "NON_CONNECTE" },
  { type: "GOOGLE_DRIVE", label: "Google Drive",  description: "Stockage et partage de documents",           status: "NON_CONNECTE" },
  { type: "SLACK",        label: "Slack",         description: "Notifications et alertes d'équipe",          status: "NON_CONNECTE" },
  { type: "ZAPIER",       label: "Zapier",        description: "Automatisation de workflows",                status: "NON_CONNECTE" },
];

function oauthTombstones(config: Record<string, unknown>): Array<{ state: string; expiresAt: string }> {
  const raw = config["__oauthAttemptTombstones"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.values(raw).flatMap((value) => (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { state?: unknown }).state === "string"
    && typeof (value as { expiresAt?: unknown }).expiresAt === "string"
      ? [{
          state: (value as { state: string }).state,
          expiresAt: (value as { expiresAt: string }).expiresAt,
        }]
      : []
  ));
}

function publicConfig(config: Record<string, unknown>): Record<string, string | boolean> {
  const safe: Record<string, string | boolean> = {};
  if (config["authMode"] === "OAUTH" || config["authMode"] === "ADVANCED") safe["authMode"] = config["authMode"];
  if (typeof config["accountLabel"] === "string") safe["accountLabel"] = config["accountLabel"];
  if (typeof config["tokenExpiresAt"] === "string") safe["tokenExpiresAt"] = config["tokenExpiresAt"];
  if (Array.isArray(config["__secrets"]) && config["__secrets"].length > 0) safe["secretConfigured"] = true;
  if (typeof config["__connectionVersion"] === "string") safe["connectionId"] = config["__connectionVersion"];
  if (config["externalActionRequired"] === true) safe["externalActionRequired"] = true;
  if (
    config["externalActionRequired"] === true
    && typeof config["__externalRevocationAttempt"] === "string"
  ) {
    safe["externalRevocationId"] = config["__externalRevocationAttempt"];
  }
  const tombstones = oauthTombstones(config);
  if (tombstones.length > 0) {
    if (tombstones.some((item) => (
      (item.state === "PENDING" || item.state === "ACKNOWLEDGED")
      && Date.parse(item.expiresAt) >= Date.now()
    ))) {
      safe["connectionInProgress"] = true;
      safe["connectionAttemptCancelable"] = false;
    }
    if (tombstones.some((item) => item.state === "NEEDS_ACTION")) safe["externalActionRequired"] = true;
  }
  const attemptExpiresAt = config["__oauthAttemptExpiresAt"];
  if (
    config["__oauthAttemptPhase"] === "EXCHANGING"
    || (
      config["__oauthAttemptPhase"] === "ADVANCED_VALIDATING"
      && typeof attemptExpiresAt === "string"
      && Date.parse(attemptExpiresAt) >= Date.now()
    )
  ) {
    safe["connectionInProgress"] = true;
    safe["connectionAttemptCancelable"] = true;
  }
  return safe;
}

const MANAGED_TYPES = new Set(DEFAULTS.map((item) => item.type));

async function getOrCreateConnector(tenantId: string, type: string) {
  const definition = DEFAULTS.find((item) => item.type === type);
  if (!definition) return null;
  return withTenant(tenantId, async (tx) => {
    await tx.insert(connectorsTable).values({
      tenantId,
      type: definition.type,
      label: definition.label,
      description: definition.description,
      status: definition.status,
      config: {},
    }).onConflictDoNothing();
    const [connector] = await tx.select().from(connectorsTable).where(eq(connectorsTable.type, type));
    return connector ?? null;
  });
}

function connectionDescriptor(type: string): { connectionMode?: "OAUTH" | "ADVANCED"; available?: boolean } {
  const oauth = OAuthProviderSchema.safeParse(type);
  if (oauth.success) return { connectionMode: "OAUTH", available: oauthAvailable(oauth.data) };
  if (type === "ZAPIER") return { connectionMode: "ADVANCED", available: true };
  return {};
}

router.get("/connecteurs", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  const connectors = await withTenant(tenantId, async (tx) => {
    let existing = await tx.select().from(connectorsTable);
    if (existing.length === 0) {
      for (const d of DEFAULTS) {
        await tx.insert(connectorsTable).values({
          tenantId, type: d.type, label: d.label, description: d.description, status: d.status, config: {},
        }).onConflictDoNothing();
      }
      existing = await tx.select().from(connectorsTable);
    }
    return existing;
  });

  const safe = connectors.map(c => {
    // L'ancien formulaire déclarait CONNECTE dès qu'une valeur était saisie,
    // sans la vérifier. Ne jamais transformer cette donnée legacy en preuve
    // d'autorisation : elle doit être réinitialisée puis reconnectée.
    const legacyNeedsReset = c.type !== "BANQUE"
      && MANAGED_TYPES.has(c.type)
      && c.status === "CONNECTE"
      && c.config["authMode"] !== "OAUTH"
      && c.config["authMode"] !== "ADVANCED";
    return {
      ...c,
      status: legacyNeedsReset ? "ERREUR" as const : c.status,
      config: publicConfig(c.config),
      ...connectionDescriptor(c.type),
    };
  });
  const connected = safe.filter(c => c.status === "CONNECTE").length;
  const withError  = safe.filter(c => c.status === "ERREUR").length;
  res.json({ connectors: safe, connected, withError, total: connectors.length });
});

router.patch("/connecteurs/:type", async (req, res): Promise<void> => {
  const { type } = req.params;
  const parsed = UpdateConnectorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;

  if (parsed.data.externalRevocationConfirmed && parsed.data.status !== "NON_CONNECTE") {
    res.status(400).json({ error: "La confirmation concerne uniquement un outil déjà remis à zéro." });
    return;
  }
  if (parsed.data.externalRevocationConfirmed && !parsed.data.externalRevocationId) {
    res.status(400).json({ error: "Rechargez la page avant de confirmer le retrait externe." });
    return;
  }
  if (parsed.data.externalRevocationId && !parsed.data.externalRevocationConfirmed) {
    res.status(400).json({ error: "L'identifiant de retrait exige une confirmation explicite." });
    return;
  }

  if (MANAGED_TYPES.has(type) && parsed.data.config && Object.keys(parsed.data.config).length > 0) {
    res.status(400).json({ error: "Utilisez la connexion guidée ou le mode avancé prévu pour cet outil." });
    return;
  }

  if (MANAGED_TYPES.has(type) && parsed.data.status && parsed.data.status !== "NON_CONNECTE") {
    res.status(400).json({ error: "Un outil n'est déclaré connecté qu'après une autorisation vérifiée." });
    return;
  }

  const [existing] = await withTenant(tenantId, (tx) =>
    tx.select().from(connectorsTable).where(eq(connectorsTable.type, type)),
  );
  if (!existing) { res.status(404).json({ error: "Connecteur introuvable." }); return; }

  const disconnecting = parsed.data.status === "NON_CONNECTE";
  if (disconnecting) {
    if (parsed.data.externalRevocationConfirmed) {
      if (existing.config["externalActionRequired"] !== true) {
        res.status(409).json({ error: "Aucune autorisation externe en attente de confirmation." });
        return;
      }
      try {
        await confirmerRetraitExterneManuellement(
          tenantId,
          existing.id,
          parsed.data.externalRevocationId!,
        );
      } catch (error) {
        if (error instanceof ConflitConnexionConnecteurError) {
          res.status(409).json({ error: "La vérification externe est encore en cours. Attendez avant de confirmer le retrait." });
          return;
        }
        throw error;
      }
      const acknowledged = await getOrCreateConnector(tenantId, type);
      res.json({
        ...acknowledged,
        config: publicConfig(acknowledged?.config ?? {}),
        externalActionRequired: false,
      });
      return;
    }
    // Le parcours bancaire reste hors de ce chantier : ne jamais prétendre
    // que sa révocation externe a été effectuée par cette route générique.
    let externalActionRequired = type === "BANQUE";
    const provider = OAuthProviderSchema.safeParse(type);
    // Le nettoyage local et l'annulation d'un éventuel callback en vol sont
    // atomiques et passent AVANT tout appel tiers. Une panne fournisseur ou
    // un chiffré altéré ne peut donc jamais rendre la suppression impossible.
    let retired: Awaited<ReturnType<typeof deconnecterConnecteur>>;
    try {
      retired = await deconnecterConnecteur(tenantId, existing.id, parsed.data.connectionId);
    } catch (error) {
      if (error instanceof ConflitConnexionConnecteurError) {
        res.status(409).json({ error: "Cette connexion a changé. Rechargez la page avant de la déconnecter." });
        return;
      }
      throw error;
    }
    externalActionRequired ||= retired.externalActionRequired;
    if (provider.success && retired.status !== "NON_CONNECTE") {
      if (retired.config["authMode"] === "OAUTH") {
        try {
          const result = await revokeOAuthAuthorization({
            provider: provider.data,
            ...(retired.secrets["access_token"] ? { accessToken: retired.secrets["access_token"] } : {}),
            ...(retired.secrets["refresh_token"] ? { refreshToken: retired.secrets["refresh_token"] } : {}),
            ...(typeof retired.config["accountId"] === "string" ? { accountId: retired.config["accountId"] } : {}),
          });
          if (result === "REVOKED" && retired.secretsTousLisibles) {
            try {
              if (!retired.revocationAttemptId) throw new ConflitConnexionConnecteurError();
              externalActionRequired = await confirmerRetraitExterneConnecteur(
                tenantId,
                existing.id,
                retired.revocationAttemptId,
              );
            } catch {
              // La révocation distante est certaine, mais garder le marqueur
              // est plus sûr qu'un faux acquittement si la base a refusé la
              // seconde écriture.
              externalActionRequired = true;
            }
          } else {
            externalActionRequired = true;
          }
        } catch {
          // Le droit de retirer les secrets de Nodaq ne dépend jamais de la
          // disponibilité d'un tiers. L'écran indiquera l'action externe.
          externalActionRequired = true;
        }
      } else {
        // Mode avancé ou ligne legacy sans mode connu : aucun protocole ne
        // permet de prouver ici que l'accès externe a été retiré.
        externalActionRequired = true;
      }
    }
    const disconnected = await getOrCreateConnector(tenantId, type);
    res.json({
      ...disconnected,
      config: publicConfig(disconnected?.config ?? {}),
      externalActionRequired,
    });
    return;
  }

  const mergedConfig: Record<string, unknown> = { ...existing.config };
  if (parsed.data.config !== undefined) {
    for (const [key, value] of Object.entries(parsed.data.config)) {
      if (value && value !== "***") mergedConfig[key] = value;
    }
  }
  const [updated] = await withTenant(tenantId, (tx) => tx.update(connectorsTable).set({
    ...(parsed.data.status !== undefined ? {
      status: parsed.data.status,
      lastSyncAt: parsed.data.status === "CONNECTE" ? new Date() : null,
    } : {}),
    config: mergedConfig,
  }).where(eq(connectorsTable.id, existing.id)).returning());

  if (!updated) { res.status(404).json({ error: "Connecteur introuvable." }); return; }
  res.json({ ...updated, config: publicConfig(updated.config) });
});

const AdvancedPennylaneSchema = z.object({ apiToken: z.string().trim().min(12).max(1_000) });
const AdvancedZapierSchema = z.object({
  webhookUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.zapier.com";
  }, "L'adresse doit être un webhook HTTPS Zapier."),
});

router.post("/connecteurs/:type/avance", async (req, res): Promise<void> => {
  const { type } = req.params;
  const schema = type === "PENNYLANE" ? AdvancedPennylaneSchema : type === "ZAPIER" ? AdvancedZapierSchema : null;
  if (!schema) {
    res.status(400).json({ error: "Cet outil se connecte uniquement par une autorisation sécurisée." });
    return;
  }
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;
  const connector = await getOrCreateConnector(tenantId, type);
  if (!connector) { res.status(404).json({ error: "Connecteur introuvable." }); return; }
  const attemptExpiresAt = connector.config["__oauthAttemptExpiresAt"];
  const activePreparedAttempt = typeof connector.config["__oauthAttemptHash"] === "string"
    && typeof attemptExpiresAt === "string"
    && Date.parse(attemptExpiresAt) >= Date.now();
  const attemptPhase = connector.config["__oauthAttemptPhase"];
  const tombstones = oauthTombstones(connector.config);
  const unresolvedAttempt = (
    attemptPhase !== undefined
    && (attemptPhase !== "ADVANCED_VALIDATING" || activePreparedAttempt)
  )
    || activePreparedAttempt
    || connector.config["externalActionRequired"] === true
    || tombstones.some((item) => (
      item.state === "NEEDS_ACTION"
      || (
        (item.state === "PENDING" || item.state === "ACKNOWLEDGED")
        && Date.parse(item.expiresAt) >= Date.now()
      )
    ));
  if (
    connector.status !== "NON_CONNECTE"
    || connector.config["authMode"] !== undefined
    || unresolvedAttempt
  ) {
    res.status(409).json({ error: "Déconnectez d'abord l'outil actuel avant de changer sa méthode de connexion." });
    return;
  }
  const validationAttempt = randomUUID();
  try {
    await preparerValidationAvanceeConnecteur(tenantId, connector.id, validationAttempt);
  } catch (error) {
    if (error instanceof ConflitConnexionConnecteurError) {
      res.status(409).json({ error: "Une autre connexion a été lancée. Rechargez l'outil avant de recommencer." });
      return;
    }
    throw error;
  }
  const annulerValidation = async (): Promise<void> => {
    try {
      await annulerAutorisationOAuthConnecteur(tenantId, connector.id, validationAttempt);
    } catch {
      // Le CAS de persistance reste l'autorité. Une panne de nettoyage ne doit
      // ni exposer le jeton ni masquer le résultat de validation.
    }
  };
  const secretName = type === "PENNYLANE" ? "api_token" : "webhook_url";
  const clearValue = type === "PENNYLANE"
    ? (parsed.data as z.infer<typeof AdvancedPennylaneSchema>).apiToken
    : (parsed.data as z.infer<typeof AdvancedZapierSchema>).webhookUrl;
  let accountLabel: string | undefined;
  if (type === "PENNYLANE") {
    try {
      accountLabel = (await validatePennylaneApiToken(clearValue)).accountLabel;
    } catch (error) {
      await annulerValidation();
      if (error instanceof OAuthConnectorError) {
        res.status(error.code === "FOURNISSEUR_INDISPONIBLE" ? 502 : 400).json({ error: error.message });
        return;
      }
      throw error;
    }
  }
  const config: Record<string, unknown> = { authMode: "ADVANCED", __secrets: [secretName] };
  if (accountLabel) config["accountLabel"] = accountLabel;
  try {
    await enregistrerConnexionConnecteur(
      tenantId,
      connector.id,
      { [secretName]: clearValue },
      config,
      { mode: "ADVANCED", attemptHash: validationAttempt },
    );
  } catch (error) {
    await annulerValidation();
    if (error instanceof ConflitConnexionConnecteurError) {
      res.status(409).json({ error: "Une autre connexion a été lancée. Réinitialisez l'outil avant de recommencer." });
      return;
    }
    throw error;
  }
  res.json({
    ...connector,
    status: "CONNECTE",
    lastSyncAt: null,
    config: { authMode: "ADVANCED", secretConfigured: true, ...(accountLabel ? { accountLabel } : {}) },
  });
});

router.post("/connecteurs/:type/autorisation", async (req, res): Promise<void> => {
  const parsedProvider = OAuthProviderSchema.safeParse(req.params.type);
  if (!parsedProvider.success) { res.status(400).json({ error: "Cet outil ne propose pas cette connexion." }); return; }
  const provider = parsedProvider.data;
  const connector = await getOrCreateConnector(req.tenantId!, provider);
  if (!connector) { res.status(404).json({ error: "Connecteur introuvable." }); return; }
  if (connector.status !== "NON_CONNECTE" || connector.config["authMode"] !== undefined) {
    res.status(409).json({ error: "Déconnectez d'abord l'outil actuel avant de renouveler son autorisation." });
    return;
  }
  const callbackUrl = oauthCallbackUrl(provider);
  try {
    const authorization = createAuthorizationUrl({
      provider,
      tenantId: req.tenantId!,
      userId: req.session!.userId,
      callbackUrl,
    });
    await preparerAutorisationOAuthConnecteur(
      req.tenantId!,
      connector.id,
      oauthAttemptFingerprint(provider, authorization.nonce),
      authorization.expiresAt,
    );
    res.cookie("nodaq_oauth_nonce", authorization.nonce, {
      httpOnly: true,
      // Même décision que le cookie de session : PUBLIC_URL décrit le vrai
      // transport, contrairement à NODE_ENV qui vaut aussi production en
      // prévisualisation HTTP locale.
      secure: COOKIE_OPTS.secure,
      sameSite: "lax",
      maxAge: 10 * 60_000,
      path: `/api/connecteurs/${provider}/retour`,
    });
    res.json({ url: authorization.url });
  } catch (error) {
    if (error instanceof ConflitConnexionConnecteurError) {
      res.status(409).json({ error: "Une autre connexion est déjà active. Réinitialisez l'outil avant de recommencer." });
      return;
    }
    if (error instanceof OAuthConnectorError) { res.status(503).json({ error: error.message }); return; }
    throw error;
  }
});

router.get("/connecteurs/:type/retour", async (req, res): Promise<void> => {
  const providerResult = OAuthProviderSchema.safeParse(req.params.type);
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
  if (!providerResult.success) {
    res.status(400).json({ error: "Cette autorisation n'est plus valable. Recommencez la connexion." });
    return;
  }
  const provider = providerResult.data;
  const query = z.object({
    code: z.string().min(1).max(4_000).optional(),
    state: z.string().min(1).max(10_000),
    error: z.string().min(1).max(200).optional(),
  }).safeParse(req.query);
  const cookiePath = `/api/connecteurs/${provider}/retour`;
  const redirectError = (kind: string = provider): void => {
    res.clearCookie("nodaq_oauth_nonce", { path: cookiePath });
    res.redirect(`/connecteurs?erreur=${encodeURIComponent(kind)}`);
  };
  if (!query.success || !cookies["nodaq_oauth_nonce"]) {
    redirectError();
    return;
  }
  const callbackUrl = oauthCallbackUrl(provider);
  let connectorId: string | null = null;
  let attemptHash: string | null = null;
  const annulerTentative = async (): Promise<void> => {
    if (!connectorId || !attemptHash) return;
    try {
      await annulerAutorisationOAuthConnecteur(req.tenantId!, connectorId, attemptHash);
    } catch {
      // Une panne DB sera reprise par le suivi d'infrastructure ; elle ne doit
      // pas masquer le résultat du fournisseur dans le navigateur.
    }
  };
  try {
    const verifiedState = verifyOAuthState(query.data.state, {
      provider,
      tenantId: req.tenantId!,
      userId: req.session!.userId,
      nonce: cookies["nodaq_oauth_nonce"],
    });
    attemptHash = oauthAttemptFingerprint(provider, verifiedState.nonce);
    // Le nonce est consommé dès que l'état est validé. Même si le fournisseur
    // accepte ensuite le code mais que la persistance échoue, un rafraîchissement
    // du navigateur ne pourra pas rejouer le retour.
    res.clearCookie("nodaq_oauth_nonce", { path: cookiePath });
    const tenantId = req.tenantId!;
    const connector = await getOrCreateConnector(tenantId, provider);
    if (!connector) { redirectError(); return; }
    connectorId = connector.id;
    if (query.data.error || !query.data.code) {
      await annulerTentative();
      redirectError();
      return;
    }
    const abonnement = await abonnementCourant(req.tenantId!);
    if (abonnement.statut === "READONLY") {
      await annulerTentative();
      redirectError("LECTURE_SEULE");
      return;
    }
    await revendiquerAutorisationOAuthConnecteur(tenantId, connector.id, attemptHash);
    let tokens: Awaited<ReturnType<typeof exchangeOAuthCode>>;
    try {
      tokens = await exchangeOAuthCode({ provider, code: query.data.code, callbackUrl });
    } catch (error) {
      if (error instanceof OAuthConnectorError) {
        // Après consommation du code, un timeout ou une réponse illisible ne
        // permet pas de savoir si le droit externe a été créé. Conserver une
        // alerte durable plutôt que d'affirmer que rien n'a changé.
        await marquerRetraitExterneApresOAuthAmbigu(tenantId, connector.id, attemptHash);
        redirectError("AUTORISATION_A_RETIRER");
        return;
      }
      throw error;
    }
    const secrets: Record<string, string> = {};
    const secretNames: string[] = [];
    if (tokens.accessToken) {
      secretNames.push("access_token");
      secrets["access_token"] = tokens.accessToken;
    }
    if (tokens.refreshToken) {
      secretNames.push("refresh_token");
      secrets["refresh_token"] = tokens.refreshToken;
    }
    if (tokens.webhookUrl) {
      secretNames.push("webhook_url");
      secrets["webhook_url"] = tokens.webhookUrl;
    }
    const config: Record<string, unknown> = { authMode: "OAUTH", __secrets: secretNames };
    if (tokens.expiresAt) config["tokenExpiresAt"] = tokens.expiresAt;
    if (tokens.accountId) config["accountId"] = tokens.accountId;
    if (tokens.accountLabel) config["accountLabel"] = tokens.accountLabel;
    if (tokens.livemode !== undefined) config["livemode"] = tokens.livemode;
    try {
      await enregistrerConnexionConnecteur(
        tenantId,
        connector.id,
        secrets,
        config,
        { mode: "OAUTH", attemptHash },
      );
    } catch {
      // L'échange a créé un vrai droit externe. Si la persistance perd sa
      // course (déconnexion, autre navigateur) ou échoue, le compenser avant
      // de dire que rien n'a été enregistré dans Nodaq.
      let revoked = false;
      try {
        revoked = await revokeOAuthAuthorization({
          provider,
          ...(tokens.accessToken ? { accessToken: tokens.accessToken } : {}),
          ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
          ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
        }) === "REVOKED";
      } catch {
        revoked = false;
      }
      if (revoked) {
        try {
          await resoudreTentativeOAuthCompensee(tenantId, connector.id, attemptHash);
        } catch {
          // Il peut ne pas y avoir de marqueur (échec DB sans déconnexion), ou
          // son maintien peut être la seule issue sûre après une course.
        }
      } else {
        await marquerRetraitExterneApresOAuthAmbigu(tenantId, connector.id, attemptHash);
      }
      redirectError(revoked ? provider : "AUTORISATION_A_RETIRER");
      return;
    }
    res.clearCookie("nodaq_oauth_nonce", { path: cookiePath });
    res.redirect(`/connecteurs?connexion=${provider}`);
  } catch (error) {
    if (error instanceof OAuthConnectorError || error instanceof ConflitConnexionConnecteurError) {
      redirectError();
      return;
    }
    throw error;
  }
});

/**
 * POST /connecteurs/banque/session
 *
 * Crée (au premier appel) l'utilisateur Bridge du tenant, puis une session
 * Bridge Connect — le front redirige le navigateur sur l'`url` renvoyée.
 * L'appel réseau vers Bridge reste EN DEHORS de toute transaction : une
 * latence Bridge ne doit jamais tenir une connexion Postgres ouverte.
 */
router.post("/connecteurs/banque/session", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof BanqueConfigError) {
      res.status(503).json({ error: "Connecteur bancaire non configuré." });
      return;
    }
    throw err;
  }

  const [existante] = await withTenant(tenantId, (tx) =>
    tx.select().from(bankConnectionsTable).where(eq(bankConnectionsTable.tenantId, tenantId)),
  );

  if (!existante) {
    const utilisateur = await creerUtilisateur(config, tenantId);
    await withTenant(tenantId, (tx) =>
      tx.insert(bankConnectionsTable).values({
        tenantId,
        bridgeUserUuid: utilisateur.uuid,
        statut: "en_attente",
      }),
    );
  }

  // APP_URL : base des liens client-facing (même patron que prospection.ts,
  // membres.ts) — repli sur le site vitrine en dev seulement, jamais en prod
  // (garde au démarrage dans index.ts).
  const callbackUrl = `${process.env["APP_URL"] ?? "https://nodaq.fr"}/connecteurs`;
  const session = await creerSessionConnexion(config, tenantId, callbackUrl);
  res.json({ url: session.url });
});

export default router;
