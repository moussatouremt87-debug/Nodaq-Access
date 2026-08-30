/**
 * Accès au magasin de secrets — LE seul chemin de code qui chiffre et déchiffre.
 *
 * Tout passe par ici, sans exception. C'est ce qui rend la garde structurelle
 * possible : une colonne `*_password` ailleurs signifie forcément qu'on a
 * contourné ce fichier.
 *
 * ── Ce qui ne sort jamais d'ici ─────────────────────────────────────────────
 * Une valeur en clair n'est ni journalisée, ni rendue dans une réponse HTTP, ni
 * incluse dans un message d'erreur. Les fonctions qui lisent rendent la valeur
 * à leur appelant immédiat et rien d'autre : au-dessus, on manipule des
 * booléens (« un mot de passe est-il enregistré ? ») et jamais la valeur.
 */
import { randomUUID } from "node:crypto";
import { eq, and, like } from "drizzle-orm";
import { cleConnecteur, connectorsTable, withTenant, tenantSecretsTable } from "@workspace/db";
import { chiffrer, dechiffrer, type IdentiteSecret } from "@nodaq/crypto";

const OAUTH_ATTEMPT_HASH = "__oauthAttemptHash";
const OAUTH_ATTEMPT_EXPIRES_AT = "__oauthAttemptExpiresAt";
const OAUTH_ATTEMPT_PHASE = "__oauthAttemptPhase";
const OAUTH_ATTEMPT_TOMBSTONES = "__oauthAttemptTombstones";
const EXTERNAL_ACTION_REQUIRED = "externalActionRequired";
const EXTERNAL_REVOCATION_ATTEMPT = "__externalRevocationAttempt";
const CONNECTION_VERSION = "__connectionVersion";
const OAUTH_EXCHANGE_LEASE_MS = 5 * 60_000;
const ADVANCED_VALIDATION_LEASE_MS = 60_000;
// Le verrou d'échange peut être court, mais un tombstone doit couvrir toute la
// durée de validité possible du code fournisseur (Slack : 10 min), le timeout
// réseau et une marge. Il reste stocké après cet horizon afin qu'un worker très
// tardif puisse toujours réaffirmer l'alerte, sans bloquer indéfiniment l'UX.
const OAUTH_TOMBSTONE_GUARD_MS = 15 * 60_000;

type OAuthTombstoneState = "PENDING" | "ACKNOWLEDGED" | "NEEDS_ACTION";
type OAuthTombstone = { state: OAuthTombstoneState; expiresAt: string };

function lireTombstonesOAuth(config: Record<string, unknown>): Record<string, OAuthTombstone> {
  const raw = config[OAUTH_ATTEMPT_TOMBSTONES];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const valid = Object.entries(raw).filter((entry): entry is [string, OAuthTombstone] => {
    const value = entry[1];
    return entry[0].length > 0
      && Boolean(value && typeof value === "object" && !Array.isArray(value))
      && (
        (value as { state?: unknown }).state === "PENDING"
        || (value as { state?: unknown }).state === "ACKNOWLEDGED"
        || (value as { state?: unknown }).state === "NEEDS_ACTION"
      )
      && typeof (value as { expiresAt?: unknown }).expiresAt === "string"
      && Number.isFinite(Date.parse((value as { expiresAt: string }).expiresAt));
  });
  return Object.fromEntries(valid);
}

function tombstonesBloquantes(config: Record<string, unknown>): boolean {
  return Object.values(lireTombstonesOAuth(config))
    .some((tombstone) => (
      (tombstone.state === "PENDING" || tombstone.state === "ACKNOWLEDGED")
      && Date.parse(tombstone.expiresAt) >= Date.now()
    ));
}

function poserTombstonesOAuth(
  config: Record<string, unknown>,
  tombstones: Record<string, OAuthTombstone>,
): Record<string, unknown> {
  const next = { ...config };
  if (Object.keys(tombstones).length > 0) next[OAUTH_ATTEMPT_TOMBSTONES] = tombstones;
  else delete next[OAUTH_ATTEMPT_TOMBSTONES];
  return next;
}

function horizonTombstoneOAuth(existing?: unknown): string {
  const minimum = Date.now() + OAUTH_TOMBSTONE_GUARD_MS;
  const existingMs = typeof existing === "string" ? Date.parse(existing) : Number.NaN;
  return new Date(Math.max(minimum, Number.isFinite(existingMs) ? existingMs : 0)).toISOString();
}

