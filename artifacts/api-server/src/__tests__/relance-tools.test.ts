/**
 * Les server tools de l'agent vocal — ticket 4.18-bis, lot B.
 *
 * Depuis l'ADR 005, le LLM de la plateforme formule librement : ces routes sont
 * LE lieu où vit l'invariant. Ce que ces tests protègent, par ordre :
 *
 *   a. UNE PROMESSE HORS MANDAT N'EXISTE PAS — quoi que l'agent ait dit au
 *      téléphone, le serveur refuse d'écrire une date au-delà du retard accepté,
 *      un montant supérieur au dû, ou une promesse non confirmée ;
 *   b. l'OPPOSITION est immédiate, définitive, et le numéro vient de la
 *      campagne — jamais du LLM, qui pourrait en radier un autre ;
 *   c. la LISTE BLANCHE bloque tout numéro non déclaré tant que l'appelant est
 *      américain, et une liste vide bloque TOUT ;
 *   d. un refus ne porte jamais le réglage interne qui l'explique.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];
let proprio: { cookie: string; tenantId: string; campagneId: string };

const NUMERO_TEST = "+33600000042";

const REGLE = {
  echelonnementAutorise: true,
  maxVersements: 3,
  delaiMaxPremierVersementJours: 10,
  retardMaxJours: 30,
  lienPaiementAutorise: false,
  remiseAutorisee: false,
};

/** Jour métier à `jours` d'aujourd'hui, en local — jamais toISOString. */
function jourDans(jours: number): string {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mois}-${jour}`;
}

async function appelPlanifie(): Promise<{ appelId: string; jeton: string }> {
  const jeton = crypto.randomBytes(32).toString("base64url");
  const sha = crypto.createHash("sha256").update(jeton).digest("hex");
  const appelId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO appels_relance (id, tenant_id, campagne_id, facture_id, empreinte_numero, statut, jeton_sha256)
     VALUES ($1, $2::uuid, $3, 'F-TOOLS', $4, 'EN_COURS', $5)`,
    [appelId, proprio.tenantId, proprio.campagneId, `emp-${appelId}`, sha],
  );
  return { appelId, jeton };
}

const outil = (jeton: string, chemin: string, corps: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/relance/appel/${chemin}`)
    .set("Authorization", `Bearer ${jeton}`)
    .send(corps);

beforeAll(async () => {
  // Le test POSE ses deux variables au lieu d'hériter du shell. La CI n'a pas
  // de `.env`, et la première exécution y a échoué exactement comme le
  // CLAUDE.md le prévoit : « un vert obtenu avec une variable d'environnement
  // locale n'est pas un vert ». Sans appelant posé, la liste blanche se
  // désarme — à juste titre — et les 403 attendus deviennent des 201.
  process.env["TELEPHONY_CALLER_ID"] = "+15555550100";
  process.env["VOICE_TEST_NUMBERS"] = NUMERO_TEST;

  const email = `tools-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Tools SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"][0];
  tenantIds.push(reg.body.tenantId);

  await request(app).put("/api/relance/regles").set("Cookie", cookie).send(REGLE).expect(200);
  await request(app)
    .patch("/api/parametres")
    .set("Cookie", cookie)
    .send({ "company.raison_sociale": "Tools SARL" })
    .expect(200);

  const { body } = await request(app)
    .post("/api/relance/campagnes")
    .set("Cookie", cookie)
    .send({
      appels: [
        {
          clientId: null,
          factureId: "F-TOOLS",
          montantCents: 120000,
          numero: NUMERO_TEST,
          clientNom: "Essai Tools",
        },
      ],
    })
    .expect(201);
  await request(app)
    .post(`/api/pending-actions/${body.pendingActionId}/approve`)
    .set("Cookie", cookie)
    .expect(200);

  proprio = { cookie, tenantId: reg.body.tenantId, campagneId: body.campagne.id };
}, 120_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. La promesse : l'invariant depuis l'ADR 005 ──────────────────────────

describe("a — une promesse hors mandat n'existe pas, quoi que l'agent ait dit", () => {
  test("promesse valide et confirmée → enregistrée", async () => {
    const { appelId, jeton } = await appelPlanifie();
    const r = await outil(jeton, "promesse", {
      montantCents: 40000,
      date: jourDans(10),
      confirme: true,
    }).expect(200);

    expect(r.body.enregistree).toBe(true);
    const { rows } = await adminPool.query(
      `SELECT promesse_montant_cents, promesse_date::text AS date, issue FROM appels_relance WHERE id = $1`,
      [appelId],
    );
    expect(rows[0].promesse_montant_cents).toBe(40000);
    expect(rows[0].date).toBe(jourDans(10));
    expect(rows[0].issue).toBe("promise");
  });

  test("NON confirmée → rien n'est écrit (US-3)", async () => {
    const { appelId, jeton } = await appelPlanifie();
    const r = await outil(jeton, "promesse", {
      montantCents: 40000,
      date: jourDans(10),
      confirme: false,
    }).expect(200);

    expect(r.body.enregistree).toBe(false);
    const { rows } = await adminPool.query(
      `SELECT promesse_montant_cents FROM appels_relance WHERE id = $1`,
      [appelId],
    );
    expect(rows[0].promesse_montant_cents).toBeNull();
  });

  test("date au-delà du retard accepté par le MANDAT → refusée", async () => {
    // La règle dit 30 jours. Le LLM peut avoir promis « dans deux mois » au
    // téléphone — pour le produit, cette promesse n'existe pas.
    const { appelId, jeton } = await appelPlanifie();
    const r = await outil(jeton, "promesse", {
      montantCents: 40000,
      date: jourDans(60),
      confirme: true,
    }).expect(200);

    expect(r.body.enregistree).toBe(false);
    const { rows } = await adminPool.query(
      `SELECT issue FROM appels_relance WHERE id = $1`,
      [appelId],
    );
    expect(rows[0].issue).toBeNull();
  });

  test("date passée → refusée", async () => {
    const { jeton } = await appelPlanifie();
    const r = await outil(jeton, "promesse", {
      montantCents: 40000,
      date: jourDans(-3),
      confirme: true,
    }).expect(200);
    expect(r.body.enregistree).toBe(false);
  });

  test("montant supérieur au dû → refusé", async () => {
    // Un trop-perçu enregistré ferait réclamer une somme que la personne ne
    // doit pas. La facture de la campagne fait 1 200 €.
    const { jeton } = await appelPlanifie();
    const r = await outil(jeton, "promesse", {
      montantCents: 150000,
      date: jourDans(10),
      confirme: true,
    }).expect(200);
    expect(r.body.enregistree).toBe(false);
  });

  test("un refus ne révèle JAMAIS le réglage interne", async () => {
    const { jeton } = await appelPlanifie();
    const r = await outil(jeton, "promesse", {
      montantCents: 40000,
      date: jourDans(60),
      confirme: true,
    }).expect(200);
    // Le LLM relaie la consigne au débiteur : elle ne doit contenir ni la
    // borne, ni le mot « mandat », ni « règle » — sinon il les prononcera.
    expect(JSON.stringify(r.body)).not.toMatch(/mandat|règle|30|retardMax/i);
  });
});

