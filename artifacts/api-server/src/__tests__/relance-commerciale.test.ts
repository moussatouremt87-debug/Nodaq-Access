/**
 * Relancer un devis sans réponse — ticket 4.33.
 *
 * « Si je choisis les statuts prospect, devis envoyé, devis accepté, on doit
 * prévoir une relance du client par email et WhatsApp. »
 *
 * La route PROPOSE : chaque devis retenu devient une `pending_action` à
 * valider. Relancer un client engage le nom de l'entreprise — règle 4, sans
 * exception.
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
let cookie = "";
let tenantId = "";

beforeAll(async () => {
  const email = `rc-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Couverture Lemarchand" })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantId = body.tenantId;
  tenantIds.push(tenantId);
  cookie = headers["set-cookie"][0];
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

/** Un devis ENVOYÉ il y a `jours` jours, avec un client joignable ou non. */
async function devisEnvoye(opts: {
  jours: number; telephone?: string | null; validUntil?: string | null; ttc?: number;
}): Promise<string> {
  const clientId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO clients (id, tenant_id, nom, telephone) VALUES ($1, $2::uuid, $3, $4)`,
    [clientId, tenantId, "Delacroix", opts.telephone ?? null],
  );
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO devis (id, tenant_id, reference, client_name, client_id, status,
                        date_envoi, valid_until, total_ttc_cents)
     VALUES ($1, $2::uuid, $3, 'Delacroix', $4, 'ENVOYE',
             now() - ($5 || ' days')::interval, $6, $7)`,
    [id, tenantId, `DEV-${crypto.randomBytes(3).toString("hex")}`, clientId,
     String(opts.jours), opts.validUntil ?? null, opts.ttc ?? 1454030],
  );
  return id;
}

const proposer = () =>
  request(serveurTest(app)).post("/api/relance/devis/proposer").set("Cookie", cookie);

const actions = async (): Promise<Array<Record<string, unknown>>> => {
  const { rows } = await adminPool.query(
    `SELECT label, description, payload FROM pending_actions
      WHERE tenant_id = $1 AND type = 'relance_devis' ORDER BY created_at DESC`, [tenantId],
  );
  return rows as Array<Record<string, unknown>>;
};

describe("a — la proposition, pas l'envoi", () => {
  test("un devis sans réponse depuis 19 jours devient une action à valider", async () => {
    await devisEnvoye({ jours: 19, telephone: "06 12 34 56 78" });
    const { body } = await proposer().expect(201);

    expect(body.proposes).toBe(1);
    const [a] = await actions();
    expect(String(a!["label"])).toContain("Relancer Delacroix");

    const p = a!["payload"] as Record<string, unknown>;
    // Le message est FIGÉ à la proposition : le recalculer à la validation
    // ferait valider un texte et en envoyer un autre.
    expect(String(p["corps"])).toContain("14540.30 € TTC");
    expect(String(p["corps"])).toContain("il y a 19 jours");
    expect(String(p["lienWhatsApp"])).toContain("https://wa.me/33612345678?text=");
  });

  test("RIEN n'est envoyé — aucune trace dans le journal d'envois", async () => {
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM envois_journal WHERE tenant_id = $1`, [tenantId],
    );
    // La règle 4 n'admet pas d'exception : relancer se valide d'abord.
    expect(rows[0].n).toBe(0);
  });
});

describe("b — les refus, et leur motif", () => {
  test("un devis trop récent n'est pas proposé, et on dit pourquoi", async () => {
    const t2 = await inscrireAutre("recent");
    await devisPour(t2, 2);
    const { body } = await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);

    expect(body.proposes).toBe(0);
    // Une campagne qui ne propose rien doit pouvoir dire pourquoi, sinon elle
    // passe pour cassée.
    expect(body.ecartes[0].motif).toBe("delai_non_atteint");
  });

  test("un devis EXPIRÉ se refait, il ne se relance pas", async () => {
    const t2 = await inscrireAutre("expire");
    await devisPour(t2, 30, "2020-01-01");
    const { body } = await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);
    expect(body.proposes).toBe(0);
    expect(body.ecartes[0].motif).toBe("expire");
  });
});

describe("c — on ne relance pas deux fois", () => {
  test("relancer la campagne ne reproduit pas la même action", async () => {
    const t2 = await inscrireAutre("doublon");
    await devisPour(t2, 20);

    const un = await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);
    expect(un.body.proposes).toBe(1);

    const deux = await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);
    // Sans marquage immédiat, la file se remplirait de doublons à chaque
    // exécution — l'humain n'ayant pas encore tranché la première.
    expect(deux.body.proposes).toBe(0);
    expect(deux.body.ecartes[0].motif).toBe("deja_relance");
  });
});

describe("d — sans numéro exploitable, l'e-mail seul", () => {
  test("le lien WhatsApp est nul, et la description le dit", async () => {
    const t2 = await inscrireAutre("sans-tel");
    await devisPour(t2, 20, null, null);
    await request(serveurTest(app))
      .post("/api/relance/devis/proposer").set("Cookie", t2.cookie).expect(201);

    const { rows } = await adminPool.query(
      `SELECT description, payload FROM pending_actions
        WHERE tenant_id = $1 AND type = 'relance_devis'`, [t2.tenantId],
    );
    expect((rows[0].payload as Record<string, unknown>)["lienWhatsApp"]).toBeNull();
    expect(String(rows[0].description)).toContain("e-mail seulement");
  });
});

// ── Aides ───────────────────────────────────────────────────────────────────

interface Autre { cookie: string; tenantId: string }

async function inscrireAutre(nom: string): Promise<Autre> {
  const email = `rc-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `T-${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

async function devisPour(
  t: Autre, jours: number, validUntil: string | null = null, telephone: string | null = "0612345678",
): Promise<void> {
  const clientId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO clients (id, tenant_id, nom, telephone) VALUES ($1, $2::uuid, 'Delacroix', $3)`,
    [clientId, t.tenantId, telephone],
  );
  await adminPool.query(
    `INSERT INTO devis (id, tenant_id, reference, client_name, client_id, status,
                        date_envoi, valid_until, total_ttc_cents)
     VALUES ($1, $2::uuid, $3, 'Delacroix', $4, 'ENVOYE',
             now() - ($5 || ' days')::interval, $6, 100000)`,
    [crypto.randomUUID(), t.tenantId, `DEV-${crypto.randomBytes(3).toString("hex")}`,
     clientId, String(jours), validUntil],
  );
}
