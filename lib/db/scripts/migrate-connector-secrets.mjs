#!/usr/bin/env node
/**
 * Reprise de `connectors.config` — sort les champs sensibles du `jsonb`.
 *
 *   node lib/db/scripts/migrate-connector-secrets.mjs
 *   node lib/db/scripts/migrate-connector-secrets.mjs --dry-run
 *
 * Le chiffrement reste dans le processus applicatif : faire voyager la cle
 * dans une migration SQL l'exposerait dans les journaux PostgreSQL. Chaque
 * connecteur est repris dans UNE transaction qui verrouille sa ligne : les
 * secrets sont ranges avant que leurs valeurs en clair quittent le JSON, ou
 * rien ne change.
 *
 * Le script sait aussi reconnaitre la sortie de son ancienne version. Celle-ci
 * passait `{ tenantId, cle }` a `chiffrer` au lieu de `{ scope: tenantId, cle }`
 * et liait donc le chiffre a l'AAD `undefined|<cle>`. Quand la meme cle de
 * chiffrement est encore disponible, cette valeur est dechiffree puis reliee
 * au bon tenant sans jamais etre journalisee.
 */
import pg from "pg";
import {
  chiffrer,
  dechiffrer,
  verifierConfigurationChiffrement,
} from "@nodaq/crypto";

const { Pool } = pg;

/** Noms precis ecrits par l'ancien formulaire de connecteurs. */
const CHAMPS_LEGACY = new Set([
  "apiKey",
  "secretKey",
  "webhookSecret",
  "clientSecret",
  "webhookUrl",
]);

/** Variantes historiques dont le nom ne finit pas directement par le secret. */
const CHAMPS_SENSIBLES_EXACTS = new Set([
  ...CHAMPS_LEGACY,
  "secret_key",
  "webhook_url",
]);

/**
 * Un suffixe, pas une sous-chaine : `access_token` est un secret,
 * `tokenExpiresAt` est une metadonnee publique necessaire a l'interface.
 */
const FIN_SENSIBLE_SNAKE =
  /(?:^|_)(?:password|secret|token|api_key|credential)s?$/i;
const FIN_SENSIBLE_CAMEL = /(?:Password|Secret|Token|ApiKey|Credential)s?$/;

const possede = (objet, cle) =>
  Object.prototype.hasOwnProperty.call(objet, cle);

function estSensible(champ) {
  return (
    CHAMPS_SENSIBLES_EXACTS.has(champ) ||
    FIN_SENSIBLE_SNAKE.test(champ) ||
    FIN_SENSIBLE_CAMEL.test(champ)
  );
}

function lireArguments(argv) {
  const inconnus = argv.filter((argument) => argument !== "--dry-run");
  if (inconnus.length > 0) {
    throw new Error(`argument inconnu: ${inconnus[0]}`);
  }
  return { dryRun: argv.includes("--dry-run") };
}

/** Meme politique TLS que le runner SQL owner. */
function optionsTls(connectionString) {
  const caPem = (process.env.DATABASE_CA_PEM ?? "").trim();
  if (caPem) {
    if (!caPem.includes("BEGIN CERTIFICATE")) {
      throw new Error("DATABASE_CA_PEM ne ressemble pas a un certificat PEM.");
    }
    let hote = "";
    try {
      hote = new URL(connectionString).hostname;
    } catch {
      // La connexion elle-meme rendra ensuite une erreur sans exposer le mot
      // de passe. On ne journalise jamais la chaine recue.
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hote) || hote.includes(":")) {
      throw new Error(
        "DATABASE_URL vise une adresse IP incompatible avec la verification TLS; utiliser le nom DNS.",
      );
    }
    return { ca: caPem, rejectUnauthorized: true, servername: hote };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_CA_PEM absente en production: refus de reprendre les secrets sur une connexion non verifiee.",
    );
  }
  return undefined;
}

function lireMarqueurs(config, connectorId) {
  if (!possede(config, "__secrets")) return [];
  const brut = config.__secrets;
  if (
    !Array.isArray(brut) ||
    brut.some(
      (champ) =>
        typeof champ !== "string" ||
        champ.length === 0 ||
        champ === "__secrets",
    )
  ) {
    throw new Error(
      `marqueur __secrets invalide sur le connecteur ${connectorId}`,
    );
  }
  return [...new Set(brut)];
}

function dechiffrerExistant(valeur, tenantId, cle) {
  try {
    return {
      clair: dechiffrer(valeur, { scope: tenantId, cle }),
      aadLegacy: false,
    };
  } catch (erreurCourante) {
    try {
      // Compatibilite avec l'ancienne identite `{ tenantId, cle }` : le
      // template de l'AAD avait converti `scope === undefined` en ce texte.
      return {
        clair: dechiffrer(valeur, { scope: "undefined", cle }),
        aadLegacy: true,
      };
    } catch {
      throw erreurCourante;
    }
  }
}

function memeListe(a, b) {
  return (
    a.length === b.length && a.every((valeur, index) => valeur === b[index])
  );
}

