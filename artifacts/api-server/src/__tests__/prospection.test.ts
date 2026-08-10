/**
 * Prospection — le SERVEUR refuse ce que l'interface n'aurait pas dû proposer.
 *
 * Ce que ces tests protègent :
 *   a. chaque combinaison interdite → 403, et RIEN n'est envoyé ni journalisé ;
 *   b. EMBARGO : le corps de la réponse ne contient ni téléphone, ni e-mail,
 *      ni adresse pour un particulier non informé ;
 *   c. OPPOSITION : posée, puis le contact réimporté depuis un fichier →
 *      toujours bloqué, sur les trois canaux ;
 *   d. seuil d'anonymat : quatre occurrences ne sortent pas, cinq oui ;
 *   e. AUCUN PIXEL : pas de balise image dans un message sortant ;
 *   f. isolation, une table à la fois ;
 *   g. immuabilité de `contact_bases` et `oppositions` — 42501 prouvé avec la
 *      connexion applicative ;
 *   h. purge à trois ans.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
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

let compteurIp = 0;
const ipUnique = (): string => `198.51.100.${(compteurIp++ % 250) + 1}`;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `prosp-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

/** Contact + base légale, posés par l'API. */
async function contactAvecBase(
  l: Locataire,
  opts: {
    type: "PARTICULIER" | "PRO";
    base: string;
    informe?: boolean;
    email?: string;
    telephone?: string;
  },
): Promise<string> {
  const { body: c } = await request(app).post("/api/prospection/contacts").set("Cookie", l.cookie)
    .send({
      nom: `Contact ${crypto.randomBytes(3).toString("hex")}`,
      type: opts.type,
      email: opts.email ?? `c-${crypto.randomBytes(4).toString("hex")}@example.test`,
      telephone: opts.telephone ?? `06${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      adresse: "12 rue des Ardoises",
      codePostal: "02120",
      ville: "Marly-Gomont",
    })
    .expect(201);

  await request(app).post(`/api/prospection/contacts/${c.id}/base`).set("Cookie", l.cookie)
    .send({ base: opts.base, source: "registre des permis de construire de la commune X" })
    .expect(201);

  if (opts.informe) {
    await adminPool.query(
      `INSERT INTO contact_bases (id, tenant_id, contact_id, contact_type, base, source, obtenue_le, informee_le)
       VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, $4, 'registre public', CURRENT_DATE, CURRENT_DATE)`,
      [l.tenantId, c.id, opts.type, opts.base],
    );
  }
  return c.id;
}

const envoyer = (l: Locataire, contactId: string, canal: string) =>
  request(app).post("/api/prospection/envoyer").set("Cookie", l.cookie)
    .send({ contactId, canal, objet: "Entretien de gouttières", message: "Bonjour, …" });

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a. Le serveur refuse ────────────────────────────────────────────────────

describe("a — le SERVEUR refuse, pas l'interface", () => {
  test("un contact SANS base légale n'est prospectable par aucun canal", async () => {
    const { body: c } = await request(app).post("/api/prospection/contacts").set("Cookie", a.cookie)
      .send({ nom: "Sans base", type: "PRO", email: "sansbase@example.test" }).expect(201);

    for (const canal of ["email", "telephone", "courrier"]) {
      const r = await envoyer(a, c.id, canal).expect(403);
      expect(r.body.error).toContain("base légale");
    }
  });

  test.each([
    ["particulier · intérêt légitime NON informé · email", "PARTICULIER", "INTERET_LEGITIME_PARTICULIER", false, "email"],
    ["particulier · intérêt légitime NON informé · telephone", "PARTICULIER", "INTERET_LEGITIME_PARTICULIER", false, "telephone"],
    ["particulier · intérêt légitime NON informé · courrier", "PARTICULIER", "INTERET_LEGITIME_PARTICULIER", false, "courrier"],
    ["particulier · intérêt légitime INFORMÉ · email", "PARTICULIER", "INTERET_LEGITIME_PARTICULIER", true, "email"],
    ["particulier · intérêt légitime INFORMÉ · telephone", "PARTICULIER", "INTERET_LEGITIME_PARTICULIER", true, "telephone"],
  ])("%s → 403", async (_titre, type, base, informe, canal) => {
    const id = await contactAvecBase(a, {
      type: type as "PARTICULIER" | "PRO", base, informe: informe as boolean,
    });
    await envoyer(a, id, canal).expect(403);
  });

  test("RIEN n'est envoyé ni journalisé quand la route refuse", async () => {
    const canal = await import("../lib/canal-emission.js");
    const espion = vi.spyOn(canal, "sendDocument");

    const id = await contactAvecBase(a, {
      type: "PARTICULIER", base: "INTERET_LEGITIME_PARTICULIER", informe: true,
    });
    const avant = await adminPool.query(
      `SELECT count(*)::int n FROM envois_journal WHERE tenant_id = $1::uuid`, [a.tenantId]);

    await envoyer(a, id, "email").expect(403);

    // Un refus qui laisserait une trace d'envoi serait pire qu'un envoi : il
    // ferait croire à l'artisan que le message est parti.
    expect(espion).not.toHaveBeenCalled();
    const apres = await adminPool.query(
      `SELECT count(*)::int n FROM envois_journal WHERE tenant_id = $1::uuid`, [a.tenantId]);
    expect(apres.rows[0].n).toBe(avant.rows[0].n);
    espion.mockRestore();
  });

  test("les combinaisons AUTORISÉES passent", async () => {
    const pro = await contactAvecBase(a, { type: "PRO", base: "INTERET_LEGITIME_PRO" });
    await envoyer(a, pro, "email").expect(200);
    await envoyer(a, pro, "telephone").expect(200);
    await envoyer(a, pro, "courrier").expect(200);

    const informe = await contactAvecBase(a, {
      type: "PARTICULIER", base: "INTERET_LEGITIME_PARTICULIER", informe: true,
    });
    // Le SEUL canal ouvert : le courrier.
    await envoyer(a, informe, "courrier").expect(200);
  });
});

// ── b. Embargo ──────────────────────────────────────────────────────────────

describe("b — embargo : le CORPS ne contient pas les coordonnées", () => {
  test("particulier non informé → ni téléphone, ni e-mail, ni adresse", async () => {
    const email = `embargo-${crypto.randomBytes(4).toString("hex")}@example.test`;
    const telephone = "0612345678";
    const id = await contactAvecBase(a, {
      type: "PARTICULIER", base: "INTERET_LEGITIME_PARTICULIER", email, telephone,
    });
    // Adresse UNIQUE : celle du fixture est partagée par les autres contacts,
    // dont certains ne sont PAS sous embargo — elle a donc le droit de figurer
    // dans la réponse pour eux.
    const adresse = `rue Unique ${crypto.randomBytes(4).toString("hex")}`;
    await adminPool.query(`UPDATE contacts_prospection SET adresse = $1 WHERE id = $2`, [adresse, id]);

    const { body } = await request(app).get("/api/prospection/contacts")
      .set("Cookie", a.cookie).expect(200);

    // On vérifie le CORPS, pas le code HTTP : un champ masqué à l'écran voyage
    // quand même et se lit dans l'onglet réseau.
    const corps = JSON.stringify(body);
    expect(corps).not.toContain(email);
    expect(corps).not.toContain(telephone);
    expect(corps).not.toContain(adresse);

    const sousEmbargo = body.contacts.find((c: { id: string }) => c.id === id);
    expect(sousEmbargo).toBeDefined();
    expect(sousEmbargo.sousEmbargo).toBe(true);
    expect(sousEmbargo.email).toBeNull();
    expect(sousEmbargo.telephone).toBeNull();
    expect(sousEmbargo.adresse).toBeNull();
    // La ville reste : elle ne suffit pas à joindre quelqu'un.
    expect(sousEmbargo.ville).toBe("Marly-Gomont");
  });

  test("une fois informé, l'embargo est levé", async () => {
    const email = `leve-${crypto.randomBytes(4).toString("hex")}@example.test`;
    const id = await contactAvecBase(a, {
      type: "PARTICULIER", base: "INTERET_LEGITIME_PARTICULIER", email,
    });
    await request(app).post(`/api/prospection/contacts/${id}/informer`)
      .set("Cookie", a.cookie).expect(200);

    const { body } = await request(app).get("/api/prospection/contacts")
      .set("Cookie", a.cookie).expect(200);
    const c = body.contacts.find((x: { id: string }) => x.id === id);
    expect(c.sousEmbargo).toBe(false);
    expect(c.email).toBe(email);
    // Et le seul canal ouvert reste le courrier.
    expect(c.canaux).toEqual({ email: false, telephone: false, courrier: true });
  });

  test("« informer » enregistre une NOUVELLE ligne de base, sans réécrire l'ancienne", async () => {
    const id = await contactAvecBase(a, {
      type: "PARTICULIER", base: "INTERET_LEGITIME_PARTICULIER",
    });
    await request(app).post(`/api/prospection/contacts/${id}/informer`)
      .set("Cookie", a.cookie).expect(200);

    const { rows } = await adminPool.query(
      `SELECT informee_le FROM contact_bases WHERE contact_id = $1 ORDER BY created_at`, [id]);
    expect(rows).toHaveLength(2);
    expect(rows[0].informee_le).toBeNull();   // l'originale, intacte
    expect(rows[1].informee_le).not.toBeNull();
  });
});

// ── c. Opposition ───────────────────────────────────────────────────────────

describe("c — une opposition survit au RÉIMPORT du fichier", () => {
  test("le même contact réimporté reste bloqué sur les trois canaux", async () => {
    const email = `oppose-${crypto.randomBytes(4).toString("hex")}@example.test`;
    const telephone = "0699887766";

    const premier = await contactAvecBase(a, {
      type: "PRO", base: "INTERET_LEGITIME_PRO", email, telephone,
    });
    await envoyer(a, premier, "email").expect(200);

    // La personne se retire par le lien public, sans session.
    const { rows } = await adminPool.query(
      `SELECT opposition_token_sha256 FROM contacts_prospection WHERE id = $1`, [premier]);
    expect(rows[0].opposition_token_sha256).toBeTruthy();
    // On rejoue le jeton depuis l'envoi précédent.
    const envoi = await envoyer(a, premier, "email").expect(200);
    const jeton = String(envoi.body.lienOpposition).split("/").pop()!;
    await request(app).post(`/api/public/opposition/${jeton}`)
      .set("X-Forwarded-For", ipUnique()).expect(200);

    await envoyer(a, premier, "email").expect(403);

    // RÉIMPORT : nouvelle ligne, nouvel identifiant, MÊMES coordonnées.
    await request(app).post("/api/prospection/importer").set("Cookie", a.cookie)
      .send({
        source: "fichier prescripteurs 2026-09",
        base: "INTERET_LEGITIME_PRO",
        contacts: [{ nom: "Réimporté", type: "PRO", email, telephone }],
      })
      .expect(201);

    const { body: liste } = await request(app).get("/api/prospection/contacts")
      .set("Cookie", a.cookie).expect(200);
    const reimporte = liste.contacts.find((c: { nom: string }) => c.nom === "Réimporté");
    expect(reimporte, "le contact réimporté doit exister").toBeDefined();

    // C'est LE test qui compte : une opposition rattachée à l'identifiant
    // aurait ressuscité la personne au premier réimport.
    for (const canal of ["email", "telephone", "courrier"]) {
      await envoyer(a, reimporte.id, canal).expect(403);
    }
    expect(reimporte.canaux).toEqual({ email: false, telephone: false, courrier: false });
  });

  test("l'opposition d'un tenant ne bloque pas chez un autre", async () => {
    // Les empreintes sont salées par tenant : incomparables d'un tenant à
    // l'autre, donc un tenant ne peut pas tester si une adresse figure dans
    // les oppositions d'un autre.
    const email = `croise-${crypto.randomBytes(4).toString("hex")}@example.test`;
    const chezA = await contactAvecBase(a, { type: "PRO", base: "INTERET_LEGITIME_PRO", email });
    const envoi = await envoyer(a, chezA, "email").expect(200);
    const jeton = String(envoi.body.lienOpposition).split("/").pop()!;
    await request(app).post(`/api/public/opposition/${jeton}`)
      .set("X-Forwarded-For", ipUnique()).expect(200);
    await envoyer(a, chezA, "email").expect(403);

    const chezB = await contactAvecBase(b, { type: "PRO", base: "INTERET_LEGITIME_PRO", email });
    await envoyer(b, chezB, "email").expect(200);
  });

  test("un jeton d'opposition inconnu → 404", async () => {
    await request(app).post(`/api/public/opposition/${crypto.randomUUID()}`)
      .set("X-Forwarded-For", ipUnique()).expect(404);
  });
});

// ── d. Seuil d'anonymat ─────────────────────────────────────────────────────

describe("d — seuil d'anonymat sur les signaux de zone", () => {
  test("quatre occurrences ne sortent pas, cinq oui", async () => {
    const t = await inscrire("signaux");
    const poser = async (ville: string, n: number) => {
      for (let i = 0; i < n; i++) {
        await request(app).post("/api/prospection/contacts").set("Cookie", t.cookie)
          .send({ nom: `C${i}`, type: "PRO", ville }).expect(201);
      }
    };
    await poser("Petite-Commune", 4);
    await poser("Grande-Commune", 5);

    const { body } = await request(app).get("/api/prospection/signaux")
      .set("Cookie", t.cookie).expect(200);

    const villes = body.signaux.map((s: { ville: string }) => s.ville);
    expect(villes).not.toContain("Petite-Commune");
    expect(villes).toContain("Grande-Commune");
    expect(body.seuilAnonymat).toBe(5);
    // Le nombre d'agrégats tus est DIT : se taire sans le dire ferait croire
    // qu'il n'y a rien.
    expect(body.agregatsTus).toBeGreaterThanOrEqual(1);
  });
});

// ── e. Aucun pixel ──────────────────────────────────────────────────────────

describe("e — aucun suivi d'ouverture", () => {
  test("un message sortant ne contient AUCUNE balise image", async () => {
    const id = await contactAvecBase(a, { type: "PRO", base: "INTERET_LEGITIME_PRO" });
    const { body } = await envoyer(a, id, "email").expect(200);

    // Les pixels de suivi sont soumis à consentement, y compris en B2B.
    expect(body.corps).not.toMatch(/<img/i);
    expect(body.corps).not.toMatch(/\.(gif|png|jpg)\b/i);
    expect(body.corps).not.toMatch(/tracking|pixel|open\.gif|beacon/i);
    // Le lien d'opposition, lui, est présent — en TEXTE, dans chaque message.
    expect(body.corps).toContain(body.lienOpposition);
  });

  test("aucune source du module ne construit de balise image", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const fichier of ["routes/prospection.ts", "lib/prospection.ts"]) {
      const source = readFileSync(resolve(__dirname, "..", fichier), "utf8");
      expect(source, `${fichier} contient une balise image`).not.toMatch(/<img\s/i);
    }
  });
});

// ── f & g. Isolation et immuabilité ─────────────────────────────────────────

describe("f — isolation, une table à la fois", () => {
  test.each(["contacts_prospection", "contact_bases", "oppositions"])(
    "la policy de `%s` refuse la lecture depuis un autre tenant",
    async (table) => {
      await contactAvecBase(a, { type: "PRO", base: "INTERET_LEGITIME_PRO" });
      const client = await adminPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE app_user");
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [b.tenantId]);
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1::uuid`, [a.tenantId]);
        expect(rows[0].n).toBe(0);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    },
  );

  test("le tenant B ne voit aucun contact de A", async () => {
    const idA = await contactAvecBase(a, { type: "PRO", base: "INTERET_LEGITIME_PRO" });
    const { body } = await request(app).get("/api/prospection/contacts")
      .set("Cookie", b.cookie).expect(200);
    // Sur les IDENTIFIANTS : la ville des fixtures est partagée, et B a le
    // droit d'avoir ses propres contacts à Marly-Gomont.
    expect(body.contacts.some((c: { id: string }) => c.id === idA)).toBe(false);
  });
});

