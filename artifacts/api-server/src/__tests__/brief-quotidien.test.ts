/**
 * Le brief du matin, envoyé sans que personne ouvre l'application.
 *
 * ── CE QUE CES TESTS PROTÈGENT ──────────────────────────────────────────────
 *
 * Le déclencheur est EXTÉRIEUR — un cron de conteneur — donc il se répétera :
 * reprise après incident, double instance pendant un déploiement progressif,
 * relance manuelle. La propriété qui compte n'est pas « le brief part », c'est
 * « il ne part jamais deux fois ». Un produit qui écrit deux fois le même
 * matin passe pour un produit qui ne se relit pas.
 *
 * Et la porte doit rester fermée : cette route est atteignable sans session.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import app from "../app";
import {
  adminPool, cleanupTenants, cleanupUsers,
  completeMfaForRegisteredOwner, serveurTest,
} from "./helpers";
import {
  envoyerBriefDuJour, corpsBrief, CLE_BRIEF_QUOTIDIEN, VALEUR_DESACTIVE,
} from "../lib/brief-quotidien";
import { composerBrief } from "../lib/brief";

const tenantIds: string[] = [];
const emails: string[] = [];
let tenantId = "";
let emailProprio = "";

const SECRET = "secret-de-cron-pour-les-tests-1234";

/** Une facture en retard : de quoi donner au brief quelque chose à dire. */
async function factureEnRetard(): Promise<void> {
  const hier = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  const d = `${hier.getFullYear()}-${String(hier.getMonth() + 1).padStart(2, "0")}-${String(hier.getDate()).padStart(2, "0")}`;
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, statut,
                           amount_cents, total_ht_cents, issued_date, due_date)
     VALUES ($1, $2::uuid, $3, 'Client Retard', 'EMISE', 150000, 150000, $4, $4)`,
    [crypto.randomUUID(), tenantId, `F-${crypto.randomBytes(3).toString("hex")}`, d],
  );
}

beforeAll(async () => {
  emailProprio = `brief-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(emailProprio);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email: emailProprio, password: "test-pass-1234", nom: "Patron", tenantNom: "Brief SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
  await factureEnRetard();
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("il ne part jamais deux fois le même jour", () => {
  test("le premier envoi passe, le second est refusé par la base", async () => {
    /*
     * LA propriété de ce lot. La garde n'est pas dans le code mais dans la
     * contrainte UNIQUE (tenant, jour) : deux exécutions concurrentes
     * insèrent, une seule gagne. Il n'y a pas de fenêtre de course à fermer.
     */
    const premier = await envoyerBriefDuJour(tenantId);
    expect(premier.etat).toBe("envoye");

    const second = await envoyerBriefDuJour(tenantId);
    expect(second.etat).toBe("deja_envoye");

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM briefs_envoyes WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    expect(rows[0].n).toBe(1);
  });

  test("un autre JOUR repart normalement", async () => {
    const demain = new Date(Date.now() + 24 * 3600 * 1000);
    const r = await envoyerBriefDuJour(tenantId, demain);
    expect(r.etat).toBe("envoye");
  });

  test("la trace ne contient AUCUN contenu de message", async () => {
    // Le brief cite des noms de clients et des montants ; la règle 6 interdit
    // de journaliser un contenu de message. On garde le fait, pas le texte.
    const { rows } = await adminPool.query(
      `SELECT * FROM briefs_envoyes WHERE tenant_id = $1::uuid LIMIT 1`, [tenantId],
    );
    const colonnes = Object.keys(rows[0]);
    for (const interdite of ["corps", "body", "contenu", "texte", "message"]) {
      expect(colonnes, `« ${interdite} » stocke un contenu`).not.toContain(interdite);
    }
  });
});

