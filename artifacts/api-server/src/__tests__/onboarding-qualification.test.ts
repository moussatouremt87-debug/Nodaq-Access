/**
 * Qualification à l'inscription — ticket 4.36, lot A.
 *
 * L'exigence qui compte : « en cours d'immatriculation » répond OUI à
 * l'inscription. Le fondateur prépare tout — devis en brouillon, réglages — et
 * seule l'ÉMISSION attend le SIREN.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `oq-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `OQ ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

let t: { cookie: string; tenantId: string };
beforeAll(async () => { t = await inscrire("a"); }, 90_000);
afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

const repondre = (c: string, corps: Record<string, unknown>) =>
  request(serveurTest(app)).patch("/api/onboarding/qualification").set("Cookie", c).send(corps);

const lire = (c: string) =>
  request(serveurTest(app)).get("/api/onboarding/qualification").set("Cookie", c);

describe("a — une réponse à la fois, et rien n'est perdu", () => {
  test("abandonner à la quatrième question garde les trois premières", async () => {
    const u = await inscrire("partiel");
    await repondre(u.cookie, { stade: "EN_IMMATRICULATION" }).expect(200);
    await repondre(u.cookie, { effectif: "DE_2_A_3" }).expect(200);
    await repondre(u.cookie, { gestionActuelle: "PAPIER_TABLEUR" }).expect(200);
    // Puis l'utilisateur ferme l'onglet.

    const { body } = await lire(u.cookie).expect(200);
    // Un formulaire qui perd tout à l'abandon ne mesure que les gens qui vont
    // au bout — c'est-à-dire les moins intéressants à comprendre.
    expect(body.profil.stade).toBe("EN_IMMATRICULATION");
    expect(body.profil.effectif).toBe("DE_2_A_3");
    expect(body.profil.gestionActuelle).toBe("PAPIER_TABLEUR");
    expect(body.profil.termineeLe).toBeNull();
  });

  test("une valeur inconnue est refusée", async () => {
    await repondre(t.cookie, { effectif: "BEAUCOUP" }).expect(400);
  });

  test("un champ non prévu est refusé", async () => {
    // `.strict()` : un champ inventé côté client ne doit pas s'écrire en
    // silence dans une table de segmentation.
    await repondre(t.cookie, { chiffreAffaires: 100000 }).expect(400);
  });
});

describe("b — « en cours d'immatriculation » répond OUI", () => {
  test("le compte fonctionne, mais l'émission attend le SIREN", async () => {
    const u = await inscrire("immat");
    await repondre(u.cookie, { stade: "EN_IMMATRICULATION" }).expect(200);

    const { body } = await lire(u.cookie).expect(200);
    expect(body.peutEmettre).toBe(false);
    // Le message dit ce qui est POSSIBLE avant ce qui manque.
    expect(body.messageSiren).toContain("Vous pouvez tout préparer");
  });

  test("un devis en BROUILLON reste possible sans SIREN", async () => {
    const u = await inscrire("brouillon");
    await repondre(u.cookie, { stade: "EN_IMMATRICULATION" }).expect(200);

    // C'est tout l'intérêt : préparer son activité avant de l'immatriculer.
    await request(serveurTest(app))
      .post("/api/devis")
      .set("Cookie", u.cookie)
      .send({ clientName: "Delacroix", lines: [{ description: "Pose", quantity: 1, unitPriceCents: 100000 }], tvaRate: 20 })
      .expect(201);
  });

  test("saisir le SIRET débloque l'émission", async () => {
    const u = await inscrire("siret");
    await repondre(u.cookie, { stade: "EN_IMMATRICULATION" }).expect(200);
    expect((await lire(u.cookie)).body.peutEmettre).toBe(false);

    await request(serveurTest(app))
      .patch("/api/parametres").set("Cookie", u.cookie)
      .send({ "company.siret": "81234567600009" }).expect(200);

    const { body } = await lire(u.cookie).expect(200);
    expect(body.peutEmettre).toBe(true);
    expect(body.messageSiren).toBeNull();
  });
});

describe("c — la fin du parcours propose une action, jamais un écran vide", () => {
  test("l'irritant choisi pilote la première action", async () => {
    const u = await inscrire("action");
    await repondre(u.cookie, { irritant: "IMPAYES", terminee: true }).expect(200);

    const { body } = await lire(u.cookie).expect(200);
    expect(body.premiereAction.chemin).toBe("/factures");
    expect(body.profil.termineeLe).not.toBeNull();
  });

  test("sans réponse, une action est quand même proposée", async () => {
    const u = await inscrire("vide");
    const { body } = await lire(u.cookie).expect(200);
    expect(body.premiereAction.cle).toBe("devis_dicte");
  });
});

describe("d — isolation", () => {
  test("les réponses d'un tenant ne sont pas lues par un autre", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    await repondre(a.cookie, { irritant: "AUTRE", irritantVerbatim: "le client Delacroix ne paie jamais" })
      .expect(200);

    const { body } = await lire(b.cookie).expect(200);
    // Le verbatim peut nommer un client : le voir fuir serait une divulgation.
    expect(body.profil.irritantVerbatim).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Delacroix");
  });
});