export class ConflitConnexionConnecteurError extends Error {
  constructor() {
    super("Cette tentative de connexion n'est plus la tentative active.");
    this.name = "ConflitConnexionConnecteurError";
  }
}

function tentativeOAuthCourante(config: Record<string, unknown>, attemptHash: string): boolean {
  const expiresAt = config[OAUTH_ATTEMPT_EXPIRES_AT];
  return config[OAUTH_ATTEMPT_HASH] === attemptHash
    && typeof expiresAt === "string"
    && Number.isFinite(Date.parse(expiresAt))
    && Date.parse(expiresAt) >= Date.now();
}

function tentativeOAuthActive(config: Record<string, unknown>): boolean {
  const attemptHash = config[OAUTH_ATTEMPT_HASH];
  return typeof attemptHash === "string" && tentativeOAuthCourante(config, attemptHash);
}

function configurationVideOuTentativeOAuth(config: Record<string, unknown>): boolean {
  return Object.keys(config).every((key) => (
    key === OAUTH_ATTEMPT_HASH
    || key === OAUTH_ATTEMPT_EXPIRES_AT
    || key === OAUTH_ATTEMPT_PHASE
    || key === OAUTH_ATTEMPT_TOMBSTONES
  ));
}

/**
 * Rend une seule tentative OAuth courante par connecteur, sans stocker le
 * nonce brut. Un départ actif doit être réinitialisé ou expirer avant un
 * nouvel essai : l'écraser pendant son échange pourrait créer un droit externe
 * orphelin.
 */
export async function preparerAutorisationOAuthConnecteur(
  tenantId: string,
  connectorId: string,
  attemptHash: string,
  expiresAt: Date,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [connector] = await tx.select({
      status: connectorsTable.status,
      config: connectorsTable.config,
    }).from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    const staleAdvancedValidation = connector?.config[OAUTH_ATTEMPT_PHASE] === "ADVANCED_VALIDATING"
      && !tentativeOAuthActive(connector.config);
    if (
      !connector
      || connector.status !== "NON_CONNECTE"
      || connector.config["authMode"] !== undefined
      || !configurationVideOuTentativeOAuth(connector.config)
      || (connector.config[OAUTH_ATTEMPT_PHASE] !== undefined && !staleAdvancedValidation)
      || tombstonesBloquantes(connector.config)
      || tentativeOAuthActive(connector.config)
    ) {
      throw new ConflitConnexionConnecteurError();
    }
    await tx.update(connectorsTable).set({
      config: poserTombstonesOAuth({
        [OAUTH_ATTEMPT_HASH]: attemptHash,
        [OAUTH_ATTEMPT_EXPIRES_AT]: expiresAt.toISOString(),
      }, lireTombstonesOAuth(connector.config)),
    }).where(eq(connectorsTable.id, connectorId));
  });
}

/**
 * Réserve une génération avant toute validation distante du mode avancé.
 * Un validateur lent ne pourra donc pas ressusciter son jeton après qu'une
 * connexion plus récente a été créée puis explicitement retirée.
 */
export async function preparerValidationAvanceeConnecteur(
  tenantId: string,
  connectorId: string,
  attemptHash: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [connector] = await tx.select({
      status: connectorsTable.status,
      config: connectorsTable.config,
    }).from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    const staleAdvancedValidation = connector?.config[OAUTH_ATTEMPT_PHASE] === "ADVANCED_VALIDATING"
      && !tentativeOAuthActive(connector.config);
    if (
      !connector
      || connector.status !== "NON_CONNECTE"
      || connector.config["authMode"] !== undefined
      || !configurationVideOuTentativeOAuth(connector.config)
      || tombstonesBloquantes(connector.config)
      || tentativeOAuthActive(connector.config)
      || (connector.config[OAUTH_ATTEMPT_PHASE] !== undefined && !staleAdvancedValidation)
    ) {
      throw new ConflitConnexionConnecteurError();
    }
    await tx.update(connectorsTable).set({
      config: poserTombstonesOAuth({
        [OAUTH_ATTEMPT_HASH]: attemptHash,
        [OAUTH_ATTEMPT_EXPIRES_AT]: new Date(Date.now() + ADVANCED_VALIDATION_LEASE_MS).toISOString(),
        [OAUTH_ATTEMPT_PHASE]: "ADVANCED_VALIDATING",
      }, lireTombstonesOAuth(connector.config)),
    }).where(eq(connectorsTable.id, connectorId));
  });
}

