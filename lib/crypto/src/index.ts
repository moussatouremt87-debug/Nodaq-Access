/*
 * Chiffrement des secrets au repos — AES-256-GCM.
 *
 * PAQUET DÉDIÉ, ET NON `lib/shared` : ce module importe `node:crypto`.
 * `lib/shared` est écrit pour rester isomorphe — le front en recopie déjà des
 * bouts plutôt que d'en importer le tonneau. Y poser une dépendance Node
 * fermerait cette porte pour de bon.
 *
 * CE QU'ON CHIFFRE : des SECRETS, c'est-à-dire ce qui ouvre un accès chez un
 * tiers — mot de passe SMTP, jeton d'un connecteur. Aucune donnée client n'est
 * chiffrée ici. Ce n'est pas le même problème et ce n'est pas la même réponse.
 *
 * ── Pourquoi PAS pgcrypto, alors que l'extension est activée ─────────────────
 * Avec pgcrypto la clé voyage DANS l'instruction SQL. Elle apparaît alors dans
 * `pg_stat_activity`, dans `pg_stat_statements`, et dans les journaux du
 * serveur dès la première erreur de syntaxe. Un secret qui a transité par un
 * journal est brûlé (CLAUDE.md §6). Le chiffrement se fait donc ici, et la base
 * ne voit jamais que du chiffré.
 *
 * ── Le point qui compte : l'AAD ─────────────────────────────────────────────
 * Les données authentifiées supplémentaires valent `${tenantId}|${cle}`. Un
 * chiffré recopié de la ligne d'un tenant vers celle d'un autre — ou d'une clé
 * logique vers une autre — ne se déchiffre PAS : l'authentification GCM échoue.
 * Le chiffrement devient une seconde barrière d'isolation, derrière la RLS,
 * alignée sur la doctrine du dépôt.
 *
 * ── Aucun repli, jamais ─────────────────────────────────────────────────────
 * Clé absente, mal encodée ou de mauvaise longueur : on lève. On n'écrit
 * JAMAIS en clair « en attendant ». Un démarrage qui fonctionne sans clé et
 * range les secrets en clair est le pire résultat possible, parce que personne
 * ne le remarque.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/** Longueur exigée de la clé, en octets. AES-256 : 32, et rien d'autre. */
export const LONGUEUR_CLE_OCTETS = 32;

/** 96 bits — la taille d'IV recommandée pour GCM, et la seule qu'on écrit. */
const LONGUEUR_IV_OCTETS = 12;

/** 128 bits d'étiquette d'authentification. */
const LONGUEUR_TAG_OCTETS = 16;

/** Préfixe de format. Un jour où l'algorithme change, `v2:` cohabitera. */
const FORMAT = "v1";

/**
 * Erreur de CONFIGURATION du chiffrement — clé absente ou inexploitable.
 *
 * Distincte d'un échec de déchiffrement : celle-ci dit « ce déploiement est mal
 * configuré », l'autre dit « ce chiffré est faux ». Confondre les deux ferait
 * répondre 503 à une altération de données, ou 500 à une variable oubliée.
 *
 * Son message ne porte JAMAIS de valeur de clé, même tronquée.
 */
export class ChiffrementConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChiffrementConfigError";
  }
}

/** Échec de déchiffrement : clé fausse, AAD fausse, ou chiffré altéré. */
export class DechiffrementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DechiffrementError";
  }
}

/** Identité d'un secret. C'est elle, et elle seule, qui forme l'AAD. */
export interface IdentiteSecret {
  readonly tenantId: string;
  /** Clé logique, par exemple « envoi.smtp_password ». */
  readonly cle: string;
}

// ── Lecture des clés ─────────────────────────────────────────────────────────

/**
 * Décode une clé encodée en base64 et vérifie sa longueur.
 *
 * `nom` sert UNIQUEMENT à écrire quelle variable est en cause. La valeur, elle,
 * ne sort jamais de cette fonction — ni en entier, ni tronquée, ni sa longueur
 * réelle quand elle est fausse : dire « 24 octets au lieu de 32 » renseigne un
 * attaquant qui lit les journaux sur ce qu'il a réussi à injecter.
 */
