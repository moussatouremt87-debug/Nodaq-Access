/**
 * Le second facteur par code courriel — ce qui rend six chiffres suffisants.
 *
 * Un million de combinaisons se force en quelques minutes si on laisse
 * essayer. La sécurité ne vient pas de la longueur du code mais de la
 * CONJONCTION de trois plafonds : durée de vie, nombre d'essais, usage unique.
 * Chacun est éprouvé ici séparément — un seul qui saute, et le code devient
 * devinable.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { adminPool, cleanupUsers, createTestUser } from "./helpers";
import {
  genererCode, poserCode, verifierCode,
  MAX_TENTATIVES, MAX_CODES_PAR_HEURE, DUREE_CODE_MINUTES,
} from "../lib/code-connexion";
import {
  poserAppareil, appareilReconnu, libelleAppareil, DUREE_CONFIANCE_JOURS,
} from "../lib/appareil-confiance";

let userId: string;
let autreUserId: string;
const emails: string[] = [];

beforeAll(async () => {
  const u = await createTestUser("code-connexion");
  const v = await createTestUser("code-connexion-autre");
  userId = u.id; autreUserId = v.id;
  emails.push(u.email, v.email);
}, 120_000);

beforeEach(async () => {
  for (const id of [userId, autreUserId]) {
    await adminPool.query("DELETE FROM codes_connexion WHERE user_id = $1::uuid", [id]);
    await adminPool.query("DELETE FROM appareils_confiance WHERE user_id = $1::uuid", [id]);
  }
});

afterAll(async () => {
  for (const id of [userId, autreUserId]) {
    await adminPool.query("DELETE FROM codes_connexion WHERE user_id = $1::uuid", [id]);
    await adminPool.query("DELETE FROM appareils_confiance WHERE user_id = $1::uuid", [id]);
  }
  await cleanupUsers(...emails);
}, 30_000);

async function codeNeuf(): Promise<string> {
  const r = await poserCode(userId);
  if (r.kind !== "ok") throw new Error(`émission refusée : ${r.kind}`);
  return r.code;
}

describe("le code lui-même", () => {
  test("six chiffres, zéros de tête compris", () => {
    for (let i = 0; i < 200; i++) expect(genererCode()).toMatch(/^\d{6}$/);
  });

  test("il n'est JAMAIS stocké en clair", async () => {
    const code = await codeNeuf();
    const { rows } = await adminPool.query(
      "SELECT code_sha256 FROM codes_connexion WHERE user_id = $1::uuid", [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].code_sha256).not.toContain(code);
    expect(rows[0].code_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("usage unique", () => {
  test("le bon code passe une fois, et une seule", async () => {
    const code = await codeNeuf();
    expect((await verifierCode(userId, code)).kind).toBe("ok");
    // Rejoué, il ne vaut plus rien : sans cela, un code lu par-dessus l'épaule
    // resterait utilisable tant qu'il n'a pas expiré.
    expect((await verifierCode(userId, code)).kind).toBe("aucun_code");
  });

  test("demander un code neuf tue le précédent", async () => {
    const ancien = await codeNeuf();
    await codeNeuf();
    // Sinon deux codes vivraient en même temps et doubleraient les essais.
    expect((await verifierCode(userId, ancien)).kind).not.toBe("ok");
  });
});

describe("plafond d'essais", () => {
  test("un mauvais code décompte, et le dit", async () => {
    await codeNeuf();
    const r = await verifierCode(userId, "000000");
    expect(r.kind).toBe("incorrect");
    if (r.kind === "incorrect") expect(r.essaisRestants).toBe(MAX_TENTATIVES - 1);
  });

  test("au-delà du plafond, le code est MORT — même le bon", async () => {
    const code = await codeNeuf();
    for (let i = 0; i < MAX_TENTATIVES; i++) {
      await verifierCode(userId, i === 0 ? "111111" : String(i).repeat(6));
    }
    // LA garde. Sans elle, 10^6 essais suffisent à entrer.
    expect((await verifierCode(userId, code)).kind).toBe("trop_d_essais");
  });
});

describe("durée de vie", () => {
  test("un code expiré est refusé, même s'il est le bon", async () => {
    const code = await codeNeuf();
    await adminPool.query(
      "UPDATE codes_connexion SET expires_at = now() - interval '1 minute' WHERE user_id = $1::uuid",
      [userId]);
    expect((await verifierCode(userId, code)).kind).toBe("expire");
  });

  test("la durée posée est bien celle annoncée", async () => {
    const r = await poserCode(userId);
    if (r.kind !== "ok") throw new Error("émission refusée");
    const minutes = (r.expireLe.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(DUREE_CODE_MINUTES - 1);
    expect(minutes).toBeLessThanOrEqual(DUREE_CODE_MINUTES);
  });
});

describe("plafond d'émission", () => {
  test("on cesse d'envoyer au-delà du seuil horaire", async () => {
    for (let i = 0; i < MAX_CODES_PAR_HEURE; i++) {
      expect((await poserCode(userId)).kind).toBe("ok");
    }
    // Protège la boîte de l'utilisateur autant que la facture d'envoi.
    expect((await poserCode(userId)).kind).toBe("trop_de_demandes");
  });
});

describe("l'appareil de confiance", () => {
  test("reconnu après avoir été posé", async () => {
    const jeton = await poserAppareil(userId, "Mozilla/5.0 (Macintosh) Chrome/120");
    expect(await appareilReconnu(userId, jeton)).toBe(true);
  });

  /*
   * LA garde du jeton. Sans le lien à l'utilisateur, un jeton volé ouvrirait
   * le compte du voleur — et rien ne rapprocherait les deux.
   */
  test("le jeton d'un autre ne vaut rien", async () => {
    const jeton = await poserAppareil(userId);
    expect(await appareilReconnu(autreUserId, jeton)).toBe(false);
  });

  test("un jeton inventé ne vaut rien", async () => {
    await poserAppareil(userId);
    expect(await appareilReconnu(userId, "a".repeat(64))).toBe(false);
    expect(await appareilReconnu(userId, undefined)).toBe(false);
  });

  test("un appareil révoqué cesse d'être reconnu", async () => {
    const jeton = await poserAppareil(userId);
    await adminPool.query(
      "UPDATE appareils_confiance SET revoked_at = now() WHERE user_id = $1::uuid", [userId]);
    expect(await appareilReconnu(userId, jeton)).toBe(false);
  });

  test("un appareil périmé cesse d'être reconnu", async () => {
    const jeton = await poserAppareil(userId);
    await adminPool.query(
      "UPDATE appareils_confiance SET expires_at = now() - interval '1 day' WHERE user_id = $1::uuid",
      [userId]);
    expect(await appareilReconnu(userId, jeton)).toBe(false);
  });

  test("le jeton n'est jamais stocké en clair", async () => {
    const jeton = await poserAppareil(userId);
    const { rows } = await adminPool.query(
      "SELECT jeton_sha256 FROM appareils_confiance WHERE user_id = $1::uuid", [userId]);
    expect(rows[0].jeton_sha256).not.toContain(jeton);
    expect(rows[0].jeton_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("la durée posée est de 90 jours", async () => {
    await poserAppareil(userId);
    const { rows } = await adminPool.query(
      "SELECT expires_at FROM appareils_confiance WHERE user_id = $1::uuid", [userId]);
    const jours = (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(jours)).toBe(DUREE_CONFIANCE_JOURS);
  });

  test("le libellé reste grossier — reconnaître, jamais pister", () => {
    expect(libelleAppareil("Mozilla/5.0 (Macintosh) Chrome/120")).toBe("Chrome sur Mac");
    expect(libelleAppareil("Mozilla/5.0 (iPhone) Safari/604")).toBe("Safari sur iPhone");
    expect(libelleAppareil(undefined)).toBe("Navigateur sur appareil inconnu");
  });
});
