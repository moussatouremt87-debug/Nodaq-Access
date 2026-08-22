/**
 * US-A7.2 — le contenu d'un praticien n'atteint pas le modèle.
 *
 * Le classifieur est déjà testé unitairement (`lib/classifier`). Ce qui se
 * vérifie ICI, et nulle part ailleurs, c'est le CÂBLAGE : que le secteur du
 * tenant remonte bien jusqu'à `classify`, et que le message soit réellement
 * retenu avant l'appel au modèle.
 *
 * La preuve est prise au seul endroit qui ne ment pas : le trafic sortant.
 * Un test qui se contenterait de lire la réponse rendue pourrait passer alors
 * que le message est parti quand même.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];

interface Locataire { cookie: string; tenantId: string }

async function inscrire(nom: string, metier: string): Promise<Locataire> {
  const email = `a72-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantIds.push(reg.body.tenantId);
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'votre-metier.metier', $2)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = $2`,
    [reg.body.tenantId, metier],
  );
  return { cookie: reg.headers["set-cookie"][0], tenantId: reg.body.tenantId };
}

/** Exécute `action` en comptant les appels réellement partis vers le modèle. */
async function compterAppelsModele(action: () => Promise<unknown>): Promise<number> {
  const original = globalThis.fetch;
  let appels = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes("/chat/completions")) appels++;
    return original(input as Parameters<typeof original>[0], init);
  }) as typeof fetch;
  try {
    await action();
  } finally {
    globalThis.fetch = original;
  }
  return appels;
}

let praticien: Locataire;
let macon: Locataire;

beforeAll(async () => {
  praticien = await inscrire("praticien", "sante_liberale");
  macon = await inscrire("macon", "batiment");
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

describe("le secteur du tenant remonte jusqu'au garde-fou", () => {
  const dossier = "M. Martin, lombalgie, arrêt 15 jours, à revoir lundi";

  test("chez un praticien, le message est retenu et n'atteint PAS le modèle", async () => {
    let reponse: request.Response | undefined;
    const appels = await compterAppelsModele(async () => {
      reponse = await request(serveurTest(app))
        .post("/api/chat/messages")
        .set("Cookie", praticien.cookie)
        .send({ content: dossier });
    });

    expect(appels, "aucun appel au modèle ne doit partir").toBe(0);
    expect(reponse!.status).toBe(200);
    // L'utilisateur reçoit une explication, pas une erreur technique — et le
    // motif annoncé est le BON : parler de « coordonnées bancaires » à un
    // praticien dont on retient un élément de dossier décrirait la mauvaise
    // raison.
    expect(reponse!.body.message.content).toMatch(/secret professionnel/i);
    expect(reponse!.body.message.content).not.toMatch(/coordonnées bancaires/i);
  });

  test("le MÊME message chez un maçon part normalement", async () => {
    // Le contraste est la preuve que c'est bien le SECTEUR qui décide, et non
    // une propriété du texte : mot pour mot le même contenu.
    const appels = await compterAppelsModele(async () => {
      await request(serveurTest(app))
        .post("/api/chat/messages")
        .set("Cookie", macon.cookie)
        .send({ content: dossier });
    });
    expect(appels).toBeGreaterThan(0);
  });

  test("un marqueur explicite retient le message même chez le maçon", async () => {
    const appels = await compterAppelsModele(async () => {
      await request(serveurTest(app))
        .post("/api/chat/messages")
        .set("Cookie", macon.cookie)
        .send({ content: "Je te transmets le certificat médical de Paul pour son arrêt" });
    });
    expect(appels, "un marqueur de santé vaut pour tous les secteurs").toBe(0);
  });
});
