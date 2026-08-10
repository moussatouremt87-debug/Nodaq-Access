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

/**
 * Une adresse distincte par appel public.
 *
 * La limitation de débit est réelle et compte par IP : sans cela la suite
 * entière partagerait un compteur et finirait en 429. On ne la désactive PAS —
 * un test qui désarme la garde qu'il traverse ne prouve rien — on se présente
 * simplement comme des clients différents, ce que sont de vrais clients.
 */
let compteurIp = 0;
const ipUnique = (): string => `203.0.113.${(compteurIp++ % 250) + 1}`;

const publicGet = (chemin: string) => request(app).get(chemin).set("X-Forwarded-For", ipUnique());
const publicPost = (chemin: string) => request(app).post(chemin).set("X-Forwarded-For", ipUnique());

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
  await adminPool.query(`DELETE FROM tenant_secrets WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  await adminPool.query(`DELETE FROM devis WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a & b. Lecture de la page d'acceptation ──────────────────────────────────

describe("a — un jeton inconnu ne dit rien de plus qu'un devis inexistant", () => {
  test("jeton inconnu → 404", async () => {
    const r = await publicGet(`/api/public/devis/${crypto.randomUUID()}/accept-page`)
      .expect(404);
    expect(r.body.error).toBeTruthy();
  });

  test("deux jetons inconnus rendent EXACTEMENT le même corps", async () => {
    // Un message qui distinguerait « jeton inconnu » de « devis supprimé »
    // confirmerait à un curieux qu'un jeton a existé. Même réponse, même code.
    const un = await publicGet(`/api/public/devis/${crypto.randomUUID()}/accept-page`).expect(404);
    const deux = await publicGet(`/api/public/devis/aaaa-bbbb-cccc/accept-page`).expect(404);
    expect(un.body).toEqual(deux.body);
  });

  test("un jeton VALIDE mais dont le devis a été supprimé rend le même 404", async () => {
    const d = await devisEnvoye(a);
    await adminPool.query(`DELETE FROM devis WHERE id = $1`, [d.id]);
    const r = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(404);
    const temoin = await publicGet(`/api/public/devis/${crypto.randomUUID()}/accept-page`).expect(404);
    expect(r.body).toEqual(temoin.body);
  });
});

describe("b — un jeton valide ouvre la page", () => {
  test("200 avec référence, nom du client et montant", async () => {
    const d = await devisEnvoye(a, { montantCents: 987_600 });
    const r = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(200);
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
    const r = await publicPost(`/api/public/devis/${d.token}/accept`)
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
    await publicPost(`/api/public/devis/${d.token}/accept`)
      .send({ signataire: "Premier Signataire" })
      .expect(200);

    const avant = await adminPool.query(
      `SELECT accepted_at, accepted_by FROM devis WHERE id = $1`,
      [d.id],
    );

    await publicPost(`/api/public/devis/${d.token}/accept`)
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
      publicPost(`/api/public/devis/${d.token}/accept`).send({ signataire: "A" }),
      publicPost(`/api/public/devis/${d.token}/accept`).send({ signataire: "B" }),
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
    const r = await publicPost(`/api/public/devis/${d.token}/accept`)
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
    await publicPost(`/api/public/devis/${d.token}/accept`)
      .send({ signataire: "Juste à Temps" })
      .expect(200);
  });

  test("la page d'acceptation dit « expiré » pour hier, pas pour aujourd'hui", async () => {
    const hier = await devisEnvoye(a, { validUntil: toDateString(new Date(Date.now() - 86_400_000)) });
    const ce_jour = await devisEnvoye(a, { validUntil: toDateString(new Date()) });

    const rHier = await publicGet(`/api/public/devis/${hier.token}/accept-page`).expect(200);
    expect(rHier.body.expired).toBe(true);

    const rCeJour = await publicGet(`/api/public/devis/${ce_jour.token}/accept-page`).expect(200);
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
    const rA = await publicGet(`/api/public/devis/${chezA.token}/accept-page`).expect(200);
    expect(rA.body.reference).toBe(chezA.reference);
    const rB = await publicGet(`/api/public/devis/${chezB.token}/accept-page`).expect(200);
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

// ── i. Renvoyer ne casse pas le lien du client ──────────────────────────────

describe("i — « renvoyer » réutilise le lien, « nouveau lien » le remplace", () => {
  /** Crée un devis par l'API et l'envoie une première fois. */
  async function creerEtEnvoyer(l: Locataire): Promise<{ id: string; url: string }> {
    const { body: cree } = await request(app)
      .post("/api/devis")
      .set("Cookie", l.cookie)
      .send({ clientName: "Madame Client", lines: [{ description: "Pose", quantity: 1, unitPriceCents: 100_000 }] })
      .expect(201);
    const { body: envoye } = await request(app)
      .post(`/api/devis/${cree.id}/envoyer`)
      .set("Cookie", l.cookie)
      .send({ emailTo: "client@example.test" })
      .expect(200);
    expect(envoye.acceptUrl).toBeTruthy();
    expect(envoye.lienReutilise).toBe(false);
    return { id: cree.id, url: envoye.acceptUrl as string };
  }

  const jetonDe = (url: string): string => url.split("/").pop()!;

  test("un renvoi rend EXACTEMENT le même lien", async () => {
    const premier = await creerEtEnvoyer(a);
    const { body: renvoi } = await request(app)
      .post(`/api/devis/${premier.id}/envoyer`)
      .set("Cookie", a.cookie)
      .send({ emailTo: "client@example.test" })
      .expect(200);

    // C'est tout le sujet : l'artisan dont le client dit ne pas avoir reçu le
    // devis renvoie le même lien, et l'ancien e-mail continue de marcher.
    expect(renvoi.acceptUrl).toBe(premier.url);
    expect(renvoi.lienReutilise).toBe(true);
  });

  test("après un renvoi, le lien du PREMIER e-mail fonctionne toujours", async () => {
    const premier = await creerEtEnvoyer(a);
    await request(app)
      .post(`/api/devis/${premier.id}/envoyer`)
      .set("Cookie", a.cookie)
      .send({ emailTo: "client@example.test" })
      .expect(200);

    // Le client retrouve l'ancien message et clique : il doit voir son devis,
    // pas « lien invalide ou expiré ».
    const r = await publicGet(`/api/public/devis/${jetonDe(premier.url)}/accept-page`)
      .expect(200);
    expect(r.body.clientName).toBe("Madame Client");
  });

  test("« nouveau lien » en rend un AUTRE et invalide le précédent", async () => {
    const premier = await creerEtEnvoyer(a);
    const { body: nouveau } = await request(app)
      .post(`/api/devis/${premier.id}/nouveau-lien`)
      .set("Cookie", a.cookie)
      .expect(200);

    expect(nouveau.acceptUrl).not.toBe(premier.url);
    expect(nouveau.ancienLienInvalide).toBe(true);

    // L'ancien ne répond plus — et avec la réponse indifférenciée.
    await publicGet(`/api/public/devis/${jetonDe(premier.url)}/accept-page`).expect(404);
    // Le nouveau, lui, ouvre bien le devis.
    await publicGet(`/api/public/devis/${jetonDe(nouveau.acceptUrl)}/accept-page`).expect(200);
  });

  test("« nouveau lien » est refusé sur un devis déjà accepté", async () => {
    const premier = await creerEtEnvoyer(a);
    await publicPost(`/api/public/devis/${jetonDe(premier.url)}/accept`)
      .send({ signataire: "Jean Client" })
      .expect(200);

    await request(app)
      .post(`/api/devis/${premier.id}/nouveau-lien`)
      .set("Cookie", a.cookie)
      .expect(409);
  });

  test("le jeton est chiffré dans le magasin, jamais en clair", async () => {
    const premier = await creerEtEnvoyer(a);
    const jeton = jetonDe(premier.url);

    const { rows } = await adminPool.query(
      `SELECT to_jsonb(t) AS ligne FROM tenant_secrets t
        WHERE tenant_id = $1::uuid AND cle = $2`,
      [a.tenantId, `devis.${premier.id}.accept_token`],
    );
    expect(rows).toHaveLength(1);
    // Le jeton est reconstructible par l'APPLICATION, jamais par la seule base :
    // la clé vit dans l'environnement. Une sauvegarde ne suffit pas.
    expect(JSON.stringify(rows[0].ligne)).not.toContain(jeton);
    expect(String(rows[0].ligne.valeur_chiffree).startsWith("v1:")).toBe(true);

    // Et `devis` ne le porte toujours pas non plus.
    const d = await adminPool.query(`SELECT to_jsonb(t) AS ligne FROM devis t WHERE id = $1`, [premier.id]);
    expect(JSON.stringify(d.rows[0].ligne)).not.toContain(jeton);
  });

  test("supprimer un devis emporte son jeton", async () => {
    const premier = await creerEtEnvoyer(a);
    await request(app).delete(`/api/devis/${premier.id}`).set("Cookie", a.cookie).expect(204);
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle = $2`,
      [a.tenantId, `devis.${premier.id}.accept_token`],
    );
    expect(rows[0].n).toBe(0);
  });
});

// ── j. La limitation de débit ───────────────────────────────────────────────

describe("j — une route publique n'est pas une route sans limite", () => {
  test("au-delà du quota par IP, la route répond 429", async () => {
    // IP FIXE, contrairement au reste de la suite : c'est le point du test.
    const ip = "198.51.100.7";
    const inconnu = () => `/api/public/devis/${crypto.randomUUID()}/accept-page`;

    let vus429 = 0;
    for (let i = 0; i < 30; i++) {
      const r = await request(app).get(inconnu()).set("X-Forwarded-For", ip);
      if (r.status === 429) vus429++;
    }
    expect(vus429).toBeGreaterThan(0);
  }, 60_000);

  test("une AUTRE adresse n'est pas pénalisée par la précédente", async () => {
    // Sans cette assertion, un compteur global passerait le test précédent tout
    // en bloquant tout le monde dès qu'un seul client insiste.
    const r = await request(app)
      .get(`/api/public/devis/${crypto.randomUUID()}/accept-page`)
      .set("X-Forwarded-For", "198.51.100.200");
    expect(r.status).toBe(404);
  });
});
