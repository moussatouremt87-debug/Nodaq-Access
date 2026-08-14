/**
 * Chiffrement des secrets — cas posés à la main.
 *
 * Ce que ces tests protègent :
 *   — aller-retour fidèle, y compris sur des accents et du volume ;
 *   — deux chiffrements de la même valeur DIFFÈRENT (IV tiré au sort) ;
 *   — l'AAD lie le chiffré à SA ligne : déplacé, il ne s'ouvre plus ;
 *   — une altération d'un seul octet échoue au lieu de rendre un clair faux ;
 *   — une clé absente ou mal formée lève, sans jamais laisser passer en clair.
 *
 * AUCUNE CLÉ EN DUR. Chaque clé est tirée au sort dans le test. Une clé écrite
 * dans le dépôt est une clé publiée, et une clé qui RESSEMBLE à une vraie finit
 * recopiée en production par quelqu'un de pressé.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  chiffrer,
  dechiffrer,
  dejaAJour,
  lireEnTete,
  verifierConfigurationChiffrement,
  ChiffrementConfigError,
  DechiffrementError,
  LONGUEUR_CLE_OCTETS,
} from "../src/index.js";

const nouvelleCle = (): string => randomBytes(LONGUEUR_CLE_OCTETS).toString("base64");

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

let sauvegarde: { courante?: string; precedente?: string };

beforeEach(() => {
  sauvegarde = {
    ...(process.env["ENCRYPTION_KEY"] !== undefined ? { courante: process.env["ENCRYPTION_KEY"] } : {}),
    ...(process.env["ENCRYPTION_KEY_PREVIOUS"] !== undefined
      ? { precedente: process.env["ENCRYPTION_KEY_PREVIOUS"] }
      : {}),
  };
  process.env["ENCRYPTION_KEY"] = nouvelleCle();
  delete process.env["ENCRYPTION_KEY_PREVIOUS"];
});

afterEach(() => {
  if (sauvegarde.courante !== undefined) process.env["ENCRYPTION_KEY"] = sauvegarde.courante;
  else delete process.env["ENCRYPTION_KEY"];
  if (sauvegarde.precedente !== undefined) process.env["ENCRYPTION_KEY_PREVIOUS"] = sauvegarde.precedente;
  else delete process.env["ENCRYPTION_KEY_PREVIOUS"];
});

// ── Aller-retour ─────────────────────────────────────────────────────────────

describe("aller-retour", () => {
  const identite = { scope: TENANT_A, cle: "envoi.smtp_password" };

  test("une valeur simple revient identique", () => {
    const { valeur } = chiffrer("mot-de-passe", identite);
    expect(dechiffrer(valeur, identite)).toBe("mot-de-passe");
  });

  test("du texte accentué revient identique, octet pour octet", () => {
    // Un mot de passe d'artisan français en contient. Un encodage traité en
    // latin-1 quelque part rendrait « Ã© » au lieu de « é », et l'authentification
    // SMTP échouerait sans que personne ne comprenne pourquoi.
    const clair = "Élève-à-Noël_çàü#2026€";
    const { valeur } = chiffrer(clair, identite);
    expect(dechiffrer(valeur, identite)).toBe(clair);
  });

  test("2 000 caractères reviennent identiques", () => {
    const clair = "aé€".repeat(700).slice(0, 2000);
    expect(clair).toHaveLength(2000);
    const { valeur } = chiffrer(clair, identite);
    expect(dechiffrer(valeur, identite)).toBe(clair);
  });

  test("le format stocké est bien « v1:<version>:<iv>:<tag>:<chiffre> »", () => {
    // Sentinelle assez longue pour qu'une apparition fortuite dans du base64
    // soit impossible — chercher « x » aurait été un test qui échoue au hasard.
    const clair = "SENTINELLE-EN-CLAIR-0123456789";
    const { valeur } = chiffrer(clair, identite);
    const parts = valeur.split(":");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toBe("1");
    expect(lireEnTete(valeur)).toEqual({ format: "v1", versionCle: 1 });
    // Et surtout : le clair n'y figure nulle part.
    expect(valeur).not.toContain(clair);
    expect(Buffer.from(parts[4]!, "base64").toString("utf8")).not.toContain(clair);
  });
});

// ── IV aléatoire ─────────────────────────────────────────────────────────────

describe("deux chiffrements de la même valeur diffèrent", () => {
  test("l'IV est tiré au sort à chaque appel", () => {
    // Réutiliser un IV en GCM est la faute qui casse tout : elle révèle le XOR
    // des deux clairs et permet de forger des étiquettes valides.
    const identite = { scope: TENANT_A, cle: "envoi.smtp_password" };
    const a = chiffrer("même valeur", identite).valeur;
    const b = chiffrer("même valeur", identite).valeur;
    expect(a).not.toBe(b);
    // Et les deux s'ouvrent quand même.
    expect(dechiffrer(a, identite)).toBe("même valeur");
    expect(dechiffrer(b, identite)).toBe("même valeur");
  });

  test("sur cinquante chiffrements, aucun doublon", () => {
    const identite = { scope: TENANT_A, cle: "c" };
    const vus = new Set(Array.from({ length: 50 }, () => chiffrer("v", identite).valeur));
    expect(vus.size).toBe(50);
  });
});

// ── AAD — le point qui compte ────────────────────────────────────────────────

describe("AAD — un chiffré est lié à SA ligne", () => {
  test("recopié sur la ligne d'un AUTRE TENANT, il ne s'ouvre pas", () => {
    // C'est le scénario réel : quelqu'un qui obtient un accès en écriture à la
    // base recopie le chiffré du tenant A sur la ligne du tenant B pour se
    // servir de ses identifiants. La RLS ne l'arrête pas — le chiffrement, si.
    const { valeur } = chiffrer("secret-de-A", { scope: TENANT_A, cle: "envoi.smtp_password" });
    expect(() =>
      dechiffrer(valeur, { scope: TENANT_B, cle: "envoi.smtp_password" }),
    ).toThrow(DechiffrementError);
  });

  test("recopié sur une AUTRE CLÉ du même tenant, il ne s'ouvre pas", () => {
    const { valeur } = chiffrer("jeton", { scope: TENANT_A, cle: "connecteur.abc.api_key" });
    expect(() =>
      dechiffrer(valeur, { scope: TENANT_A, cle: "envoi.smtp_password" }),
    ).toThrow(DechiffrementError);
  });

  test("le message d'erreur ne porte que le NOM de la clé, jamais le contenu", () => {
    const clair = "SENTINELLE-NE-DOIT-PAS-FUIR";
    const { valeur } = chiffrer(clair, { scope: TENANT_A, cle: "envoi.smtp_password" });
    try {
      dechiffrer(valeur, { scope: TENANT_B, cle: "envoi.smtp_password" });
      throw new Error("le déchiffrement aurait dû échouer");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("envoi.smtp_password");
      expect(message).not.toContain(clair);
      expect(message).not.toContain(valeur);
      expect(message).not.toContain(process.env["ENCRYPTION_KEY"]);
    }
  });
});

// ── Altération ───────────────────────────────────────────────────────────────

describe("altération — jamais un clair silencieusement faux", () => {
  const identite = { scope: TENANT_A, cle: "envoi.smtp_password" };

  /** Modifie un octet dans le segment demandé du chiffré stocké. */
  function alterer(stocke: string, segment: 2 | 3 | 4): string {
    const parts = stocke.split(":");
    const octets = Buffer.from(parts[segment]!, "base64");
    octets[0] = octets[0]! ^ 0xff;
    parts[segment] = octets.toString("base64");
    return parts.join(":");
  }

  test("un octet modifié dans le CHIFFRÉ → échec", () => {
    const { valeur } = chiffrer("mot-de-passe", identite);
    expect(() => dechiffrer(alterer(valeur, 4), identite)).toThrow(DechiffrementError);
  });

  test("un octet modifié dans le TAG → échec", () => {
    const { valeur } = chiffrer("mot-de-passe", identite);
    expect(() => dechiffrer(alterer(valeur, 3), identite)).toThrow(DechiffrementError);
  });

  test("un octet modifié dans l'IV → échec", () => {
    const { valeur } = chiffrer("mot-de-passe", identite);
    expect(() => dechiffrer(alterer(valeur, 2), identite)).toThrow(DechiffrementError);
  });

  test("un format tronqué ou étranger → échec, pas un clair vide", () => {
    for (const faux of ["", "pas-du-tout", "v1:1:a:b", "v2:1:a:b:c", "v1:0:a:b:c"]) {
      expect(() => dechiffrer(faux, identite), `« ${faux} » aurait dû être refusé`).toThrow();
    }
  });
});