async function reprendreConnecteur(pool, connectorId, dryRun) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id, tenant_id, type, status, config
         FROM connectors
        WHERE id = $1
        FOR UPDATE`,
      [connectorId],
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return { repris: false, deplaces: 0, repares: 0 };
    }

    const ligne = rows[0];
    const config = ligne.config ?? {};
    if (typeof config !== "object" || Array.isArray(config)) {
      throw new Error(
        `configuration invalide sur le connecteur ${connectorId}`,
      );
    }

    const marques = lireMarqueurs(config, connectorId);
    const authModeValide =
      typeof config.authMode === "string" && config.authMode.trim().length > 0;
    const connexionLegacyNonValidee =
      ligne.status === "CONNECTE" && ligne.type !== "BANQUE" && !authModeValide;
    const enClair = Object.keys(config).filter(
      (champ) => champ !== "__secrets" && estSensible(champ),
    );
    for (const champ of enClair) {
      if (typeof config[champ] !== "string") {
        // Stringifier un objet, null ou un booleen serait une transformation
        // irreversible. On laisse donc le JSON intact et on exige une reprise
        // manuelle plutot que de pretendre avoir conserve la valeur.
        throw new Error(
          `champ sensible non textuel sur le connecteur ${connectorId}: ${champ}`,
        );
      }
    }

    const champs = [...new Set([...marques, ...enClair])].sort();
    if (champs.length === 0 && !connexionLegacyNonValidee) {
      await client.query("COMMIT");
      return { repris: false, deplaces: 0, repares: 0 };
    }

    const cles = champs.map((champ) => `connecteur.${connectorId}.${champ}`);
    const existants = await client.query(
      `SELECT cle, valeur_chiffree, version_cle
         FROM tenant_secrets
        WHERE tenant_id = $1::uuid
          AND cle = ANY($2::text[])
        FOR UPDATE`,
      [ligne.tenant_id, cles],
    );
    const parCle = new Map(
      existants.rows.map((secret) => [secret.cle, secret]),
    );
    const insertions = [];
    const reparations = [];

    for (const champ of champs) {
      const cle = `connecteur.${connectorId}.${champ}`;
      const secretExistant = parCle.get(cle);
      const porteClair = possede(config, champ);
      const clairConfig = porteClair ? config[champ] : undefined;

      if (!secretExistant) {
        if (!porteClair) {
          throw new Error(
            `secret marque mais absent sur le connecteur ${connectorId}: ${champ}`,
          );
        }
        const chiffre = chiffrer(clairConfig, { scope: ligne.tenant_id, cle });
        insertions.push({ cle, ...chiffre });
        continue;
      }

      const lu = dechiffrerExistant(
        secretExistant.valeur_chiffree,
        ligne.tenant_id,
        cle,
      );
      if (porteClair && lu.clair !== clairConfig) {
        // Deux valeurs differentes existent et rien ne permet de savoir
        // laquelle est la bonne. Ne jamais en ecraser une arbitrairement.
        throw new Error(
          `conflit de secret sur le connecteur ${connectorId}: ${champ}`,
        );
      }
      if (lu.aadLegacy) {
        const chiffre = chiffrer(
          lu.clair,
          { scope: ligne.tenant_id, cle },
          secretExistant.version_cle,
        );
        reparations.push({
          cle,
          ancien: secretExistant.valeur_chiffree,
          ...chiffre,
        });
      }
    }

    const restant = { ...config };
    for (const champ of enClair) delete restant[champ];
    if (champs.length > 0) restant.__secrets = champs;
    if (connexionLegacyNonValidee) restant.reconnectRequired = true;
    const marqueursTries = [...marques].sort();
    const configChange =
      enClair.length > 0 ||
      !memeListe(marqueursTries, champs) ||
      connexionLegacyNonValidee;
    const doitChanger =
      configChange || insertions.length > 0 || reparations.length > 0;

    if (!dryRun && doitChanger) {
      for (const secret of insertions) {
        await client.query(
          `INSERT INTO tenant_secrets (tenant_id, cle, valeur_chiffree, version_cle)
           VALUES ($1::uuid, $2, $3, $4)`,
          [ligne.tenant_id, secret.cle, secret.valeur, secret.versionCle],
        );
      }
      for (const secret of reparations) {
        const miseAJour = await client.query(
          `UPDATE tenant_secrets
              SET valeur_chiffree = $1, version_cle = $2, updated_at = NOW()
            WHERE tenant_id = $3::uuid AND cle = $4 AND valeur_chiffree = $5`,
          [
            secret.valeur,
            secret.versionCle,
            ligne.tenant_id,
            secret.cle,
            secret.ancien,
          ],
        );
        if (miseAJour.rowCount !== 1) {
          throw new Error(
            `secret modifie en concurrence sur le connecteur ${connectorId}`,
          );
        }
      }
      if (configChange) {
        await client.query(
          `UPDATE connectors
              SET config = $1::jsonb,
                  status = $2,
                  updated_at = NOW()
            WHERE id = $3`,
          [
            JSON.stringify(restant),
            connexionLegacyNonValidee ? "ERREUR" : ligne.status,
            connectorId,
          ],
        );
      }
    }

    await client.query("COMMIT");
    return {
      repris: doitChanger,
      deplaces: insertions.length,
      repares: reparations.length,
    };
  } catch (erreur) {
    await client.query("ROLLBACK");
    // L'identifiant et le nom logique peuvent etre journalises, jamais les
    // valeurs en clair ni chiffrees.
    console.error(`[connector-secrets] echec sur le connecteur ${connectorId}`);
    throw erreur;
  } finally {
    client.release();
  }
}

/**
 * Garde APRES reprise, sur un nouvel instantane de la table.
 *
 * Elle est volontairement redondante avec le traitement ligne par ligne : une
 * ecriture concurrente ou un marqueur partiellement casse ne doivent jamais
 * laisser le script annoncer un succes puis autoriser le demarrage de l'API.
 */
async function verifierReprise(pool) {
  const { rows } = await pool.query(
    "SELECT id, tenant_id, type, status, config FROM connectors ORDER BY id",
  );
  let secretsVerifies = 0;

  for (const ligne of rows) {
    const config = ligne.config ?? {};
    if (typeof config !== "object" || Array.isArray(config)) {
      throw new Error(
        `garde post-reprise: configuration invalide sur ${ligne.id}`,
      );
    }
    const restants = Object.keys(config).filter(
      (champ) => champ !== "__secrets" && estSensible(champ),
    );
    if (restants.length > 0) {
      throw new Error(
        `garde post-reprise: secret legacy encore en clair sur ${ligne.id}`,
      );
    }
    const authModeValide =
      typeof config.authMode === "string" && config.authMode.trim().length > 0;
    if (
      ligne.status === "CONNECTE" &&
      ligne.type !== "BANQUE" &&
      !authModeValide
    ) {
      throw new Error(
        `garde post-reprise: CONNECTE sans authMode valide sur ${ligne.id}`,
      );
    }

    const marqueurs = lireMarqueurs(config, ligne.id);
    if (marqueurs.length === 0) continue;
    const cles = marqueurs.map((champ) => `connecteur.${ligne.id}.${champ}`);
    const secrets = await pool.query(
      `SELECT cle, valeur_chiffree
         FROM tenant_secrets
        WHERE tenant_id = $1::uuid
          AND cle = ANY($2::text[])`,
      [ligne.tenant_id, cles],
    );
    const parCle = new Map(secrets.rows.map((secret) => [secret.cle, secret]));

    for (const cle of cles) {
      const secret = parCle.get(cle);
      if (!secret) {
        throw new Error(
          `garde post-reprise: marqueur sans secret sur ${ligne.id}`,
        );
      }
      // Aucun repli vers l'AAD legacy ici : la reprise devait deja la reparer.
      dechiffrer(secret.valeur_chiffree, { scope: ligne.tenant_id, cle });
      secretsVerifies++;
    }
  }

  return { connecteurs: rows.length, secrets: secretsVerifies };
}

async function main() {
  const { dryRun } = lireArguments(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL doit etre definie (role proprietaire).");
  }
  verifierConfigurationChiffrement();

  const ssl = optionsTls(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ...(ssl ? { ssl } : {}),
  });
  let reprises = 0;
  let ignorees = 0;
  let deplaces = 0;
  let repares = 0;

  try {
    // Les donnees sont relues sous verrou dans `reprendreConnecteur`. Cette
    // premiere requete ne sert qu'a figer une liste d'identifiants sans garder
    // une transaction globale ouverte pendant tout le traitement.
    const { rows } = await pool.query("SELECT id FROM connectors ORDER BY id");
    for (const { id } of rows) {
      const resultat = await reprendreConnecteur(pool, id, dryRun);
      if (resultat.repris) reprises++;
      else ignorees++;
      deplaces += resultat.deplaces;
      repares += resultat.repares;
    }

    let garde = null;
    if (!dryRun) {
      garde = await verifierReprise(pool);
      await pool.query(
        "ALTER TABLE connectors VALIDATE CONSTRAINT connectors_config_no_legacy_secrets",
      );
    }

    const mode = dryRun ? " DRY-RUN" : "";
    console.log(
      `[connector-secrets]${mode} connecteurs repris: ${reprises}` +
        ` | secrets deplaces: ${deplaces}` +
        ` | AAD reparees: ${repares}` +
        ` | deja a jour ou sans secret: ${ignorees}`,
    );
    if (garde) {
      console.log(
        `[connector-secrets] garde post-reprise: ${garde.connecteurs} connecteur(s), ` +
          `${garde.secrets} secret(s) lisible(s), aucun legacy en clair`,
      );
      console.log(
        "[connector-secrets] contrainte anti-legacy validee pour les futures ecritures",
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((erreur) => {
  console.error(
    "[connector-secrets]",
    erreur instanceof Error ? erreur.message : "echec",
  );
  process.exit(1);
});
