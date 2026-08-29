/**
 * Le chiffrement de la connexion à la base, tenu par le code.
 *
 * ── CE QUE CES GARDES PROTÈGENT ───────────────────────────────────────────
 * Mesuré le 29/08/2026 sur l'instance de production, sans aucun identifiant
 * réel — la négociation TLS précède l'authentification :
 *
 *     sslmode=disable → « password authentication failed »
 *
 * Le serveur ACCEPTE donc le clair. Rien n'obligeait l'application à chiffrer,
 * l'image ne portait aucune CA, et `sslmode=require` échoue sur cette
 * instance. Le trafic traversait vraisemblablement l'internet public en clair
 * vers une base ouverte à `0.0.0.0/0`.
 *
 * La leçon dépasse le cas : une propriété de sécurité qui dépend du contenu
 * d'un secret n'est pas une propriété. Personne ne relit une chaîne de
 * connexion, et une omission ne se remarque jamais. Elle doit être VÉRIFIÉE
 * par le code, au démarrage, bruyamment.
 */
import { describe, test, expect } from "vitest";
/*
 * Importé depuis `@workspace/db` et NON depuis `lib/db/test/` : ce paquet n'a
 * pas de script `test`, si bien qu'un fichier posé là-bas ne serait jamais
 * exécuté par la CI (`pnpm -r --if-present run test`). Un test qui se saute
 * silencieusement ne protège rien — le dépôt en a déjà fait les frais.
 */
import { optionsTls, DbTlsError, hoteDe } from "@workspace/db";

/** Un PEM plausible — le contenu importe peu, sa forme oui. */
const CA = "-----BEGIN CERTIFICATE-----\nMIIEBDCCAuyg\n-----END CERTIFICATE-----\n";
const URL_DNS = "postgres://app_user:x@rw-abc.rdb.fr-par.scw.cloud:3939/nodaq";
const URL_IP = "postgres://app_user:x@195.154.197.204:3939/nodaq";

describe("avec une CA fournie", () => {
  test("le TLS est vérifié, et le nom du serveur est FORCÉ", () => {
    const o = optionsTls(URL_DNS, { DATABASE_CA_PEM: CA } as NodeJS.ProcessEnv);

    expect(o).toBeDefined();
    expect(o!.rejectUnauthorized).toBe(true);
    expect(o!.ca).toContain("BEGIN CERTIFICATE");
    /*
     * LA garde qui a coûté trois tentatives de migration. `pg` n'envoie de
     * `servername` que si l'hôte n'est pas une IP ; sans lui, Node compare le
     * certificat à « localhost » et échoue avec un message incompréhensible.
     */
    expect(o!.servername).toBe("rw-abc.rdb.fr-par.scw.cloud");
  });

  test("une adresse IP est REFUSÉE, avec la raison", () => {
    expect(() => optionsTls(URL_IP, { DATABASE_CA_PEM: CA } as NodeJS.ProcessEnv))
      .toThrow(DbTlsError);
    try {
      optionsTls(URL_IP, { DATABASE_CA_PEM: CA } as NodeJS.ProcessEnv);
    } catch (e) {
      // Un refus qui ne dit pas quoi faire fait perdre autant de temps qu'un
      // échec obscur : le message doit porter la correction.
      expect((e as Error).message).toMatch(/nom DNS/i);
      expect((e as Error).message).toContain("195.154.197.204");
    }
  });

  test("un certificat tronqué est refusé tout de suite", () => {
    expect(() => optionsTls(URL_DNS, { DATABASE_CA_PEM: "pas-un-pem" } as NodeJS.ProcessEnv))
      .toThrow(/PEM/);
  });
});

describe("sans CA", () => {
  /*
   * LE cœur du ticket. Une base qui repart en clair par omission ne se
   * remarque JAMAIS — aucune erreur, aucun ralentissement, rien à l'écran.
   * Tomber au démarrage est bruyant ; fuir ne l'est pas.
   */
  test("en PRODUCTION, l'application refuse de démarrer", () => {
    expect(() => optionsTls(URL_DNS, { NODE_ENV: "production" } as NodeJS.ProcessEnv))
      .toThrow(DbTlsError);
    try {
      optionsTls(URL_DNS, { NODE_ENV: "production" } as NodeJS.ProcessEnv);
    } catch (e) {
      expect((e as Error).message).toContain("DATABASE_CA_PEM");
      expect((e as Error).message).toMatch(/EN CLAIR/);
      // Le message dit où trouver le certificat : sans ça, le refus bloque
      // sans donner la sortie.
      expect((e as Error).message).toMatch(/get-certificate/);
    }
  });

  /*
   * Hors production, pas de TLS — et c'est délibéré. Le Postgres local et
   * celui de la CI n'en ont pas ; exiger une CA rendrait la suite de tests
   * impossible à exécuter, ce qui finirait par faire désactiver la règle.
   */
  test("hors production, la connexion reste possible sans TLS", () => {
    expect(optionsTls(URL_DNS, {} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(optionsTls(URL_DNS, { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeUndefined();
  });

  /*
   * `production` doit être le mot EXACT. Un `NODE_ENV=prod` ou `Production`
   * qui passerait à travers rendrait la garde inopérante là où elle compte.
   */
  test("seul `production` déclenche le refus — pas une variante", () => {
    for (const v of ["prod", "Production", "PRODUCTION", "staging"]) {
      expect(optionsTls(URL_DNS, { NODE_ENV: v } as NodeJS.ProcessEnv), v).toBeUndefined();
    }
  });
});

describe("hoteDe", () => {
  test("rend l'hôte, jamais le reste de la chaîne", () => {
    expect(hoteDe(URL_DNS)).toBe("rw-abc.rdb.fr-par.scw.cloud");
    // Le mot de passe ne doit jamais ressortir d'une fonction utilitaire :
    // c'est ainsi qu'un secret finit dans un journal.
    expect(hoteDe(URL_DNS)).not.toContain("x");
  });

  test("une chaîne illisible rend null plutôt que de deviner", () => {
    expect(hoteDe("pas-une-url")).toBeNull();
  });
});
