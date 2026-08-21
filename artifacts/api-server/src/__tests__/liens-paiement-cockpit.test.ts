/**
 * Les liens de paiement vus du cockpit — ticket 4.19, lot E.
 *
 * Ce lot existe parce qu'un commentaire du lot B promettait déjà que « le
 * dirigeant peut renvoyer le lien depuis le cockpit », sans que rien ne
 * l'affiche. Ce que ces tests protègent :
 *
 *   a. RENVOYER N'EST PAS RÉ-ÉMETTRE — le SMS repart avec l'URL déjà créée ;
 *      un second lien vivant pour la même facture, c'est un double règlement
 *      possible, et c'est le débiteur qui le paierait ;
 *   b. un lien réglé, expiré ou en échec NE SE RENVOIE PAS ;
 *   c. le destinataire vient de la campagne, jamais du corps de la requête ;
 *   d. la liste ne ramène pas l'empreinte du numéro.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

const NUMERO_TEST = "+33600000042";
const MONTANT = 42_800;
const URL_LIEN = "https://pay.bridge.test/pl-existant";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie: string;
let tenantId: string;
let campagneId: string;

interface TraceSms {
  envois: { params: URLSearchParams }[];
}

function smsSimule(options: { echoue?: boolean } = {}): TraceSms {
  const trace: TraceSms = { envois: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : (input as URL).href ?? input);
      if (url.includes("twilio.com")) {
        trace.envois.push({ params: new URLSearchParams(String(init?.body ?? "")) });
        if (options.echoue) return new Response("{}", { status: 400 });
        return new Response(JSON.stringify({ sid: "SM-renvoi" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`hôte non simulé : ${url}`);
    }),
  );
  return trace;
}

/** Un lien dans l'état demandé, rattaché à un appel de la campagne. */
async function lien(statut: string, url: string | null = URL_LIEN): Promise<string> {
  const appelId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO appels_relance (id, tenant_id, campagne_id, facture_id, empreinte_numero, statut)
     VALUES ($1, $2::uuid, $3, 'F-COCKPIT', $4, 'TERMINE')`,
    [appelId, tenantId, campagneId, `emp-${appelId}`],
  );
  const lienId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO liens_paiement
       (id, tenant_id, appel_id, facture_id, empreinte_numero, montant_cents, statut, url)
     VALUES ($1, $2::uuid, $3, 'F-COCKPIT', $4, $5, $6, $7)`,
    [lienId, tenantId, appelId, `emp-secret-${lienId}`, MONTANT, statut, url],
  );
  return lienId;
}

beforeAll(async () => {
  process.env["TELEPHONY_CALLER_ID"] = "+15555550100";
  process.env["VOICE_TEST_NUMBERS"] = NUMERO_TEST;
  process.env["TELEPHONY_ACCOUNT_SID"] = "AC-test";
  process.env["TELEPHONY_AUTH_TOKEN"] = "token-test";

  const email = `lp-cockpit-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Cockpit SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
  cookie = reg.headers["set-cookie"][0];

  await request(app)
    .patch("/api/parametres")
    .set("Cookie", cookie)
    .send({ "company.raison_sociale": "Charpente Cockpit" })
    .expect(200);

  campagneId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO campagnes_relance (id, tenant_id, pending_action_id, mandat, appels)
     VALUES ($1, $2::uuid, 'pa-cockpit', '{}'::jsonb, $3::jsonb)`,
    [
      campagneId,
      tenantId,
      JSON.stringify([{ factureId: "F-COCKPIT", numero: NUMERO_TEST, montantCents: MONTANT }]),
    ],
  );
}, 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. La liste ────────────────────────────────────────────────────────────

describe("a — la liste montre ce qu'il faut, et rien de plus", () => {
  test("les liens du tenant, sans l'empreinte du numéro", async () => {
    const id = await lien("EMIS");
    const r = await request(app)
      .get("/api/relance/liens-paiement")
      .set("Cookie", cookie)
      .expect(200);

    const ligne = r.body.liens.find((l: { id: string }) => l.id === id);
    expect(ligne).toBeTruthy();
    expect(ligne.montantCents).toBe(MONTANT);
    expect(ligne.statut).toBe("EMIS");
    // L'empreinte sert au rapprochement interne et à l'effacement : elle n'a
    // rien à faire dans une réponse lue par un navigateur.
    expect(JSON.stringify(r.body)).not.toMatch(/emp-secret/);
  });
});

// ── b. Le renvoi ───────────────────────────────────────────────────────────

describe("b — renvoyer réexpédie le MÊME lien", () => {
  test("le SMS repart au numéro de la campagne, avec l'URL déjà créée", async () => {
    const trace = smsSimule();
    const id = await lien("EMIS");

    const r = await request(app)
      .post(`/api/relance/liens-paiement/${id}/renvoyer`)
      .set("Cookie", cookie)
      .expect(200);

    expect(r.body.renvoye).toBe(true);
    expect(trace.envois).toHaveLength(1);
    expect(trace.envois[0]!.params.get("To")).toBe(NUMERO_TEST);
    // Le POINT du lot : aucune création chez Bridge — l'URL est celle qui
    // existait. Deux liens vivants pour une facture, c'est un double
    // règlement possible. Le simulateur lèverait si Bridge était appelé.
    expect(trace.envois[0]!.params.get("Body")).toContain(URL_LIEN);
  });

  test("un numéro dicté dans le corps est IGNORÉ", async () => {
    const trace = smsSimule();
    const id = await lien("EMIS");

    await request(app)
      .post(`/api/relance/liens-paiement/${id}/renvoyer`)
      .set("Cookie", cookie)
      .send({ numero: "+33699999999" })
      .expect(200);

    expect(trace.envois[0]!.params.get("To")).toBe(NUMERO_TEST);
  });

  test("l'envoi qui échoue rend 502 — jamais un faux succès", async () => {
    const trace = smsSimule({ echoue: true });
    const id = await lien("EMIS");

    await request(app)
      .post(`/api/relance/liens-paiement/${id}/renvoyer`)
      .set("Cookie", cookie)
      .expect(502);

    expect(trace.envois).toHaveLength(1);
  });
});

// ── c. Ce qui ne se renvoie pas ────────────────────────────────────────────

describe("c — un lien qui n'est plus actif ne se renvoie pas", () => {
  test.each(["PAYE", "EXPIRE", "REVOQUE", "ECHEC"])("statut %s → 409, aucun SMS", async (statut) => {
    const trace = smsSimule();
    const id = await lien(statut);

    const r = await request(app)
      .post(`/api/relance/liens-paiement/${id}/renvoyer`)
      .set("Cookie", cookie)
      .expect(409);

    expect(r.body.error).toMatch(/plus actif/i);
    expect(trace.envois).toHaveLength(0);
  });

  test("un lien sans URL (création refusée) ne se renvoie pas non plus", async () => {
    const trace = smsSimule();
    const id = await lien("EMIS", null);

    await request(app)
      .post(`/api/relance/liens-paiement/${id}/renvoyer`)
      .set("Cookie", cookie)
      .expect(409);

    expect(trace.envois).toHaveLength(0);
  });

  test("lien inconnu → 404", async () => {
    smsSimule();
    await request(app)
      .post(`/api/relance/liens-paiement/${crypto.randomUUID()}/renvoyer`)
      .set("Cookie", cookie)
      .expect(404);
  });
});