describe("g — `contact_bases` et `oppositions` sont append-only", () => {
  test.each(["contact_bases", "oppositions"])(
    "%s : INSERT et SELECT passent, UPDATE et DELETE échouent en 42501",
    async (table) => {
      // Privilèges EFFECTIFS, avec la connexion applicative.
      const client = await adminPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE app_user");
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [a.tenantId]);
        await client.query(`SELECT count(*) FROM ${table}`);
        await expect(
          client.query(`UPDATE ${table} SET tenant_id = tenant_id`),
        ).rejects.toMatchObject({ code: "42501" });
        await client.query("ROLLBACK");

        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE app_user");
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [a.tenantId]);
        await expect(client.query(`DELETE FROM ${table}`)).rejects.toMatchObject({ code: "42501" });
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    },
  );

  test("les deux tables figurent dans APPEND_ONLY_TABLES de create-app-role.cjs", async () => {
    // Sans cette entrée, la prochaine exécution du script déferait la
    // révocation en silence.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(__dirname, "../../../../lib/db/scripts/create-app-role.cjs"), "utf8");
    const ligne = /const APPEND_ONLY_TABLES = \[([^\]]*)\]/.exec(source);
    expect(ligne).not.toBeNull();
    expect(ligne![1]).toContain("contact_bases");
    expect(ligne![1]).toContain("oppositions");
  });
});

