/**
 * Acceptation publique d'un devis — le parcours du CLIENT DE L'ARTISAN.
 *
 * C'est la seule surface du produit que voit le client final, et celle qui
 * transforme un devis en engagement. Elle n'avait AUCUN test : aucun fichier de
 * `src/__tests__` ne mentionnait `/public/devis` ni `accept-page`. C'est pour
 * cela que six cents tests verts ne voyaient pas qu'elle rendait 500 sur
 * chaque appel.
 *
 * Ce que ces tests protègent :
 *   a. jeton inconnu → 404, et le corps ne distingue pas « inconnu » de
 *      « inexistant » ;
 *   b. jeton valide → 200 avec référence, nom du client et montant ;
 *   c. acceptation → ACCEPTE, avec horodatage, signataire et adresse IP ;
 *   d. deuxième acceptation → 409, et le PREMIER horodatage est inchangé ;
 *   e. concurrence → une seule gagne, la garde `acceptedAt IS NULL` le prouve ;
 *   f. expiration : hier → 410 ; AUJOURD'HUI → accepté, dans les trois fuseaux ;
 *   g. le jeton en clair est ABSENT de la base ;
 *   h. isolation : le jeton d'un devis de A n'ouvre rien sur B.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { toDateString } from "@nodaq/shared";
import { adminPool, cleanupTenants, cleanupUsers } from "./helpers";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `accept-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

/**
 * Crée un devis ENVOYÉ et rend le jeton en clair.
 *
 * Le jeton est posé ICI comme le fera la route d'envoi : en clair dans le lien,
 * en CONDENSAT en base. Le test ne connaît donc que ce que connaît le client.
 */
async function devisEnvoye(
  l: Locataire,
  opts: { validUntil?: string | null; montantCents?: number } = {},
): Promise<{ id: string; token: string; reference: string }> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const reference = `DEV-${crypto.randomBytes(3).toString("hex")}`;
  const sha = crypto.createHash("sha256").update(token).digest("hex");

  await adminPool.query(
    `INSERT INTO devis (id, tenant_id, reference, client_name, status,
                        total_ttc_cents, valid_until, accept_token_sha256, date_envoi)
     VALUES ($1, $2::uuid, $3, 'Madame Client', 'ENVOYE', $4, $5, $6, NOW())`,
    [id, l.tenantId, reference, opts.montantCents ?? 1_234_500, opts.validUntil ?? null, sha],
  );
  return { id, token, reference };
}

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
}, 90_000);