/**
 * Revendique atomiquement la tentative avant l'échange du code. L'expiration
 * est prolongée au-delà du timeout HTTP fournisseur, ce qui ferme la fenêtre
 * où un second départ pouvait remplacer la tentative pendant l'échange.
 */
export async function revendiquerAutorisationOAuthConnecteur(
  tenantId: string,
  connectorId: string,
  attemptHash: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [connector] = await tx.select({
      status: connectorsTable.status,
      config: connectorsTable.config,
    }).from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    if (
      !connector
      || connector.status !== "NON_CONNECTE"
      || connector.config["authMode"] !== undefined
      || connector.config[OAUTH_ATTEMPT_PHASE] !== undefined
      || !tentativeOAuthCourante(connector.config, attemptHash)
    ) {
      throw new ConflitConnexionConnecteurError();
    }
    await tx.update(connectorsTable).set({
      config: {
        ...connector.config,
        [OAUTH_ATTEMPT_PHASE]: "EXCHANGING",
        [OAUTH_ATTEMPT_EXPIRES_AT]: new Date(Date.now() + OAUTH_EXCHANGE_LEASE_MS).toISOString(),
      },
    }).where(eq(connectorsTable.id, connectorId));
  });
}

/** Retire la tentative uniquement si elle est encore courante. */
export async function annulerAutorisationOAuthConnecteur(
  tenantId: string,
  connectorId: string,
  attemptHash: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [connector] = await tx.select({ config: connectorsTable.config })
      .from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    if (!connector || connector.config[OAUTH_ATTEMPT_HASH] !== attemptHash) return;
    const config = { ...connector.config };
    delete config[OAUTH_ATTEMPT_HASH];
    delete config[OAUTH_ATTEMPT_EXPIRES_AT];
    delete config[OAUTH_ATTEMPT_PHASE];
    await tx.update(connectorsTable).set({ config }).where(eq(connectorsTable.id, connectorId));
  });
}

/**
 * Un échange de code peut avoir réussi chez le fournisseur alors que sa
 * réponse s'est perdue. Dans ce cas, remplacer la tentative revendiquée par
 * une alerte durable évite de présenter le connecteur comme sain au prochain
 * chargement. La comparaison du hash empêche d'écraser un état plus récent.
 */
export async function marquerRetraitExterneApresOAuthAmbigu(
  tenantId: string,
  connectorId: string,
  attemptHash: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [connector] = await tx.select({
      status: connectorsTable.status,
      config: connectorsTable.config,
    }).from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    if (!connector) return;
    const currentAttempt = connector.config[OAUTH_ATTEMPT_HASH] === attemptHash;
    const tombstones = lireTombstonesOAuth(connector.config);
    if (!currentAttempt && tombstones[attemptHash] === undefined) return;
    const config = { ...connector.config };
    const currentExpiresAt = config[OAUTH_ATTEMPT_EXPIRES_AT];
    if (currentAttempt) {
      delete config[OAUTH_ATTEMPT_HASH];
      delete config[OAUTH_ATTEMPT_EXPIRES_AT];
      delete config[OAUTH_ATTEMPT_PHASE];
    }
    tombstones[attemptHash] = {
      state: "NEEDS_ACTION",
      expiresAt: horizonTombstoneOAuth(tombstones[attemptHash]?.expiresAt ?? currentExpiresAt),
    };
    await tx.update(connectorsTable).set({
      config: poserTombstonesOAuth({
        ...config,
        [EXTERNAL_ACTION_REQUIRED]: true,
        // Toute nouvelle ambiguïté invalide un acquittement affiché avant ce
        // callback. L'identifiant est opaque et peut être exposé au client.
        [EXTERNAL_REVOCATION_ATTEMPT]: randomUUID(),
      }, tombstones),
      ...(connector.status === "CONNECTE" ? { status: "ERREUR" as const } : {}),
    }).where(eq(connectorsTable.id, connectorId));
  });
}

