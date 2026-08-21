/**
 * L'émission d'un lien de paiement — ticket 4.19, lot B.
 *
 * Ce lot met en mouvement de l'ARGENT et envoie un écrit à un tiers. Les
 * tests portent donc moins sur le chemin heureux que sur ce qui ne doit
 * JAMAIS arriver :
 *
 *   a. aucun lien hors du mandat figé de la campagne (US-9) ;
 *   b. le montant vient de la base — promesse enregistrée d'abord, facture
 *      ensuite — et jamais d'un corps de requête ;
 *   c. le SMS part au numéro de la CAMPAGNE, et la liste blanche s'applique
 *      au SMS comme à l'appel ;
 *   d. sans IBAN ou sans raison sociale, rien ne part ;
 *   e. la ligne existe AVANT l'appel à la banque, et un refus la marque en
 *      ÉCHEC plutôt que de la laisser croire émise ;
 *   f. le texte du SMS ne porte aucun registre interdit (US-4).
 *
 * Aucun appel réseau réel : `fetch` est remplacé pour chaque test, et les
 * hôtes Bridge/opérateur sont interceptés. Un test qui joindrait le vrai
 * Bridge créerait de vrais liens de paiement.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { registresInterdits } from "@nodaq/shared";
import { emettreLienPaiement, VALIDITE_LIEN_JOURS } from "../lib/lien-paiement.js";
import { texteSmsLienPaiement } from "../lib/sms.js";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

const NUMERO_TEST = "+33600000042";
const AUTRE_NUMERO = "+33600000099";
const IBAN = "FR1420041010050500013M02606";
const MONTANT_FACTURE = 120000;

const ENV_BRIDGE = {
  BRIDGE_CLIENT_ID: "test-client-id",
  BRIDGE_CLIENT_SECRET: "test-client-secret",
  BRIDGE_WEBHOOK_SECRET: "test-webhook-secret",
} as const;

const tenantIds: string[] = [];
const emails: string[] = [];
let proprio: { cookie: string; tenantId: string };

/** Ce que le faux réseau a vu passer, pour inspection après coup. */
interface Trace {
  bridge: { url: string; corps: Record<string, unknown> }[];
  sms: { url: string; params: URLSearchParams }[];
}

let compteurLien = 0;

function reseauSimule(options: { bridgeRefuse?: boolean } = {}): Trace {
  const trace: Trace = { bridge: [], sms: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof input === "string" ? input : (input as URL).href ?? input);

      if (url.includes("bridgeapi.io")) {
        trace.bridge.push({ url, corps: JSON.parse(String(init?.body ?? "{}")) });
        if (options.bridgeRefuse) {
          return new Response(JSON.stringify({ errors: [{ code: "not_authorized" }] }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }
        // Un identifiant DISTINCT par lien, comme le vrai Bridge, et le
        // compteur est GLOBAL au fichier — pas propre à une trace : la
        // première version rendait toujours le même identifiant, et l'index
        // unique de la migration 047 l'a refusé dès le deuxième test. La
        // garde a mordu avant même qu'on pense à l'éprouver.
        const idBridge = `pl-vitest-${++compteurLien}`;
        return new Response(
          JSON.stringify({ id: idBridge, url: `https://pay.bridge.test/${idBridge}` }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("twilio.com")) {
        trace.sms.push({ url, params: new URLSearchParams(String(init?.body ?? "")) });
        return new Response(JSON.stringify({ sid: "SM-vitest-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`hôte non simulé dans ce test : ${url}`);
    }),
  );
  return trace;
}

/**
 * Une campagne validée et un appel en cours. `lienPaiementAutorise` pilote le
 * mandat figé — c'est la garde que le lot doit respecter.
 */
async function appelEnCours(options: {
  lienAutorise: boolean;
  numero?: string;
  promesseMontantCents?: number;
}): Promise<string> {
  await request(app)
    .put("/api/relance/regles")
    .set("Cookie", proprio.cookie)
    .send({
      echelonnementAutorise: true,
      maxVersements: 3,
      delaiMaxPremierVersementJours: 10,
      retardMaxJours: 30,
      lienPaiementAutorise: options.lienAutorise,
      remiseAutorisee: false,
    })
    .expect(200);

  const { body } = await request(app)
    .post("/api/relance/campagnes")
    .set("Cookie", proprio.cookie)
    .send({
      appels: [
        {
          clientId: null,
          factureId: "F-LIEN",
          montantCents: MONTANT_FACTURE,
          numero: options.numero ?? NUMERO_TEST,
          clientNom: "Menuiserie Essai",
        },
      ],
      mandat: { lienPaiementAutorise: options.lienAutorise },
    })
    .expect(201);

  await request(app)
    .post(`/api/pending-actions/${body.pendingActionId}/approve`)
    .set("Cookie", proprio.cookie)
    .expect(200);

  const appelId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO appels_relance
       (id, tenant_id, campagne_id, facture_id, empreinte_numero, statut, promesse_montant_cents)
     VALUES ($1, $2::uuid, $3, 'F-LIEN', $4, 'EN_COURS', $5)`,
    [appelId, proprio.tenantId, body.campagne.id, `emp-${appelId}`, options.promesseMontantCents ?? null],
  );
  return appelId;
}

beforeAll(async () => {
  // Le test POSE ses variables plutôt que d'hériter du shell : la CI n'a pas
  // de `.env`, et sans appelant posé la liste blanche se désarme.
  process.env["TELEPHONY_CALLER_ID"] = "+15555550100";
  process.env["VOICE_TEST_NUMBERS"] = NUMERO_TEST;
  process.env["TELEPHONY_ACCOUNT_SID"] = "AC-test";
  process.env["TELEPHONY_AUTH_TOKEN"] = "token-test";

  const email = `lien-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Lien SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantIds.push(reg.body.tenantId);
  proprio = { cookie: reg.headers["set-cookie"][0], tenantId: reg.body.tenantId };

  await request(app)
    .patch("/api/parametres")
    .set("Cookie", proprio.cookie)
    .send({ "company.raison_sociale": "Charpente Essai", "company.iban": IBAN })
    .expect(200);
}, 120_000);

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV_BRIDGE)) process.env[k] = v;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. Le mandat figé commande ─────────────────────────────────────────────

describe("a — aucun lien hors du mandat de la campagne", () => {
  test("mandat fermé → refus, et la banque n'est JAMAIS appelée", async () => {
    const trace = reseauSimule();
    const appelId = await appelEnCours({ lienAutorise: false });

    const r = await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });

    expect(r.kind).toBe("hors_mandat");
    // Le point : on ne crée pas un lien qu'on refuserait d'envoyer ensuite.
    expect(trace.bridge).toHaveLength(0);
    expect(trace.sms).toHaveLength(0);
  });

  test("mandat ouvert → le lien part", async () => {
    const trace = reseauSimule();
    const appelId = await appelEnCours({ lienAutorise: true });

    const r = await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });

    expect(r.kind).toBe("envoye");
    expect(trace.bridge).toHaveLength(1);
    expect(trace.sms).toHaveLength(1);
  });
});