// ── Configuration ────────────────────────────────────────────────────────────

describe("configuration — aucun repli, jamais", () => {
  test("sans ENCRYPTION_KEY, chiffrer lève", () => {
    delete process.env["ENCRYPTION_KEY"];
    expect(() => chiffrer("x", { scope: TENANT_A, cle: "c" })).toThrow(ChiffrementConfigError);
  });

  test("sans ENCRYPTION_KEY, déchiffrer lève AUSSI", () => {
    // Le piège serait de rendre `null` et de laisser l'appelant croire qu'il
    // n'y a pas de secret : l'envoi retomberait en repli sans un mot.
    const { valeur } = chiffrer("x", { scope: TENANT_A, cle: "c" });
    delete process.env["ENCRYPTION_KEY"];
    expect(() => dechiffrer(valeur, { scope: TENANT_A, cle: "c" })).toThrow(
      ChiffrementConfigError,
    );
  });

  test.each([
    ["chaîne vide", ""],
    ["espaces", "   "],
    ["trop courte", Buffer.alloc(16).toString("base64")],
    ["trop longue", Buffer.alloc(64).toString("base64")],
    ["pas du base64", "@@@ pas du base64 @@@"],
  ])("clé %s → ChiffrementConfigError", (_label, valeurCle) => {
    process.env["ENCRYPTION_KEY"] = valeurCle;
    expect(() => verifierConfigurationChiffrement()).toThrow(ChiffrementConfigError);
  });

  test("le message d'erreur ne contient pas la clé refusée", () => {
    const cleFautive = Buffer.alloc(16, 7).toString("base64");
    process.env["ENCRYPTION_KEY"] = cleFautive;
    try {
      verifierConfigurationChiffrement();
      throw new Error("aurait dû lever");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("ENCRYPTION_KEY");
      expect(message).not.toContain(cleFautive);
    }
  });

  test("deux clés IDENTIQUES sont refusées au démarrage", () => {
    // Une rotation vers la même clé ne fait rien tout en ayant l'air d'avoir
    // réussi : le script afficherait « 0 tourné, N déjà à jour ».
    const k = nouvelleCle();
    process.env["ENCRYPTION_KEY"] = k;
    process.env["ENCRYPTION_KEY_PREVIOUS"] = k;
    expect(() => verifierConfigurationChiffrement()).toThrow(ChiffrementConfigError);
  });

  test("une configuration saine ne lève pas", () => {
    process.env["ENCRYPTION_KEY"] = nouvelleCle();
    process.env["ENCRYPTION_KEY_PREVIOUS"] = nouvelleCle();
    expect(() => verifierConfigurationChiffrement()).not.toThrow();
  });
});