/**
 * Retire la trace d'une tentative dont le droit externe a été révoqué avec
 * certitude. Contrairement à un ACK manuel précoce, cette résolution peut
 * supprimer le tombstone sans perdre un callback encore susceptible d'agir.
 */
export async function resoudreTentativeOAuthCompensee(
  tenantId: string,
  connectorId: string,
  attemptHash: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [connector] = await tx.select({
      status: connectorsTable.status,
      config: connectorsTable.config,
    }).from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    if (!connector) return;
    const config = { ...connector.config };
    if (config[OAUTH_ATTEMPT_HASH] === attemptHash) {
      delete config[OAUTH_ATTEMPT_HASH];
      delete config[OAUTH_ATTEMPT_EXPIRES_AT];
      delete config[OAUTH_ATTEMPT_PHASE];
    }
    const tombstones = lireTombstonesOAuth(config);
    delete tombstones[attemptHash];
    const hasUnresolvedAttempt = Object.values(tombstones).some((tombstone) => (
      tombstone.state === "PENDING" || tombstone.state === "NEEDS_ACTION"
    ));
    if (
      !hasUnresolvedAttempt
      && connector.status === "NON_CONNECTE"
      && config[EXTERNAL_REVOCATION_ATTEMPT] === undefined
    ) {
      delete config[EXTERNAL_ACTION_REQUIRED];
    }
    await tx.update(connectorsTable).set({
      config: poserTombstonesOAuth(config, tombstones),
    }).where(eq(connectorsTable.id, connectorId));
  });
}

/**
 * Enregistre ou remplace un secret.
 *
 * `versionCle` repart de 1 : le chiffré est neuf, il n'a jamais été re-clé.
 */
export async function enregistrerSecret(
  tenantId: string,
  cle: string,
  clair: string,
): Promise<void> {
  const identite: IdentiteSecret = { scope: tenantId, cle };
  const { valeur, versionCle } = chiffrer(clair, identite);

  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(tenantSecretsTable)
      .values({ tenantId, cle, valeurChiffree: valeur, versionCle })
      .onConflictDoUpdate({
        target: [tenantSecretsTable.tenantId, tenantSecretsTable.cle],
        set: { valeurChiffree: valeur, versionCle, updatedAt: new Date() },
      });
  });
}

/**
 * Lit un secret en clair. `null` s'il n'y en a pas.
 *
 * Lève si la ligne existe mais ne se déchiffre pas — mauvaise clé, chiffré
 * altéré, ligne recopiée depuis un autre tenant. On ne rend PAS `null` dans ce
 * cas : « pas de mot de passe » et « le mot de passe est illisible » appellent
 * deux réactions opposées, et les confondre ferait retomber l'envoi en repli
 * sans que personne ne comprenne pourquoi.
 */
export async function lireSecret(tenantId: string, cle: string): Promise<string | null> {
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .select({ valeurChiffree: tenantSecretsTable.valeurChiffree })
      .from(tenantSecretsTable)
      .where(and(eq(tenantSecretsTable.tenantId, tenantId), eq(tenantSecretsTable.cle, cle))),
  );
  if (!ligne) return null;
  return dechiffrer(ligne.valeurChiffree, { scope: tenantId, cle });
}

/** Lit un secret de connecteur sans exposer son format de clé aux routes. */
export function lireSecretConnecteur(
  tenantId: string,
  connectorId: string,
  name: string,
): Promise<string | null> {
  return lireSecret(tenantId, cleConnecteur(connectorId, name));
}

/**
 * Un secret est-il enregistré ? Sans le déchiffrer.
 *
 * C'est ce que les routes exposent à l'interface — « mot de passe enregistré :
 * oui » — plutôt qu'une valeur masquée, qui obligerait à la lire pour l'étoiler.
 */
export async function secretExiste(tenantId: string, cle: string): Promise<boolean> {
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .select({ cle: tenantSecretsTable.cle })
      .from(tenantSecretsTable)
      .where(and(eq(tenantSecretsTable.tenantId, tenantId), eq(tenantSecretsTable.cle, cle))),
  );
  return ligne !== undefined;
}

/** Révoque un secret. Une table non append-only sert exactement à ça. */
export async function revoquerSecret(tenantId: string, cle: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .delete(tenantSecretsTable)
      .where(and(eq(tenantSecretsTable.tenantId, tenantId), eq(tenantSecretsTable.cle, cle))),
  );
}