// ── h. Purge ────────────────────────────────────────────────────────────────

describe("h — purge à trois ans, par le PROPRIÉTAIRE", () => {
  /**
   * La purge ne peut pas vivre dans une route : `contact_bases` est
   * append-only et `app_user` n'a pas le DELETE — c'est le moteur qui le tient.
   * Donner ce droit à `app_user` pour faire tenir la purge dans une route
   * aurait détruit l'append-only pour toutes les autres écritures.
   *
   * On éprouve donc le SCRIPT, avec le rôle propriétaire, comme pour la
   * rotation des clés.
   */
  const lancerPurge = async (jours: number) => {
    const { spawnSync } = await import("node:child_process");
    const { resolve } = await import("node:path");
    return spawnSync(
      process.execPath,
      ["lib/db/scripts/purger-prospection.mjs", "--jours", String(jours)],
      { cwd: resolve(__dirname, "../../../.."), encoding: "utf8", env: { ...process.env } },
    );
  };

  test("un contact sans interaction depuis plus de trois ans est supprimé", async () => {
    const t = await inscrire("purge");
    const vieux = await contactAvecBase(t, { type: "PRO", base: "INTERET_LEGITIME_PRO" });
    const recent = await contactAvecBase(t, { type: "PRO", base: "INTERET_LEGITIME_PRO" });

    const ilYaQuatreAns = toDateString(new Date(Date.now() - 4 * 365 * 86_400_000));
    await adminPool.query(
      `UPDATE contacts_prospection SET derniere_interaction_le = $1 WHERE id = $2`,
      [ilYaQuatreAns, vieux]);
    await adminPool.query(
      `UPDATE contacts_prospection SET derniere_interaction_le = CURRENT_DATE WHERE id = $1`,
      [recent]);

    const r = await lancerPurge(3 * 365);
    expect(r.status, r.stderr).toBe(0);
    // Un décompte, jamais un nom ni une adresse.
    expect(r.stdout).toMatch(/contacts supprimés: \d+/);
    expect(r.stdout).not.toContain("Marly-Gomont");

    const { rows } = await adminPool.query(
      `SELECT id FROM contacts_prospection WHERE tenant_id = $1::uuid`, [t.tenantId]);
    expect(rows.map((x) => x.id)).toEqual([recent]);

    // Les bases légales du contact partent avec lui : conserver la trace d'une
    // base pour une personne effacée reviendrait à conserver la personne.
    const bases = await adminPool.query(
      `SELECT count(*)::int n FROM contact_bases WHERE contact_id = $1`, [vieux]);
    expect(bases.rows[0].n).toBe(0);
  }, 60_000);

  test("un contact rattaché à un CLIENT est épargné", async () => {
    // Ce n'est plus de la prospection, c'est la relation client — et sa
    // conservation suit la durée comptable.
    const t = await inscrire("purge-client");
    const { body: client } = await request(app).post("/api/clients").set("Cookie", t.cookie)
      .send({ nom: "Dupont SARL", type: "PRO" }).expect(201);

    const id = crypto.randomUUID();
    await adminPool.query(
      `INSERT INTO contacts_prospection (id, tenant_id, client_id, nom, type, derniere_interaction_le)
       VALUES ($1, $2::uuid, $3, 'Dupont SARL', 'PRO', $4)`,
      [id, t.tenantId, client.id, toDateString(new Date(Date.now() - 5 * 365 * 86_400_000))]);

    const r = await lancerPurge(3 * 365);
    expect(r.status, r.stderr).toBe(0);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int n FROM contacts_prospection WHERE id = $1`, [id]);
    expect(rows[0].n).toBe(1);
  }, 60_000);

  test("l'aperçu annonce le nombre, et qui doit lancer la purge", async () => {
    const t = await inscrire("purge-apercu");
    const { body } = await request(app).get("/api/prospection/purge/apercu")
      .set("Cookie", t.cookie).expect(200);
    expect(body.retentionJours).toBe(3 * 365);
    expect(body.commande).toContain("purger-prospection.mjs");
  });
});