describe("on n'envoie pas pour ne rien dire", () => {
  test("un tenant sans rien à signaler ne reçoit pas de courriel", async () => {
    /*
     * « Tout est en ordre » est la section de repli du brief. Envoyer un
     * courriel quotidien pour annoncer qu'il ne se passe rien apprend à
     * l'artisan à ne plus les ouvrir — et le jour où il y a une vraie urgence,
     * elle est déjà classée avec le reste.
     */
    const email = `brief-vide-${Date.now()}@test.nodaq`;
    emails.push(email);
    const reg = await request(serveurTest(app))
      .post("/api/auth/register")
      .send({ email, password: "test-pass-1234", nom: "P", tenantNom: "Vide SARL" })
      .expect(201);
    await completeMfaForRegisteredOwner(reg.body.userId);
    tenantIds.push(reg.body.tenantId);

    const r = await envoyerBriefDuJour(reg.body.tenantId);
    expect(r.etat).toBe("rien_a_dire");
  });

  test("un tenant qui l'a désactivé ne reçoit rien", async () => {
    await adminPool.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)`,
      [tenantId, CLE_BRIEF_QUOTIDIEN, VALEUR_DESACTIVE],
    );
    const apresDemain = new Date(Date.now() + 48 * 3600 * 1000);
    expect((await envoyerBriefDuJour(tenantId, apresDemain)).etat).toBe("desactive");
    await adminPool.query(
      `DELETE FROM settings WHERE tenant_id = $1::uuid AND key = $2`,
      [tenantId, CLE_BRIEF_QUOTIDIEN],
    );
  });
});

describe("le texte dit ce qu'il faut, et comment s'en défaire", () => {
  test("il porte le moyen de se désabonner", async () => {
    // Un message quotidien sans porte de sortie se fait classer en
    // indésirable — et emporte avec lui les factures envoyées du même domaine.
    const corps = corpsBrief(await composerBrief(tenantId), "https://app.nodaq.fr");
    expect(corps).toMatch(/ne plus recevoir/i);
    expect(corps).toMatch(/Paramètres/);
  });

  test("il renvoie vers l'application, il ne la remplace pas", async () => {
    const corps = corpsBrief(await composerBrief(tenantId), "https://app.nodaq.fr");
    expect(corps).toContain("https://app.nodaq.fr");
  });
});

describe("la porte reste fermée", () => {
  test("sans secret configuré, la route REFUSE", async () => {
    /*
     * Une porte qui s'ouvre quand la serrure manque n'est pas une porte.
     * Même règle que la sortie modèle : une variable absente lève, elle ne
     * retombe pas sur une valeur par défaut.
     */
    vi.stubEnv("BRIEF_CRON_SECRET", "");
    const r = await request(serveurTest(app)).post("/api/interne/brief-quotidien");
    expect(r.status).toBe(503);
    vi.unstubAllEnvs();
  });

  test("un mauvais secret est refusé", async () => {
    vi.stubEnv("BRIEF_CRON_SECRET", SECRET);
    const r = await request(serveurTest(app))
      .post("/api/interne/brief-quotidien")
      .set("x-nodaq-cron", "pas-le-bon-secret-du-tout-aaaa");
    expect(r.status).toBe(403);
    vi.unstubAllEnvs();
  });

  test("la route n'accepte NI destinataire NI tenant en paramètre", () => {
    /*
     * Une route déclenchable de l'extérieur qui accepterait l'un ou l'autre
     * serait un moyen de faire envoyer les données d'une entreprise à
     * n'importe qui. Même garde que la transmission du support, où le
     * destinataire n'est pas non plus un paramètre.
     */
    const src = readFileSync(join(__dirname, "..", "routes", "brief-quotidien.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const interdit of ["req.body", "req.query", "destinataire", "tenantId"]) {
      expect(src, `« ${interdit} » ne doit pas être lu de la requête`).not.toContain(interdit);
    }
  });

  test("la réponse ne laisse fuir ni tenant ni adresse", async () => {
    // Elle finit dans les journaux d'un cron : la règle 6 interdit d'y laisser
    // des données d'entreprise.
    vi.stubEnv("BRIEF_CRON_SECRET", SECRET);
    const r = await request(serveurTest(app))
      .post("/api/interne/brief-quotidien")
      .set("x-nodaq-cron", SECRET)
      .expect(200);
    const corps = JSON.stringify(r.body);
    expect(corps).not.toContain(tenantId);
    expect(corps).not.toContain(emailProprio);
    expect(typeof r.body.traites).toBe("number");
    vi.unstubAllEnvs();
  });
});