// ── b. Le montant vient de la base ─────────────────────────────────────────

describe("b — le montant n'est jamais dicté", () => {
  test("sans promesse, c'est le montant de la facture — converti en euros pour la banque", async () => {
    const trace = reseauSimule();
    const appelId = await appelEnCours({ lienAutorise: true });

    const r = await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });

    expect(r).toMatchObject({ kind: "envoye", montantCents: MONTANT_FACTURE });
    // 120000 centimes = 1200 € : la conversion se fait une seule fois, dans le
    // client. Un facteur 100 perdu ici enverrait un lien à 120 000 €.
    const corps = trace.bridge[0]!.corps as { transactions: { amount: number }[] };
    expect(corps.transactions[0]!.amount).toBe(1200);
  });

  test("avec une promesse enregistrée, c'est ELLE qui prime", async () => {
    // La personne s'est engagée sur 400 € : lui envoyer un lien de 1200 €
    // serait un désaveu de ce qu'elle vient d'accepter au téléphone.
    const trace = reseauSimule();
    const appelId = await appelEnCours({ lienAutorise: true, promesseMontantCents: 40000 });

    const r = await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });

    expect(r).toMatchObject({ kind: "envoye", montantCents: 40000 });
    const corps = trace.bridge[0]!.corps as { transactions: { amount: number }[] };
    expect(corps.transactions[0]!.amount).toBe(400);
  });
});

// ── c. Le destinataire, et la liste blanche ────────────────────────────────

describe("c — le SMS part au numéro de la campagne, à aucun autre", () => {
  test("le destinataire est celui de l'entrée de campagne", async () => {
    const trace = reseauSimule();
    const appelId = await appelEnCours({ lienAutorise: true });

    await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });

    expect(trace.sms[0]!.params.get("To")).toBe(NUMERO_TEST);
    expect(trace.sms[0]!.params.get("From")).toBe("+15555550100");
  });

  test("un numéro hors liste blanche bloque tout — appel comme SMS", async () => {
    const trace = reseauSimule();
    const appelId = await appelEnCours({ lienAutorise: true, numero: AUTRE_NUMERO });

    const r = await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });

    expect(r.kind).toBe("numero_refuse");
    expect(trace.bridge).toHaveLength(0);
    expect(trace.sms).toHaveLength(0);
  });

  test("liste blanche VIDE = personne n'est joignable", async () => {
    const sauvegarde = process.env["VOICE_TEST_NUMBERS"];
    process.env["VOICE_TEST_NUMBERS"] = "";
    try {
      const trace = reseauSimule();
      const appelId = await appelEnCours({ lienAutorise: true });
      const r = await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });
      expect(r.kind).toBe("numero_refuse");
      expect(trace.sms).toHaveLength(0);
    } finally {
      process.env["VOICE_TEST_NUMBERS"] = sauvegarde;
    }
  });
});

