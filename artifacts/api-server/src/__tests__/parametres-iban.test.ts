/**
 * L'IBAN d'encaissement — ticket 4.19, lot A.
 *
 * C'est le compte qui recevra l'argent des liens de paiement. Le point de ces
 * tests : la ROUTE refuse un IBAN invalide, pas l'écran. Une reprise de
 * données, le support, ou la couche vocale écrivent par la même route et ne
 * passent par aucun formulaire — un IBAN faux enregistré là fait échouer tous
 * les liens du tenant, ou désigne un autre compte.
 *
 * Aucun IBAN réel ici : ce sont les jeux d'essai publics de la norme.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import {
  cookieHeader,
  createTestUser,
  createTestMembership,
  createTestSession,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
} from "./helpers";

const IBAN_VALIDE = "FR1420041010050500013M02606";

const tenantIds: string[] = [];
const emails: string[] = [];
let ownerCookie: string;

beforeAll(async () => {
  const email = `iban-owner-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Encaissement SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantIds.push(reg.body.tenantId);
  ownerCookie = reg.headers["set-cookie"][0];
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("a — la route refuse ce qui n'est pas un IBAN", () => {
  test("une clé de contrôle fausse est refusée, avec un message lisible", async () => {
    // Deux chiffres permutés : le défaut de saisie le plus courant, et le seul
    // que ni la longueur ni le format ne voient.
    const r = await request(app)
      .patch("/api/parametres")
      .set("Cookie", ownerCookie)
      .send({ "company.iban": "FR1420041010050500013M02660" })
      .expect(400);

    expect(r.body.error).toMatch(/invalide|contr[ôo]le/i);
    // Le message parle à un artisan, pas à un développeur.
    expect(r.body.error).not.toMatch(/mod ?97|ISO|checksum/i);
  });

  test("une longueur fausse pour le pays est refusée", async () => {
    await request(app)
      .patch("/api/parametres")
      .set("Cookie", ownerCookie)
      .send({ "company.iban": "FR142004101005050001" })
      .expect(400);
  });

  test("un refus n'écrit RIEN — ni l'IBAN fautif, ni les clés qui l'accompagnent", async () => {
    // Le point : la validation passe AVANT la transaction. Un refus qui aurait
    // déjà écrit les autres clés du même PATCH laisserait un enregistrement
    // partiel, sans que l'écran le sache.
    await request(app)
      .patch("/api/parametres")
      .set("Cookie", ownerCookie)
      .send({ "company.iban": "FR0000000000000000000000000", "notif.prospectQualifie": "true" })
      .expect(400);

    const lu = await request(app)
      .get("/api/parametres")
      .set("Cookie", ownerCookie)
      .expect(200);

    expect(lu.body["company.iban"]).toBeUndefined();
    expect(lu.body["notif.prospectQualifie"]).toBe("false");
  });
});

describe("b — ce qu'elle accepte, et sous quelle forme", () => {
  test("un IBAN valide est accepté et rangé NORMALISÉ", async () => {
    // Saisi avec espaces et en minuscules — deux saisies du même compte ne
    // doivent pas produire deux valeurs différentes en base.
    await request(app)
      .patch("/api/parametres")
      .set("Cookie", ownerCookie)
      .send({ "company.iban": "fr14 2004 1010 0505 0001 3m02 606" })
      .expect(200);

    const lu = await request(app)
      .get("/api/parametres")
      .set("Cookie", ownerCookie)
      .expect(200);

    expect(lu.body["company.iban"]).toBe(IBAN_VALIDE);
  });

  test("une chaîne vide efface le réglage sans être validée", async () => {
    // Retirer son IBAN est légitime : on ne peut pas exiger qu'il soit valide
    // pour accepter de l'enlever.
    await request(app)
      .patch("/api/parametres")
      .set("Cookie", ownerCookie)
      .send({ "company.iban": "" })
      .expect(200);
  });
});