/**
 * Remplace atomiquement tous les secrets d'un connecteur et son état public.
 *
 * Le changement de méthode (clé avancée → OAuth, ou l'inverse) ne laisse aucun
 * ancien jeton dans Nodaq. Le préfixe ne contient que l'UUID du connecteur,
 * donc le LIKE reste borné à cette identité et la RLS au tenant.
 */
export async function enregistrerConnexionConnecteur(
  tenantId: string,
  connectorId: string,
  secrets: Record<string, string>,
  config: Record<string, unknown>,
  condition: { mode: "ADVANCED"; attemptHash: string } | { mode: "OAUTH"; attemptHash: string },
): Promise<void> {
  const encrypted = Object.entries(secrets).map(([name, clear]) => {
    const cle = cleConnecteur(connectorId, name);
    const { valeur, versionCle } = chiffrer(clear, { scope: tenantId, cle });
    return { tenantId, cle, valeurChiffree: valeur, versionCle };
  });
  const prefix = `connecteur.${connectorId}.%`;

  await withTenant(tenantId, async (tx) => {
    // Deux retours OAuth peuvent arriver presque ensemble. Le verrou de la
    // ligne sérialise leur remplacement de secrets et évite un DELETE/INSERT
    // concurrent sur les mêmes clés.
    const [connector] = await tx.select({
      status: connectorsTable.status,
      config: connectorsTable.config,
    })
      .from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    const etatLibre = connector?.status === "NON_CONNECTE" && connector.config["authMode"] === undefined;
    const conditionRespectee = condition.mode === "OAUTH"
      ? Boolean(
        etatLibre
        && configurationVideOuTentativeOAuth(connector!.config)
        && !tombstonesBloquantes(connector!.config)
        && connector!.config[OAUTH_ATTEMPT_PHASE] === "EXCHANGING"
        && tentativeOAuthCourante(connector!.config, condition.attemptHash),
      )
      : Boolean(
        etatLibre
        && configurationVideOuTentativeOAuth(connector!.config)
        && !tombstonesBloquantes(connector!.config)
        && connector!.config[OAUTH_ATTEMPT_PHASE] === "ADVANCED_VALIDATING"
        && tentativeOAuthCourante(connector!.config, condition.attemptHash),
      );
    if (!conditionRespectee) throw new ConflitConnexionConnecteurError();
    await tx.delete(tenantSecretsTable).where(and(
      eq(tenantSecretsTable.tenantId, tenantId),
      like(tenantSecretsTable.cle, prefix),
    ));
    if (encrypted.length > 0) await tx.insert(tenantSecretsTable).values(encrypted);
    await tx.update(connectorsTable).set({
      status: "CONNECTE",
      // Une autorisation réussie n'est pas une synchronisation. Ce champ ne
      // sera renseigné que par le futur traitement qui aura réellement lu ou
      // écrit des données chez le fournisseur.
      lastSyncAt: null,
      config: poserTombstonesOAuth({
        ...config,
        [CONNECTION_VERSION]: randomUUID(),
      }, lireTombstonesOAuth(connector!.config)),
    }).where(eq(connectorsTable.id, connectorId));
  });
}

export type ConnexionRetiree = {
  status: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  secretsTousLisibles: boolean;
  externalActionRequired: boolean;
  revocationAttemptId?: string;
};

/**
 * Annule d'abord atomiquement la tentative/connexion locale, puis rend les
 * anciennes autorisations à la route pour une révocation distante best-effort.
 * Un marqueur durable est posé AVANT de supprimer les jetons dès qu'un droit
 * externe peut exister. Il survivra donc à un crash entre le commit local et
 * l'appel tiers, et ne sera effacé qu'après révocation confirmée ou
 * acquittement explicite par l'utilisateur.
 */