// ── d. Sans compte bénéficiaire, rien ne part ──────────────────────────────

describe("d — pas d'IBAN, pas de lien", () => {
  test("IBAN absent → refus, sans toucher la banque", async () => {
    await request(app)
      .patch("/api/parametres")
      .set("Cookie", proprio.cookie)
      .send({ "company.iban": "" })
      .expect(200);
    try {
      const trace = reseauSimule();
      const appelId = await appelEnCours({ lienAutorise: true });
      const r = await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });
      expect(r.kind).toBe("sans_iban");
      expect(trace.bridge).toHaveLength(0);
    } finally {
      await request(app)
        .patch("/api/parametres")
        .set("Cookie", proprio.cookie)
        .send({ "company.iban": IBAN })
        .expect(200);
    }
  });

  test("l'IBAN envoyé à la banque est celui du tenant, en bénéficiaire", async () => {
    const trace = reseauSimule();
    const appelId = await appelEnCours({ lienAutorise: true });

    await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });

    const corps = trace.bridge[0]!.corps as {
      transactions: { beneficiary: { iban: string } }[];
      expired_date: string;
    };
    expect(corps.transactions[0]!.beneficiary.iban).toBe(IBAN);
    // L'expiration est bornée : un lien de relance qui traîne perd son sens.
    const jours = (new Date(corps.expired_date).getTime() - Date.now()) / 86_400_000;
    expect(jours).toBeGreaterThan(VALIDITE_LIEN_JOURS - 1);
    expect(jours).toBeLessThan(VALIDITE_LIEN_JOURS + 1);
  });
});

// ── e. L'ordre des écritures, et l'échec ───────────────────────────────────

describe("e — la ligne existe avant la banque, et un refus se voit", () => {
  test("la référence envoyée à la banque est l'identifiant de NOTRE ligne", async () => {
    // C'est elle qui reviendra dans le webhook : sans elle, un paiement
    // arriverait sans qu'on sache quelle ligne il solde.
    const trace = reseauSimule();
    const appelId = await appelEnCours({ lienAutorise: true });

    const r = await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });
    if (r.kind !== "envoye") throw new Error(`attendu envoye, reçu ${r.kind}`);

    const corps = trace.bridge[0]!.corps as { client_reference: string };
    expect(corps.client_reference).toBe(r.lienId);

    const { rows } = await adminPool.query(
      `SELECT statut, montant_cents, bridge_link_id, url FROM liens_paiement WHERE id = $1`,
      [r.lienId],
    );
    expect(rows[0].statut).toBe("EMIS");
    expect(rows[0].bridge_link_id).toMatch(/^pl-vitest-/);
  });

  test("banque qui refuse → ligne en ÉCHEC, aucun SMS, aucune exception", async () => {
    const trace = reseauSimule({ bridgeRefuse: true });
    const appelId = await appelEnCours({ lienAutorise: true });

    const r = await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });

    expect(r.kind).toBe("refuse_banque");
    // Le point : on n'annonce pas un envoi qui n'a pas eu lieu.
    expect(trace.sms).toHaveLength(0);
    const { rows } = await adminPool.query(
      `SELECT statut FROM liens_paiement WHERE appel_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [appelId],
    );
    expect(rows[0].statut).toBe("ECHEC");
  });
});

// ── f. Ce que le SMS dit ───────────────────────────────────────────────────

describe("f — le texte du SMS est produit par le serveur, et il est propre", () => {
  test("aucun registre interdit — les mêmes interdits que la voix (US-4)", () => {
    const texte = texteSmsLienPaiement("Charpente Essai", "1 200,00 €", "https://pay.bridge.test/x");
    expect(registresInterdits(texte)).toEqual([]);
  });

  test("il nomme l'entreprise : un lien de paiement anonyme ressemble à une arnaque", async () => {
    const trace = reseauSimule();
    const appelId = await appelEnCours({ lienAutorise: true });

    await emettreLienPaiement({ tenantId: proprio.tenantId, appelId });

    const corps = trace.sms[0]!.params.get("Body") ?? "";
    expect(corps).toContain("Charpente Essai");
    expect(corps).toContain("https://pay.bridge.test/");
  });
});