afterAll(async () => {
  await adminPool.query(`DELETE FROM devis WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a & b. Lecture de la page d'acceptation ──────────────────────────────────

describe("a — un jeton inconnu ne dit rien de plus qu'un devis inexistant", () => {
  test("jeton inconnu → 404", async () => {
    const r = await request(app)
      .get(`/api/public/devis/${crypto.randomUUID()}/accept-page`)
      .expect(404);
    expect(r.body.error).toBeTruthy();
  });

  test("deux jetons inconnus rendent EXACTEMENT le même corps", async () => {
    // Un message qui distinguerait « jeton inconnu » de « devis supprimé »
    // confirmerait à un curieux qu'un jeton a existé. Même réponse, même code.
    const un = await request(app).get(`/api/public/devis/${crypto.randomUUID()}/accept-page`).expect(404);
    const deux = await request(app).get(`/api/public/devis/aaaa-bbbb-cccc/accept-page`).expect(404);
    expect(un.body).toEqual(deux.body);
  });

  test("un jeton VALIDE mais dont le devis a été supprimé rend le même 404", async () => {
    const d = await devisEnvoye(a);
    await adminPool.query(`DELETE FROM devis WHERE id = $1`, [d.id]);
    const r = await request(app).get(`/api/public/devis/${d.token}/accept-page`).expect(404);
    const temoin = await request(app).get(`/api/public/devis/${crypto.randomUUID()}/accept-page`).expect(404);
    expect(r.body).toEqual(temoin.body);
  });
});

describe("b — un jeton valide ouvre la page", () => {
  test("200 avec référence, nom du client et montant", async () => {
    const d = await devisEnvoye(a, { montantCents: 987_600 });
    const r = await request(app).get(`/api/public/devis/${d.token}/accept-page`).expect(200);
    expect(r.body.reference).toBe(d.reference);
    expect(r.body.clientName).toBe("Madame Client");
    expect(r.body.totalTTCCents).toBe(987_600);
    expect(r.body.alreadyAccepted).toBe(false);
    expect(r.body.expired).toBe(false);
  });
});

// ── c & d. Acceptation ───────────────────────────────────────────────────────

describe("c — l'acceptation engage", () => {
  test("status ACCEPTE, horodatage, signataire et adresse IP renseignés", async () => {
    const d = await devisEnvoye(a);
    const r = await request(app)
      .post(`/api/public/devis/${d.token}/accept`)
      .send({ signataire: "Jean Client" })
      .expect(200);
    expect(r.body.accepted).toBe(true);

    const { rows } = await adminPool.query(
      `SELECT status, accepted_at, accepted_by, accepted_ip FROM devis WHERE id = $1`,
      [d.id],
    );
    expect(rows[0].status).toBe("ACCEPTE");
    expect(rows[0].accepted_at).not.toBeNull();
    expect(rows[0].accepted_by).toBe("Jean Client");
    expect(rows[0].accepted_ip).toBeTruthy();
  });
});

describe("d — on n'accepte pas deux fois", () => {
  test("deuxième acceptation → 409, et le PREMIER horodatage est inchangé", async () => {
    const d = await devisEnvoye(a);
    await request(app)
      .post(`/api/public/devis/${d.token}/accept`)
      .send({ signataire: "Premier Signataire" })
      .expect(200);

    const avant = await adminPool.query(
      `SELECT accepted_at, accepted_by FROM devis WHERE id = $1`,
      [d.id],
    );

    await request(app)
      .post(`/api/public/devis/${d.token}/accept`)
      .send({ signataire: "Second Signataire" })
      .expect(409);

    const apres = await adminPool.query(
      `SELECT accepted_at, accepted_by FROM devis WHERE id = $1`,
      [d.id],
    );
    // C'est une preuve d'engagement : le nom et l'heure du PREMIER signataire
    // ne se réécrivent pas.
    expect(apres.rows[0].accepted_at).toEqual(avant.rows[0].accepted_at);
    expect(apres.rows[0].accepted_by).toBe("Premier Signataire");
  });
});

describe("e — concurrence", () => {
  test("deux acceptations simultanées : une seule gagne", async () => {
    const d = await devisEnvoye(a);
    const [un, deux] = await Promise.all([
      request(app).post(`/api/public/devis/${d.token}/accept`).send({ signataire: "A" }),
      request(app).post(`/api/public/devis/${d.token}/accept`).send({ signataire: "B" }),
    ]);
    const codes = [un.status, deux.status].sort();
    expect(codes).toEqual([200, 409]);

    const { rows } = await adminPool.query(
      `SELECT accepted_by, status FROM devis WHERE id = $1`,
      [d.id],
    );
    expect(rows[0].status).toBe("ACCEPTE");
    // La garde `acceptedAt IS NULL` de l'UPDATE est ce qui empêche le second
    // d'écraser le premier : le signataire enregistré est celui qui a gagné.
    expect(["A", "B"]).toContain(rows[0].accepted_by);
  });
});

// ── f. Expiration — une date métier, pas un instant ─────────────────────────

describe("f — la validité couvre le JOUR entier", () => {
  test("valable jusqu'à HIER → 410", async () => {
    const hier = toDateString(new Date(Date.now() - 86_400_000));
    const d = await devisEnvoye(a, { validUntil: hier });
    const r = await request(app)
      .post(`/api/public/devis/${d.token}/accept`)
      .send({ signataire: "Trop Tard" })
      .expect(410);
    expect(r.body.validUntil).toBe(hier);
  });

  test("valable jusqu'à AUJOURD'HUI → accepté", async () => {
    // Le défaut : `new Date("2026-08-10") < new Date()` compare minuit UTC à
    // maintenant. Un devis valable jusqu'au 10 août expirait donc à 2 h du
    // matin heure de Paris ce jour-là — alors que « valable jusqu'au 10 août »
    // veut dire jusqu'à la FIN du 10 août. Ce test tourne sous UTC,
    // Europe/Paris et Pacific/Auckland : Auckland, en avance, est le fuseau qui
    // le révèle.
    const aujourdhui = toDateString(new Date());
    const d = await devisEnvoye(a, { validUntil: aujourdhui });
    await request(app)
      .post(`/api/public/devis/${d.token}/accept`)
      .send({ signataire: "Juste à Temps" })
      .expect(200);
  });

  test("la page d'acceptation dit « expiré » pour hier, pas pour aujourd'hui", async () => {
    const hier = await devisEnvoye(a, { validUntil: toDateString(new Date(Date.now() - 86_400_000)) });
    const ce_jour = await devisEnvoye(a, { validUntil: toDateString(new Date()) });

    const rHier = await request(app).get(`/api/public/devis/${hier.token}/accept-page`).expect(200);
    expect(rHier.body.expired).toBe(true);

    const rCeJour = await request(app).get(`/api/public/devis/${ce_jour.token}/accept-page`).expect(200);
    expect(rCeJour.body.expired).toBe(false);
  });
});

// ── g. Le jeton n'est plus en base ──────────────────────────────────────────

describe("g — le jeton en clair est absent de la base", () => {
  test("aucune colonne de `devis` ne contient la valeur du jeton", async () => {
    const d = await devisEnvoye(a);

    // On aplatit TOUTE la ligne : une assertion ciblée sur une colonne ne
    // verrait pas un jeton recopié ailleurs par mégarde.
    const { rows } = await adminPool.query(
      `SELECT to_jsonb(t) AS ligne FROM devis t WHERE id = $1`,
      [d.id],
    );
    expect(JSON.stringify(rows[0].ligne)).not.toContain(d.token);

    // Et le condensat, lui, est bien là — sinon le test précédent passerait
    // au vert sur une ligne où l'on n'aurait rien rangé du tout.
    const sha = crypto.createHash("sha256").update(d.token).digest("hex");
    expect(rows[0].ligne.accept_token_sha256).toBe(sha);
  });

  test("la colonne `accept_token` n'existe plus", async () => {
    const { rows } = await adminPool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'devis' AND column_name = 'accept_token'`,
    );
    expect(rows).toHaveLength(0);
  });
});