export async function deconnecterConnecteur(
  tenantId: string,
  connectorId: string,
  expectedConnectionId?: string,
): Promise<ConnexionRetiree> {
  const prefix = `connecteur.${connectorId}.`;
  const snapshot = await withTenant(tenantId, async (tx) => {
    const [connector] = await tx.select({
      status: connectorsTable.status,
      config: connectorsTable.config,
    })
      .from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    if (!connector) throw new ConflitConnexionConnecteurError();
    const currentConnectionId = connector.config[CONNECTION_VERSION];
    if (
      (typeof currentConnectionId === "string" && currentConnectionId !== expectedConnectionId)
      || (expectedConnectionId !== undefined && currentConnectionId !== expectedConnectionId)
    ) {
      throw new ConflitConnexionConnecteurError();
    }
    const encrypted = await tx.select({
      cle: tenantSecretsTable.cle,
      valeurChiffree: tenantSecretsTable.valeurChiffree,
    }).from(tenantSecretsTable).where(and(
      eq(tenantSecretsTable.tenantId, tenantId),
      like(tenantSecretsTable.cle, `${prefix}%`),
    ));
    const exchangeInProgress = connector.config[OAUTH_ATTEMPT_PHASE] === "EXCHANGING";
    const tombstones = lireTombstonesOAuth(connector.config);
    const attemptHash = connector.config[OAUTH_ATTEMPT_HASH];
    if (exchangeInProgress && typeof attemptHash === "string") {
      const expiresAt = connector.config[OAUTH_ATTEMPT_EXPIRES_AT];
      tombstones[attemptHash] = {
        state: "PENDING",
        expiresAt: horizonTombstoneOAuth(expiresAt),
      };
    }
    const nouvelleAutorisationRetiree = connector.status !== "NON_CONNECTE"
      || encrypted.length > 0
      || exchangeInProgress;
    const externalActionRequired = connector.config[EXTERNAL_ACTION_REQUIRED] === true
      || nouvelleAutorisationRetiree
      || Object.values(tombstones).some((tombstone) => tombstone.state !== "ACKNOWLEDGED");
    const previousRevocationAttempt = connector.config[EXTERNAL_REVOCATION_ATTEMPT];
    const revocationAttemptId = nouvelleAutorisationRetiree
      ? randomUUID()
      : (typeof previousRevocationAttempt === "string"
        ? previousRevocationAttempt
        : (externalActionRequired ? randomUUID() : undefined));
    await tx.delete(tenantSecretsTable).where(and(
      eq(tenantSecretsTable.tenantId, tenantId),
      like(tenantSecretsTable.cle, `${prefix}%`),
    ));
    await tx.update(connectorsTable).set({
      status: "NON_CONNECTE",
      lastSyncAt: null,
      config: poserTombstonesOAuth(
        externalActionRequired ? {
          [EXTERNAL_ACTION_REQUIRED]: true,
          ...(revocationAttemptId ? { [EXTERNAL_REVOCATION_ATTEMPT]: revocationAttemptId } : {}),
        } : {},
        tombstones,
      ),
    }).where(eq(connectorsTable.id, connectorId));
    return { connector, encrypted, externalActionRequired, revocationAttemptId };
  });

  const secrets: Record<string, string> = {};
  const declaredRaw = snapshot.connector.config["__secrets"];
  const manifestRequired = snapshot.connector.status !== "NON_CONNECTE"
    || snapshot.connector.config["authMode"] !== undefined;
  const manifestValid = Array.isArray(declaredRaw)
    && declaredRaw.every((name) => typeof name === "string" && name.length > 0)
    && new Set(declaredRaw).size === declaredRaw.length;
  const declaredNames = manifestValid ? new Set(declaredRaw as string[]) : new Set<string>();
  const storedNames = new Set(snapshot.encrypted.map((secret) => secret.cle.slice(prefix.length)));
  // Une clé annoncée mais absente (ou une clé stockée hors manifeste) interdit
  // d'affirmer que toute capacité a été révoquée.
  let secretsTousLisibles = (!manifestRequired || manifestValid)
    && declaredNames.size === storedNames.size
    && [...declaredNames].every((name) => storedNames.has(name));
  for (const secret of snapshot.encrypted) {
    try {
      secrets[secret.cle.slice(prefix.length)] = dechiffrer(secret.valeurChiffree, {
        scope: tenantId,
        cle: secret.cle,
      });
    } catch {
      secretsTousLisibles = false;
    }
  }
  return {
    status: snapshot.connector.status,
    config: snapshot.connector.config,
    secrets,
    secretsTousLisibles,
    externalActionRequired: snapshot.externalActionRequired,
    ...(snapshot.revocationAttemptId ? { revocationAttemptId: snapshot.revocationAttemptId } : {}),
  };
}

