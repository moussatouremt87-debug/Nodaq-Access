/**
 * Garde structurelle — l'écran ne prétend pas avoir envoyé.
 *
 * POURQUOI ELLE EXISTE. Le défaut ne vivait pas seulement sur le serveur.
 * `factures.tsx` écrivait :
 *
 *     description: sendEmail ? 'Envoyée par e-mail.' : undefined
 *
 * `sendEmail` est la case que l'utilisateur a COCHÉE — ce qu'il a demandé,
 * jamais ce qui s'est passé. Sans SMTP configuré, l'artisan lisait « Facture
 * émise / Envoyée par e-mail » alors que rien n'était parti, et croyait avoir
 * facturé son client.
 *
 * Les tests d'API prouvent que le serveur AVOUE désormais l'échec. Ils ne
 * prouvent rien sur ce que l'écran en fait : c'est l'objet de ce fichier.
 *
 * Le fichier source est LU plutôt qu'importé — `factures.tsx` et `devis.tsx`
 * tirent chacun une page entière (react-query, wouter, dialogues) pour un
 * contrôle qui est purement textuel. Même approche que `nav.test.ts`.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const FACTURES = readFileSync(join(__dirname, "factures.tsx"), "utf8");
const DEVIS = readFileSync(join(__dirname, "devis.tsx"), "utf8");

describe("L'écran lit le verdict du serveur, pas la case cochée", () => {
  test("factures.tsx consomme envoiEmail", () => {
    expect(FACTURES).toContain("envoiEmail");
  });

  test("factures.tsx ne déduit plus le sort de l'e-mail de la case cochée", () => {
    // La formulation exacte du défaut. Une garde négative se justifie ici :
    // c'est la ligne qui a menti, et la revoir apparaître serait le retour du
    // même bug, pas une variante.
    expect(FACTURES).not.toMatch(/sendEmail\s*\?\s*['"]Envoyée par e-mail/);
  });

  test("devis.tsx branche sur le succès rendu par le serveur", () => {
    expect(DEVIS).toMatch(/updated\.envoye/);
  });
});