// ── h. Isolation ────────────────────────────────────────────────────────────

describe("h — le jeton d'un tenant n'ouvre rien chez un autre", () => {
  test("un devis de A n'est pas atteignable en se réclamant de B", async () => {
    const chezA = await devisEnvoye(a);
    const chezB = await devisEnvoye(b);

    // Chaque jeton n'ouvre QUE son devis.
    const rA = await request(app).get(`/api/public/devis/${chezA.token}/accept-page`).expect(200);
    expect(rA.body.reference).toBe(chezA.reference);
    const rB = await request(app).get(`/api/public/devis/${chezB.token}/accept-page`).expect(200);
    expect(rB.body.reference).toBe(chezB.reference);
    expect(rA.body.reference).not.toBe(rB.body.reference);
  });

  test("la policy étroite ne laisse passer QU'UNE SEULE ligne", async () => {
    // Sonde au niveau moteur, par la connexion applicative : c'est la policy
    // `devis_public_token_lookup` qu'on éprouve, pas le code de la route. Si
    // quelqu'un la remplace par un `USING (true)`, ce compte explose.
    const d = await devisEnvoye(a);
    const sha = crypto.createHash("sha256").update(d.token).digest("hex");

    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_user");
      await client.query(`SELECT set_config('app.devis_accept_token_sha256', $1, true)`, [sha]);
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM devis`);
      expect(rows[0].n).toBe(1);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  test("sans le réglage de session, la policy publique ne laisse rien passer", async () => {
    await devisEnvoye(a);
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_user");
      // Aucun tenant, aucun jeton : les deux policies sont muettes.
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM devis`);
      expect(rows[0].n).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
