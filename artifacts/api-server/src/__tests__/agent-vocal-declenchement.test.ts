/**
 * Le déclenchement d'appel via la plateforme — ticket 4.18-bis, lot C.
 *
 * Ce que ces tests protègent :
 *   a. SANS configuration, on planifie SANS composer, et la réponse le dit —
 *      c'est ce qui permet à la CI de tourner sans clé, et à un déploiement
 *      sans agent vocal de ne rien casser en silence ;
 *   b. AVEC configuration (faux hôte), le jeton et l'annonce partent en
 *      variables dynamiques, et le conversation_id revient en base — c'est lui
 *      que le webhook post-call utilisera ;
 *   c. sans raison sociale, on REFUSE de composer : l'agent dirait
 *      « l'assistant automatique de Entreprise », qui sonne comme une arnaque.
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
  activerModuleVocal,
  serveurTest,
} from "./helpers";
import { FAKE_ELEVENLABS_BASE } from "./vitest.setup";

const tenantIds: string[] = [];
const emails: string[] = [];
const NUMERO_TEST = "+33600000077";

async function tenantAvecCampagne(options: { raisonSociale?: string } = {}): Promise<{
  cookie: string;
  tenantId: string;
  campagneId: string;
}> {
  const email = `decl-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: "Déclenchement SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  // La Relance vocale est un supplément payant : un tenant qui compose
  // des appels l'a souscrit. L'essai le donnait autrefois d'office.
  await activerModuleVocal(reg.body.tenantId);
  const cookie = reg.headers["set-cookie"][0];
  tenantIds.push(reg.body.tenantId);

  if (options.raisonSociale) {
    await request(serveurTest(app))
      .patch("/api/parametres")
      .set("Cookie", cookie)
      .send({ "company.raison_sociale": options.raisonSociale })
      .expect(200);
  }

  const { body } = await request(serveurTest(app))
    .post("/api/relance/campagnes")
    .set("Cookie", cookie)
    .send({
      appels: [
        {
          clientId: null,
          factureId: "F-DECL",
          montantCents: 50000,
          numero: NUMERO_TEST,
          clientNom: "Essai Déclenchement",
        },
      ],
    })
    .expect(201);
  await request(serveurTest(app))
    .post(`/api/pending-actions/${body.pendingActionId}/approve`)
    .set("Cookie", cookie)
    .expect(200);

  return { cookie, tenantId: reg.body.tenantId, campagneId: body.campagne.id };
}

const planifier = (t: { cookie: string; campagneId: string }) =>
  request(serveurTest(app))
    .post(`/api/relance/campagnes/${t.campagneId}/appels`)
    .set("Cookie", t.cookie)
    .send({ factureId: "F-DECL", numero: NUMERO_TEST });

function sansConfiguration(): void {
  delete process.env["ELEVENLABS_API_KEY"];
  delete process.env["ELEVENLABS_AGENT_ID"];
  delete process.env["ELEVENLABS_PHONE_NUMBER_ID"];
  delete process.env["ELEVENLABS_BASE_URL"];
}

function avecFauxHote(): void {
  process.env["ELEVENLABS_API_KEY"] = "cle-de-test";
  process.env["ELEVENLABS_AGENT_ID"] = "agent-test";
  process.env["ELEVENLABS_PHONE_NUMBER_ID"] = "tel-test";
  process.env["ELEVENLABS_BASE_URL"] = FAKE_ELEVENLABS_BASE;
}

beforeAll(async () => {
  process.env["TELEPHONY_CALLER_ID"] = "+15555550100";
  process.env["VOICE_TEST_NUMBERS"] = NUMERO_TEST;
  // VOICE_TTS_API_KEY sert de REPLI à la clé : héritée du shell, elle rendrait
  // la configuration « présente » à moitié. On part d'un état connu.
  delete process.env["VOICE_TTS_API_KEY"];
}, 30_000);

afterAll(async () => {
  sansConfiguration();
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("a — sans configuration, on planifie sans composer", () => {
  test("l'appel reste PLANIFIE, le motif est dit, le jeton est rendu", async () => {
    sansConfiguration();
    const t = await tenantAvecCampagne({ raisonSociale: "Déclenchement SARL" });

    const r = await planifier(t).expect(201);

    expect(r.body.declenche).toBe(false);
    expect(r.body.motif).toMatch(/non configurée/i);
    expect(r.body.jeton).toBeTruthy();

    const { rows } = await adminPool.query(
      `SELECT statut, conversation_id FROM appels_relance WHERE id = $1`,
      [r.body.appelId],
    );
    expect(rows[0].statut).toBe("PLANIFIE");
    expect(rows[0].conversation_id).toBeNull();
  });
});

describe("b — avec configuration, la plateforme compose et le lien est gardé", () => {
  test("declenche=true et conversation_id écrit en base", async () => {
    avecFauxHote();
    try {
      const t = await tenantAvecCampagne({ raisonSociale: "Déclenchement SARL" });
      const r = await planifier(t).expect(201);

      expect(r.body.declenche).toBe(true);
      expect(r.body.conversationId).toBe("conv-vitest-1");

      // Le webhook post-call ne connaîtra QUE cet identifiant : sans lui, la
      // transcription et le coût n'auraient pas de destinataire.
      const { rows } = await adminPool.query(
        `SELECT conversation_id FROM appels_relance WHERE id = $1`,
        [r.body.appelId],
      );
      expect(rows[0].conversation_id).toBe("conv-vitest-1");
    } finally {
      sansConfiguration();
    }
  });
});

describe("c — sans raison sociale, on refuse de composer", () => {
  test("409, et l'appel n'est pas déclenché", async () => {
    avecFauxHote();
    try {
      const t = await tenantAvecCampagne();
      const r = await planifier(t);

      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(/raison sociale/i);
    } finally {
      sansConfiguration();
    }
  });
});