function decoder(nom: string, brut: string): Buffer {
  let octets: Buffer;
  try {
    octets = Buffer.from(brut, "base64");
  } catch {
    throw new ChiffrementConfigError(`${nom} n'est pas un base64 valide.`);
  }
  // Buffer.from ne lève pas sur du base64 invalide : il tronque en silence.
  // La vérification de longueur est donc la vraie garde, pas un contrôle de
  // confort.
  if (octets.length !== LONGUEUR_CLE_OCTETS) {
    throw new ChiffrementConfigError(
      `${nom} doit contenir exactement ${LONGUEUR_CLE_OCTETS} octets encodés en base64. ` +
        `Engendrer une clé : openssl rand -base64 32`,
    );
  }
  return octets;
}

/**
 * La clé courante — celle qui chiffre. Absente = on lève, jamais de défaut.
 *
 * Lue à CHAQUE appel et non mise en cache au chargement du module : un test
 * qui pose la variable après l'import doit être servi, et le coût d'un décodage
 * base64 de 32 octets est nul devant un aller-retour base.
 */
export function cleCourante(): Buffer {
  const brut = process.env["ENCRYPTION_KEY"];
  if (brut === undefined || brut.trim() === "") {
    throw new ChiffrementConfigError(
      "ENCRYPTION_KEY doit être définie — aucun secret ne peut être lu ni écrit sans elle. " +
        "Engendrer une clé : openssl rand -base64 32",
    );
  }
  return decoder("ENCRYPTION_KEY", brut.trim());
}

/** La clé précédente, pour la rotation. `null` quand il n'y en a pas. */
export function clePrecedente(): Buffer | null {
  const brut = process.env["ENCRYPTION_KEY_PREVIOUS"];
  if (brut === undefined || brut.trim() === "") return null;
  return decoder("ENCRYPTION_KEY_PREVIOUS", brut.trim());
}

/**
 * Garde de démarrage. Lève si la configuration est inexploitable.
 *
 * Vérifie aussi que les deux clés DIFFÈRENT : une rotation où l'ancienne et la
 * nouvelle sont identiques ne fait rien tout en ayant l'air d'avoir fonctionné.
 * Comparaison à temps constant — la routine coûte peu et l'habitude évite
 * qu'on l'oublie là où elle compte.
 */
export function verifierConfigurationChiffrement(): void {
  const courante = cleCourante();
  const precedente = clePrecedente();
  if (precedente !== null && timingSafeEqual(courante, precedente)) {
    throw new ChiffrementConfigError(
      "ENCRYPTION_KEY et ENCRYPTION_KEY_PREVIOUS sont identiques : la rotation n'aurait aucun effet.",
    );
  }
}

// ── Chiffrement ──────────────────────────────────────────────────────────────

/** L'AAD lie le chiffré à SA ligne. Déplacé, il ne s'ouvre plus. */
function aad(identite: IdentiteSecret): Buffer {
  return Buffer.from(`${identite.tenantId}|${identite.cle}`, "utf8");
}

export interface Chiffre {
  /** La chaîne à ranger dans `valeur_chiffree`. */
  readonly valeur: string;
  /** À ranger dans `version_cle`, en regard. */
  readonly versionCle: number;
}

/**
 * Chiffre une valeur pour une identité donnée.
 *
 * `versionCle` compte combien de fois CE chiffré a été re-clé : 1 à la
 * première écriture, incrémenté par le script de rotation. C'est une donnée
 * d'inventaire — savoir combien de lignes restent à rechiffrer — et non ce qui
 * permet de choisir la clé au déchiffrement : `dechiffrer` essaie la clé
 * courante puis la précédente, ce qui reste juste même si quelqu'un a écrit une
 * version fantaisiste à la main.
 *
 * L'IV est tiré au sort à chaque appel : deux chiffrements de la même valeur
 * donnent deux résultats différents. Réutiliser un IV en GCM est la faute qui
 * casse tout — elle révèle le XOR des deux clairs et permet de forger des
 * étiquettes valides.
 */