/**
 * Acquitte atomiquement une action externe explicitement confirmée par
 * l'utilisateur. L'identifiant observé dans l'interface fait office de CAS :
 * un ancien clic ne peut ni supprimer une connexion ni acquitter une alerte
 * créées après son affichage.
 */
export async function confirmerRetraitExterneManuellement(
  tenantId: string,
  connectorId: string,
  revocationAttemptId: string,
): Promise<void> {
  const prefix = `connecteur.${connectorId}.`;
  await withTenant(tenantId, async (tx) => {
    const [connector] = await tx.select({
      config: connectorsTable.config,
    }).from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    if (
      !connector
      || connector.config[EXTERNAL_ACTION_REQUIRED] !== true
      || connector.config[EXTERNAL_REVOCATION_ATTEMPT] !== revocationAttemptId
    ) {
      throw new ConflitConnexionConnecteurError();
    }

    const tombstones = lireTombstonesOAuth(connector.config);
    const currentAttempt = connector.config[OAUTH_ATTEMPT_HASH];
    if (connector.config[OAUTH_ATTEMPT_PHASE] === "EXCHANGING" && typeof currentAttempt === "string") {
      tombstones[currentAttempt] = {
        state: "PENDING",
        expiresAt: horizonTombstoneOAuth(connector.config[OAUTH_ATTEMPT_EXPIRES_AT]),
      };
    }
    for (const [hash, tombstone] of Object.entries(tombstones)) {
      if (tombstone.state === "PENDING") {
        tombstones[hash] = { ...tombstone, state: "ACKNOWLEDGED" };
      } else if (tombstone.state === "NEEDS_ACTION") {
        delete tombstones[hash];
      }
    }

    await tx.delete(tenantSecretsTable).where(and(
      eq(tenantSecretsTable.tenantId, tenantId),
      like(tenantSecretsTable.cle, `${prefix}%`),
    ));
    await tx.update(connectorsTable).set({
      status: "NON_CONNECTE",
      lastSyncAt: null,
      config: poserTombstonesOAuth({}, tombstones),
    }).where(eq(connectorsTable.id, connectorId));
  });
}

/**
 * Efface le marqueur seulement après une révocation distante de la génération
 * exacte. Un succès ancien ne peut pas acquitter un état plus récent.
 */
export async function confirmerRetraitExterneConnecteur(
  tenantId: string,
  connectorId: string,
  revocationAttemptId: string,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [connector] = await tx.select({
      status: connectorsTable.status,
      config: connectorsTable.config,
    }).from(connectorsTable)
      .where(eq(connectorsTable.id, connectorId))
      .for("update");
    if (
      !connector
      || connector.status !== "NON_CONNECTE"
      || connector.config[EXTERNAL_ACTION_REQUIRED] !== true
      || connector.config[EXTERNAL_REVOCATION_ATTEMPT] !== revocationAttemptId
    ) {
      throw new ConflitConnexionConnecteurError();
    }
    const config = { ...connector.config };
    const tombstones = lireTombstonesOAuth(config);

    // Une révocation distante ne prouve que le jeton qui vient d'être
    // présenté au fournisseur. Elle ne doit jamais acquitter un callback
    // ancien dont le droit externe peut être distinct. La génération, elle,
    // est résolue : un callback compensé pourra ensuite retirer le marqueur.
    const autreDroitPossible = Object.values(tombstones).some((tombstone) => (
      tombstone.state === "PENDING" || tombstone.state === "NEEDS_ACTION"
    ));
    if (autreDroitPossible) {
      // Le jeton ciblé est résolu mais une autre tentative reste ambiguë. Une
      // nouvelle génération maintient l'action manuelle possible tout en
      // invalidant un clic affiché avant ce changement de situation.
      config[EXTERNAL_REVOCATION_ATTEMPT] = randomUUID();
    } else {
      delete config[EXTERNAL_ACTION_REQUIRED];
      delete config[EXTERNAL_REVOCATION_ATTEMPT];
    }

    const externalActionRequired = config[EXTERNAL_ACTION_REQUIRED] === true;
    await tx.update(connectorsTable).set({
      config: poserTombstonesOAuth(config, tombstones),
    })
      .where(eq(connectorsTable.id, connectorId));
    return externalActionRequired;
  });
}