// ── Rotation ─────────────────────────────────────────────────────────────────

describe("rotation — la clé précédente reste lisible", () => {
  const identite = { scope: TENANT_A, cle: "envoi.smtp_password" };

  test("un secret écrit avec l'ancienne clé se lit après bascule", () => {
    const ancienne = process.env["ENCRYPTION_KEY"]!;
    const { valeur } = chiffrer("mot-de-passe", identite);

    // Bascule : la nouvelle devient courante, l'ancienne devient précédente.
    process.env["ENCRYPTION_KEY"] = nouvelleCle();
    process.env["ENCRYPTION_KEY_PREVIOUS"] = ancienne;

    expect(dechiffrer(valeur, identite)).toBe("mot-de-passe");
    // Mais il n'est PAS à jour : c'est ce qui le fera rechiffrer.
    expect(dejaAJour(valeur, identite)).toBe(false);
  });

  test("rechiffré, il passe en version 2 et devient à jour", () => {
    const ancienne = process.env["ENCRYPTION_KEY"]!;
    const v1 = chiffrer("mot-de-passe", identite).valeur;
    expect(lireEnTete(v1)!.versionCle).toBe(1);

    process.env["ENCRYPTION_KEY"] = nouvelleCle();
    process.env["ENCRYPTION_KEY_PREVIOUS"] = ancienne;

    const v2 = chiffrer(dechiffrer(v1, identite), identite, 2).valeur;
    expect(lireEnTete(v2)!.versionCle).toBe(2);
    expect(dejaAJour(v2, identite)).toBe(true);
    expect(dechiffrer(v2, identite)).toBe("mot-de-passe");
  });

  test("sans clé précédente, un chiffré de l'ancienne génération échoue", () => {
    const { valeur } = chiffrer("mot-de-passe", identite);
    process.env["ENCRYPTION_KEY"] = nouvelleCle();
    delete process.env["ENCRYPTION_KEY_PREVIOUS"];
    expect(() => dechiffrer(valeur, identite)).toThrow(DechiffrementError);
  });
});