export function chiffrer(
  clair: string,
  identite: IdentiteSecret,
  versionCle = 1,
): Chiffre {
  const cle = cleCourante();
  const iv = randomBytes(LONGUEUR_IV_OCTETS);
  const cipher = createCipheriv("aes-256-gcm", cle, iv, {
    authTagLength: LONGUEUR_TAG_OCTETS,
  });
  cipher.setAAD(aad(identite));
  const chiffre = Buffer.concat([cipher.update(clair, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    valeur: [
      FORMAT,
      String(versionCle),
      iv.toString("base64"),
      tag.toString("base64"),
      chiffre.toString("base64"),
    ].join(":"),
    versionCle,
  };
}

/** Ce qu'on peut lire d'un chiffré SANS posséder la clé. */
export interface EnTeteChiffre {
  readonly format: string;
  readonly versionCle: number;
}

/**
 * Lit l'en-tête d'un chiffré — format et version — sans le déchiffrer.
 *
 * Le script de rotation en a besoin pour inventorier, et la garde
 * « rien en clair en base » pour vérifier le format sans clé.
 */
export function lireEnTete(stocke: string): EnTeteChiffre | null {
  const parts = stocke.split(":");
  if (parts.length !== 5) return null;
  const [format, version] = parts;
  if (format !== FORMAT) return null;
  const versionCle = Number(version);
  if (!Number.isInteger(versionCle) || versionCle < 1) return null;
  return { format, versionCle };
}

/**
 * Déchiffre avec une clé donnée. Lève sur toute anomalie.
 *
 * Le message d'erreur ne porte QUE le nom de la clé logique — jamais le
 * chiffré, jamais un fragment de clair, jamais la clé. Un journal d'erreur est
 * exactement l'endroit où un secret finit par fuiter.
 */
function dechiffrerAvec(stocke: string, identite: IdentiteSecret, cle: Buffer): string {
  const parts = stocke.split(":");
  if (parts.length !== 5 || parts[0] !== FORMAT) {
    throw new DechiffrementError(`Format de chiffré inattendu pour « ${identite.cle} ».`);
  }
  const iv = Buffer.from(parts[2]!, "base64");
  const tag = Buffer.from(parts[3]!, "base64");
  const chiffre = Buffer.from(parts[4]!, "base64");

  if (iv.length !== LONGUEUR_IV_OCTETS || tag.length !== LONGUEUR_TAG_OCTETS) {
    throw new DechiffrementError(`Chiffré altéré pour « ${identite.cle} ».`);
  }

  const decipher = createDecipheriv("aes-256-gcm", cle, iv, {
    authTagLength: LONGUEUR_TAG_OCTETS,
  });
  decipher.setAAD(aad(identite));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(chiffre), decipher.final()]).toString("utf8");
  } catch {
    // `final()` lève dès que l'étiquette ne colle pas : mauvaise clé, mauvaise
    // AAD, ou un seul octet modifié. On ne rend JAMAIS le clair partiel que
    // `update()` a déjà produit — un clair silencieusement faux est pire qu'une
    // erreur.
    throw new DechiffrementError(
      `Déchiffrement impossible pour « ${identite.cle} » : clé, tenant ou contenu ne correspondent pas.`,
    );
  }
}

/**
 * Déchiffre, en essayant la clé courante puis la précédente.
 *
 * Ce repli est ce qui rend la rotation vivable : pendant qu'elle tourne, la
 * base porte les deux générations et l'application sert les deux. Il ne
 * dispense de rien — le script doit passer — mais il évite une coupure.
 */
export function dechiffrer(stocke: string, identite: IdentiteSecret): string {
  try {
    return dechiffrerAvec(stocke, identite, cleCourante());
  } catch (err) {
    if (err instanceof ChiffrementConfigError) throw err;
    const precedente = clePrecedente();
    if (precedente === null) throw err;
    return dechiffrerAvec(stocke, identite, precedente);
  }
}

/** Vrai si ce chiffré s'ouvre avec la clé COURANTE. Base de l'idempotence. */
export function dejaAJour(stocke: string, identite: IdentiteSecret): boolean {
  try {
    dechiffrerAvec(stocke, identite, cleCourante());
    return true;
  } catch (err) {
    if (err instanceof ChiffrementConfigError) throw err;
    return false;
  }
}
