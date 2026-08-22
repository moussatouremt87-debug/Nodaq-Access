/**
 * Le webhook post-call — ticket 4.18-bis, lot D.
 *
 * Ce que ces tests protègent :
 *   a. RIEN N'ENTRE SANS SIGNATURE — absente, fausse ou périmée : même refus.
 *      Un webhook ouvert accepterait des transcriptions forgées, donc des
 *      audits forgés ;
 *   b. l'AUDIT détecte ce que l'agent n'aurait pas dû dire (ADR 005 : le
 *      versant détectif) et le range sur la ligne de l'appel ;
 *   c. l'issue posée par un tool PENDANT l'appel fait foi — le webhook ne
 *      l'écrase jamais ;
 *   d. le jeton meurt avec l'appel, la durée entre pour le pricing v2 ;
 *   e. un conversation_id inconnu est acquitté sans traitement — un 4xx
 *      entrerait dans le compteur d'échecs de la plateforme et finirait par
 *      couper le webhook entier.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

const SECRET = "secret-webhook-test";
const tenantIds: string[] = [];
const emails: string[] = [];
let proprio: { tenantId: string; campagneId: string };

function signe(corps: object, options: { t?: number; secret?: string } = {}): {
  brut: string;
  entete: string;
} {
  const brut = JSON.stringify(corps);
  const t = options.t ?? Math.floor(Date.now() / 1000);
  const v0 = crypto
    .createHmac("sha256", options.secret ?? SECRET)
    .update(`${t}.${brut}`)
    .digest("hex");
  return { brut, entete: `t=${t},v0=${v0}` };
}

const poster = (corps: object, entete?: string) => {
  const { brut, entete: calcule } = signe(corps);
  return request(serveurTest(app))
    .post("/api/webhooks/agent-vocal")
    .set("Content-Type", "application/json")
    .set("ElevenLabs-Signature", entete ?? calcule)
    .send(brut);
};

async function appelAvecConversation(options: { issue?: string } = {}): Promise<{
  appelId: string;
  conversationId: string;
  jetonSha: string;
}> {
  const conversationId = `conv-${crypto.randomUUID()}`;
  const appelId = crypto.randomUUID();
  const jetonSha = crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex");
  await adminPool.query(
    `INSERT INTO appels_relance (id, tenant_id, campagne_id, facture_id, empreinte_numero, statut, jeton_sha256, conversation_id, issue)
     VALUES ($1, $2::uuid, $3, 'F-WH', $4, 'EN_COURS', $5, $6, $7)`,
    [appelId, proprio.tenantId, proprio.campagneId, `emp-${appelId}`, jetonSha, conversationId, options.issue ?? null],
  );
  return { appelId, conversationId, jetonSha };
}

function evenement(conversationId: string, tours: { role: string; message: string }[]) {
  return {
    type: "post_call_transcription",
    data: {
      conversation_id: conversationId,
      transcript: tours,
      metadata: { call_duration_secs: 95, cost: 12.5 },
    },
  };
}

beforeAll(async () => {
  process.env["ELEVENLABS_WEBHOOK_SECRET"] = SECRET;
  process.env["TELEPHONY_CALLER_ID"] = "+15555550100";
  process.env["VOICE_TEST_NUMBERS"] = "+33600000088";

  const email = `wh-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: "Webhook SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"][0];
  tenantIds.push(reg.body.tenantId);

  const { body } = await request(serveurTest(app))
    .post("/api/relance/campagnes")
    .set("Cookie", cookie)
    .send({
      appels: [
        {
          clientId: null,
          factureId: "F-WH",
          montantCents: 80000,
          numero: "+33600000088",
          clientNom: "Delacroix",
        },
      ],
    })
    .expect(201);
  await request(serveurTest(app))
    .post(`/api/pending-actions/${body.pendingActionId}/approve`)
    .set("Cookie", cookie)
    .expect(200);
  proprio = { tenantId: reg.body.tenantId, campagneId: body.campagne.id };
}, 120_000);

afterAll(async () => {
  delete process.env["ELEVENLABS_WEBHOOK_SECRET"];
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. La signature ─────────────────────────────────────────────────────────

describe("a — rien n'entre sans signature", () => {
  test("signature absente, fausse ou périmée : MÊME refus", async () => {
    const { conversationId } = await appelAvecConversation();
    const corps = evenement(conversationId, []);

    const sans = await request(serveurTest(app))
      .post("/api/webhooks/agent-vocal")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(corps));
    expect(sans.status).toBe(401);

    const fausse = await poster(corps, "t=1,v0=deadbeef");
    expect(fausse.status).toBe(401);

    // Périmée : signée correctement, mais il y a une heure — au-delà des 30
    // minutes de tolérance de la plateforme.
    const vieille = signe(corps, { t: Math.floor(Date.now() / 1000) - 3600 });
    const perimee = await request(serveurTest(app))
      .post("/api/webhooks/agent-vocal")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", vieille.entete)
      .send(vieille.brut);
    expect(perimee.status).toBe(401);

    // Un seul et même corps de refus : la différence n'instruirait qu'un
    // attaquant.
    expect(sans.body).toEqual(fausse.body);
    expect(fausse.body).toEqual(perimee.body);
  });

  test("un corps modifié après signature est refusé", async () => {
    const { conversationId } = await appelAvecConversation();
    const { entete } = signe(evenement(conversationId, []));
    const autre = JSON.stringify(evenement(conversationId, [{ role: "agent", message: "forgé" }]));
    const r = await request(serveurTest(app))
      .post("/api/webhooks/agent-vocal")
      .set("Content-Type", "application/json")
      .set("ElevenLabs-Signature", entete)
      .send(autre);
    expect(r.status).toBe(401);
  });

  test("sans secret configuré : 503, tout est refusé", async () => {
    const garde = process.env["ELEVENLABS_WEBHOOK_SECRET"];
    delete process.env["ELEVENLABS_WEBHOOK_SECRET"];
    try {
      const { conversationId } = await appelAvecConversation();
      await poster(evenement(conversationId, [])).expect(503);
    } finally {
      process.env["ELEVENLABS_WEBHOOK_SECRET"] = garde;
    }
  });
});

// ── b. L'audit du transcript ────────────────────────────────────────────────

describe("b — le versant détectif de l'ADR 005", () => {
  test("un transcript propre : audit posé, zéro anomalie", async () => {
    const { appelId, conversationId } = await appelAvecConversation();
    await poster(
      evenement(conversationId, [
        { role: "agent", message: "Bonjour ! Je suis l'assistant automatique de Webhook SARL." },
        { role: "user", message: "Je peux pas payer là." },
        { role: "agent", message: "D'accord, je note. Vous pouvez régler quand ?" },
      ]),
    ).expect(200);

    const { rows } = await adminPool.query(
      `SELECT audit_transcript, transcription FROM appels_relance WHERE id = $1`,
      [appelId],
    );
    expect(rows[0].audit_transcript.anomalies).toEqual([]);
    expect(rows[0].transcription).toContain("client : Je peux pas payer là.");
  });

  test("une menace prononcée est DÉTECTÉE et rangée sur l'appel", async () => {
    const { appelId, conversationId } = await appelAvecConversation();
    await poster(
      evenement(conversationId, [
        { role: "agent", message: "Sans règlement, on passe au contentieux et à l'huissier." },
      ]),
    ).expect(200);

    const { rows } = await adminPool.query(
      `SELECT audit_transcript FROM appels_relance WHERE id = $1`,
      [appelId],
    );
    const natures = rows[0].audit_transcript.anomalies.map((a: { nature: string }) => a.nature);
    expect(natures).toContain("registre_interdit");
  });

  test("le nom du débiteur prononcé est détecté (minimisation)", async () => {
    const { appelId, conversationId } = await appelAvecConversation();
    await poster(
      evenement(conversationId, [
        { role: "agent", message: "Alors monsieur Delacroix, vous réglez quand ?" },
      ]),
    ).expect(200);

    const { rows } = await adminPool.query(
      `SELECT audit_transcript FROM appels_relance WHERE id = $1`,
      [appelId],
    );
    const natures = rows[0].audit_transcript.anomalies.map((a: { nature: string }) => a.nature);
    expect(natures).toContain("identite_divulguee");
  });

  test("ce que dit le CLIENT n'est jamais audité", async () => {
    // Le débiteur a le droit de dire « huissier » — c'est l'agent qui n'a pas
    // le droit de le menacer.
    const { appelId, conversationId } = await appelAvecConversation();
    await poster(
      evenement(conversationId, [
        { role: "user", message: "Vous allez m'envoyer un huissier c'est ça ?" },
        { role: "agent", message: "Pas du tout. On cherche juste une date qui vous va." },
      ]),
    ).expect(200);

    const { rows } = await adminPool.query(
      `SELECT audit_transcript FROM appels_relance WHERE id = $1`,
      [appelId],
    );
    expect(rows[0].audit_transcript.anomalies).toEqual([]);
  });
});

// ── c. L'issue des tools fait foi ───────────────────────────────────────────

describe("c — le webhook n'écrase jamais ce qu'un tool a décidé", () => {
  test("issue posée pendant l'appel → conservée", async () => {
    const { appelId, conversationId } = await appelAvecConversation({ issue: "promise" });
    await poster(evenement(conversationId, [])).expect(200);
    const { rows } = await adminPool.query(`SELECT issue FROM appels_relance WHERE id = $1`, [appelId]);
    expect(rows[0].issue).toBe("promise");
  });

  test("aucune issue → unreachable, honnêtement", async () => {
    const { appelId, conversationId } = await appelAvecConversation();
    await poster(evenement(conversationId, [])).expect(200);
    const { rows } = await adminPool.query(`SELECT issue FROM appels_relance WHERE id = $1`, [appelId]);
    expect(rows[0].issue).toBe("unreachable");
  });
});

// ── d. Clôture : jeton mort, durée entrée ───────────────────────────────────

describe("d — la clôture", () => {
  test("statut TERMINE, jeton effacé, durée et coût écrits", async () => {
    const { appelId, conversationId } = await appelAvecConversation();
    await poster(evenement(conversationId, [])).expect(200);

    const { rows } = await adminPool.query(
      `SELECT statut, jeton_sha256, duree_secondes, cout_millicents FROM appels_relance WHERE id = $1`,
      [appelId],
    );
    expect(rows[0].statut).toBe("TERMINE");
    expect(rows[0].jeton_sha256).toBeNull();
    expect(rows[0].duree_secondes).toBe(95);
    // 12.5 unités plateforme × 1000 — l'unité est la LEUR, la conversion en
    // euros appartient au pricing v2.
    expect(rows[0].cout_millicents).toBe(12500);
  });
});

// ── e. L'inconnu est acquitté, jamais 4xx ───────────────────────────────────

describe("e — un conversation_id inconnu n'empoisonne pas le webhook", () => {
  test("acquitté sans traitement", async () => {
    const r = await poster(evenement("conv-inconnue-xyz", [])).expect(200);
    expect(r.body.traite).toBe(false);
  });

  test("un événement audio est acquitté et JETÉ — le produit ne garde pas l'audio", async () => {
    const { appelId, conversationId } = await appelAvecConversation();
    const r = await poster({
      type: "post_call_audio",
      data: { conversation_id: conversationId, full_audio: "bW9jaw==" },
    }).expect(200);
    expect(r.body.traite).toBe(false);

    const { rows } = await adminPool.query(
      `SELECT statut FROM appels_relance WHERE id = $1`,
      [appelId],
    );
    expect(rows[0].statut).toBe("EN_COURS");
  });
});