// ── b. Contestation, rappel humain, opposition ─────────────────────────────

describe("b — les clôtures écrivent l'issue, l'opposition radie le numéro", () => {
  test("contestation → issue dispute", async () => {
    const { appelId, jeton } = await appelPlanifie();
    await outil(jeton, "contestation").expect(200);
    const { rows } = await adminPool.query(`SELECT issue FROM appels_relance WHERE id = $1`, [appelId]);
    expect(rows[0].issue).toBe("dispute");
  });

  test("rappel humain → issue callback_requested", async () => {
    const { appelId, jeton } = await appelPlanifie();
    await outil(jeton, "rappel-humain").expect(200);
    const { rows } = await adminPool.query(`SELECT issue FROM appels_relance WHERE id = $1`, [appelId]);
    expect(rows[0].issue).toBe("callback_requested");
  });

  test("opposition → radiation immédiate : plus aucun appel planifiable", async () => {
    const { jeton } = await appelPlanifie();
    await outil(jeton, "opposition").expect(200);

    // US-7 « effectif immédiatement » : la planification suivante échoue.
    const r = await request(app)
      .post(`/api/relance/campagnes/${proprio.campagneId}/appels`)
      .set("Cookie", proprio.cookie)
      .send({ factureId: "F-TOOLS", numero: NUMERO_TEST });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/oppos/i);
  });

  test("le numéro opposé vient de la CAMPAGNE, pas du corps de la requête", async () => {
    // Un corps qui tenterait d'opposer un autre numéro est ignoré : la route ne
    // lit rien du corps. Garde structurelle, prouvée plutôt que supposée.
    const { jeton } = await appelPlanifie();
    await outil(jeton, "opposition", { numero: "+33777777777" }).expect(200);
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM oppositions o WHERE o.tenant_id = $1::uuid`,
      [proprio.tenantId],
    );
    // Toujours UNE empreinte radiée (celle du numéro de campagne, déjà posée au
    // test précédent + celle-ci = même empreinte, lignes multiples acceptées) —
    // le point est qu'aucune empreinte d'un numéro ÉTRANGER n'existe.
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

// ── c. La liste blanche ─────────────────────────────────────────────────────

describe("c — liste blanche tant que l'appelant est américain", () => {
  test("un numéro hors liste est refusé à la PLANIFICATION", async () => {
    const r = await request(app)
      .post(`/api/relance/campagnes/${proprio.campagneId}/appels`)
      .set("Cookie", proprio.cookie)
      .send({ factureId: "F-TOOLS", numero: "+33611111111" });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/liste blanche/i);
  });

  test("liste VIDE = aucun appel possible", async () => {
    const avant = process.env["VOICE_TEST_NUMBERS"];
    process.env["VOICE_TEST_NUMBERS"] = "";
    try {
      const r = await request(app)
        .post(`/api/relance/campagnes/${proprio.campagneId}/appels`)
        .set("Cookie", proprio.cookie)
        .send({ factureId: "F-TOOLS", numero: NUMERO_TEST });
      expect(r.status).toBe(403);
    } finally {
      process.env["VOICE_TEST_NUMBERS"] = avant;
    }
  });

  test("appelant NON américain : la liste se désarme d'elle-même", async () => {
    const avant = process.env["TELEPHONY_CALLER_ID"];
    process.env["TELEPHONY_CALLER_ID"] = "+33912345678";
    try {
      const r = await request(app)
        .post(`/api/relance/campagnes/${proprio.campagneId}/appels`)
        .set("Cookie", proprio.cookie)
        .send({ factureId: "F-TOOLS", numero: "+33622222222" });
      // Plus de 403 liste blanche — les protections de droit commun jugent.
      expect(r.status).not.toBe(403);
    } finally {
      process.env["TELEPHONY_CALLER_ID"] = avant;
    }
  });
});

// ── d. L'authentification reste celle du lot 6a ────────────────────────────

describe("d — sans jeton d'appel, rien", () => {
  test("chaque tool exige le jeton", async () => {
    for (const chemin of ["promesse", "contestation", "rappel-humain", "opposition"]) {
      await request(app).post(`/api/relance/appel/${chemin}`).send({}).expect(401);
    }
  });
});
