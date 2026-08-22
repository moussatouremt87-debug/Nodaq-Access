/**
 * Magasin de secrets — bout en bout, sur une vraie base.
 *
 * Ce que ces tests protègent :
 *   a. RIEN EN CLAIR EN BASE — après enregistrement d'un mot de passe SMTP, une
 *      requête SQL directe ne trouve la valeur nulle part, et la colonne
 *      respecte le format « v1: » ;
 *   b. rien en clair dans la RÉPONSE HTTP non plus — un booléen, pas une valeur ;
 *   c. ISOLATION — les secrets du tenant A sont invisibles du tenant B, y
 *      compris en recopiant le chiffré à la main ;
 *   d. JOURNALISATION — une sentinelle n'apparaît ni en clair ni chiffrée dans
 *      les journaux, y compris sur le chemin d'ERREUR ;
 *   e. ROTATION — un secret écrit en version 1 est déchiffrable en version 2 ;
 *      relancé, le script ne retouche rien ;
 *   f. DÉMARRAGE — sans ENCRYPTION_KEY le serveur s'arrête, et le test vérifie
 *      le CODE DE SORTIE, pas seulement un message.
 *
 * La sentinelle est engendrée à chaque exécution : une constante finirait par
 * ressembler à un vrai secret, et par être cherchée dans de vrais journaux.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

const RACINE = resolve(__dirname, "../../../..");

/** Un secret jamais vu ailleurs — on le traque ensuite partout. */
const sentinelle = (): string => `SENTINELLE-${randomBytes(12).toString("hex")}`;

const nouvelleCle = (): string => randomBytes(32).toString("base64");

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

async function inscrire(nom: string): Promise<Locataire> {
  const email = `secrets-${nom}-${Date.now()}-${randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(serveurTest(app)).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

/** Enregistre un SMTP complet, mot de passe compris. */
function poserSmtp(l: Locataire, motDePasse: string): request.Test {
  return request(serveurTest(app))
    .put("/api/parametres-envoi")
    .set("Cookie", l.cookie)
    .send({
      mode: "smtp_artisan",
      emailExpediteur: "contact@toituremartin.fr",
      nomExpediteur: "Toiture Martin",
      smtpHote: "smtp.toituremartin.fr",
      smtpPort: 587,
      smtpUtilisateur: "contact@toituremartin.fr",
      smtpMotDePasse: motDePasse,
    });
}

let a: Locataire;
let b: Locataire;

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
}, 90_000);

afterAll(async () => {
  await adminPool.query(`DELETE FROM tenant_secrets WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  await adminPool.query(`DELETE FROM parametres_envoi WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a & b. Rien en clair, ni en base ni dans la réponse ──────────────────────

describe("a — rien en clair en base", () => {
  test("après enregistrement, la valeur est introuvable dans toute la base", async () => {
    const secret = sentinelle();
    await poserSmtp(a, secret).expect(200);

    // On ne regarde pas seulement `valeur_chiffree` : on aplatit TOUTE la ligne
    // en JSON. Un mot de passe recopié par mégarde dans une autre colonne — ou
    // dans `parametres_envoi` — serait attrapé ici et pas par une assertion
    // ciblée sur une colonne.
    const { rows } = await adminPool.query(
      `SELECT to_jsonb(t) AS ligne FROM tenant_secrets t WHERE tenant_id = $1::uuid`,
      [a.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].ligne)).not.toContain(secret);

    const params = await adminPool.query(
      `SELECT to_jsonb(t) AS ligne FROM parametres_envoi t WHERE tenant_id = $1::uuid`,
      [a.tenantId],
    );
    expect(JSON.stringify(params.rows[0].ligne)).not.toContain(secret);
  });

  test("la colonne respecte le format « v1:<version>:<iv>:<tag>:<chiffre> »", async () => {
    const { rows } = await adminPool.query(
      `SELECT valeur_chiffree, version_cle, cle FROM tenant_secrets WHERE tenant_id = $1::uuid`,
      [a.tenantId],
    );
    expect(rows[0].cle).toBe("envoi.smtp_password");
    expect(rows[0].version_cle).toBe(1);
    const parts = String(rows[0].valeur_chiffree).split(":");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toBe("1");
    // Les trois segments sont bien du base64 non vide.
    for (const p of parts.slice(2)) {
      expect(Buffer.from(p, "base64").length).toBeGreaterThan(0);
    }
  });
});

describe("b — rien en clair dans la réponse HTTP", () => {
  test("l'écriture rend un BOOLÉEN, jamais la valeur ni une version étoilée", async () => {
    const secret = sentinelle();
    const reponse = await poserSmtp(a, secret).expect(200);
    expect(JSON.stringify(reponse.body)).not.toContain(secret);
    expect(reponse.body.smtpMotDePasseEnregistre).toBe(true);
    // Et surtout : aucun champ ne porte le mot de passe, même masqué.
    expect(reponse.body).not.toHaveProperty("smtpMotDePasse");
  });

  test("la lecture non plus", async () => {
    const { body } = await request(serveurTest(app))
      .get("/api/parametres-envoi")
      .set("Cookie", a.cookie)
      .expect(200);
    expect(body.smtpMotDePasseEnregistre).toBe(true);
    expect(body.parametres.smtpHote).toBe("smtp.toituremartin.fr");
    expect(body.parametres).not.toHaveProperty("smtpMotDePasse");
  });

  test("`null` révoque le secret", async () => {
    await request(serveurTest(app))
      .put("/api/parametres-envoi")
      .set("Cookie", b.cookie)
      .send({
        mode: "smtp_artisan",
        emailExpediteur: "contact@b.fr",
        smtpHote: "smtp.b.fr",
        smtpUtilisateur: "contact@b.fr",
        smtpMotDePasse: sentinelle(),
      })
      .expect(200);

    const revoque = await request(serveurTest(app))
      .put("/api/parametres-envoi")
      .set("Cookie", b.cookie)
      .send({
        mode: "smtp_artisan",
        emailExpediteur: "contact@b.fr",
        smtpHote: "smtp.b.fr",
        smtpUtilisateur: "contact@b.fr",
        smtpMotDePasse: null,
      })
      .expect(200);
    expect(revoque.body.smtpMotDePasseEnregistre).toBe(false);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM tenant_secrets WHERE tenant_id = $1::uuid`,
      [b.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});

// ── c. Isolation ─────────────────────────────────────────────────────────────

describe("c — isolation entre tenants", () => {
  test("le tenant B ne voit pas le secret du tenant A", async () => {
    await poserSmtp(a, sentinelle()).expect(200);
    const { body } = await request(serveurTest(app))
      .get("/api/parametres-envoi")
      .set("Cookie", b.cookie)
      .expect(200);
    expect(body.smtpMotDePasseEnregistre).toBe(false);
  });

  test("la RLS refuse de lire la ligne de A depuis le contexte de B", async () => {
    // Sonde au niveau moteur, par la connexion applicative : c'est la policy
    // qu'on éprouve, pas le code de la route.
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_user");
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [b.tenantId]);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM tenant_secrets WHERE tenant_id = $1::uuid`,
        [a.tenantId],
      );
      expect(rows[0].n).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  test("un chiffré de A recopié sur la ligne de B ne se déchiffre PAS", async () => {
    // L'attaque que l'AAD arrête : quelqu'un qui obtient l'écriture en base
    // recopie le chiffré de A chez B pour se servir de ses identifiants. La RLS
    // ne l'arrête pas — elle ne protège que les LECTURES applicatives.
    const { rows } = await adminPool.query(
      `SELECT valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle = 'envoi.smtp_password'`,
      [a.tenantId],
    );
    const chiffreDeA = rows[0].valeur_chiffree as string;

    await adminPool.query(
      `INSERT INTO tenant_secrets (tenant_id, cle, valeur_chiffree, version_cle)
       VALUES ($1::uuid, 'envoi.smtp_password', $2, 1)
       ON CONFLICT (tenant_id, cle) DO UPDATE SET valeur_chiffree = EXCLUDED.valeur_chiffree`,
      [b.tenantId, chiffreDeA],
    );

    const { lireSecret } = await import("../lib/tenant-secrets.js");
    await expect(lireSecret(b.tenantId, "envoi.smtp_password")).rejects.toThrow(
      /Déchiffrement impossible/,
    );

    await adminPool.query(`DELETE FROM tenant_secrets WHERE tenant_id = $1::uuid`, [b.tenantId]);
  });
});

// ── d. Journalisation ────────────────────────────────────────────────────────

describe("d — la sentinelle n'atteint jamais un journal", () => {
  test("ni sur le chemin nominal, ni sur le chemin d'erreur", async () => {
    const secret = sentinelle();
    const capture: string[] = [];
    const happer = (...args: unknown[]) => {
      capture.push(args.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    };
    const espions = [
      vi.spyOn(console, "log").mockImplementation(happer),
      vi.spyOn(console, "error").mockImplementation(happer),
      vi.spyOn(console, "warn").mockImplementation(happer),
      vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => {
        capture.push(String(s));
        return true;
      }) as typeof process.stdout.write),
      vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => {
        capture.push(String(s));
        return true;
      }) as typeof process.stderr.write),
    ];

    let chiffre = "";
    try {
      // Chemin nominal : écriture puis lecture.
      await poserSmtp(a, secret);
      const { lireSecret } = await import("../lib/tenant-secrets.js");
      await lireSecret(a.tenantId, "envoi.smtp_password");

      // Chemin d'ERREUR : on altère le chiffré, la lecture doit lever — c'est
      // exactement le moment où un message d'erreur bavard recracherait la
      // valeur ou le chiffré.
      const { rows } = await adminPool.query(
        `SELECT valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid`,
        [a.tenantId],
      );
      chiffre = rows[0].valeur_chiffree as string;
      const parts = chiffre.split(":");
      const octets = Buffer.from(parts[4]!, "base64");
      octets[0] = octets[0]! ^ 0xff;
      parts[4] = octets.toString("base64");
      await adminPool.query(
        `UPDATE tenant_secrets SET valeur_chiffree = $1 WHERE tenant_id = $2::uuid`,
        [parts.join(":"), a.tenantId],
      );
      await lireSecret(a.tenantId, "envoi.smtp_password").catch(() => undefined);
    } finally {
      for (const e of espions) e.mockRestore();
    }

    const journaux = capture.join("\n");
    expect(journaux).not.toContain(secret);
    // Ni le chiffré : il n'est pas exploitable seul, mais il n'a rien à faire
    // dans un journal non plus — c'est la moitié d'un secret.
    if (chiffre) expect(journaux).not.toContain(chiffre);
    expect(journaux).not.toContain(process.env["ENCRYPTION_KEY"]);

    // Remettre un secret sain pour les tests suivants.
    await poserSmtp(a, sentinelle());
  });
});

// ── e. Rotation ──────────────────────────────────────────────────────────────

describe("e — rotation de la clé", () => {
  /**
   * CE TEST JUGE LA SORTIE GLOBALE DU SCRIPT, donc il exige une base dont TOUS
   * les secrets sont lisibles avec les deux clés fournies.
   *
   * `rotate-encryption-key.mjs` traverse tous les tenants — c'est son rôle — et
   * sort en 1 dès qu'une ligne résiste. Une ligne laissée par une exécution
   * interrompue, chiffrée avec une clé morte, fait donc échouer ce test sans
   * qu'il y ait de défaut. En CI la base est neuve à chaque exécution ; en
   * local, purger `tenant_secrets` avant de relancer.
   *
   * Découvert en ajoutant les jetons de devis au magasin : le test tenait par
   * chance tant qu'il était le seul à y écrire.
   */
  test("version 1 → version 2, puis relance sans effet", async () => {
    const rotation = await inscrire("rot");
    const secret = sentinelle();
    await poserSmtp(rotation, secret).expect(200);

    const ancienne = process.env["ENCRYPTION_KEY"]!;
    const nouvelle = nouvelleCle();

    const lancer = () =>
      spawnSync(process.execPath, ["lib/db/scripts/rotate-encryption-key.mjs"], {
        cwd: RACINE,
        encoding: "utf8",
        env: {
          ...process.env,
          ENCRYPTION_KEY: nouvelle,
          ENCRYPTION_KEY_PREVIOUS: ancienne,
        },
      });

    const premier = lancer();
    expect(premier.status, premier.stderr).toBe(0);
    expect(premier.stdout).toMatch(/tournés: [1-9]/);
    // Le script n'affiche AUCUNE valeur — seulement des décomptes.
    expect(premier.stdout).not.toContain(secret);
    expect(premier.stdout).not.toContain(nouvelle);
    expect(premier.stdout).not.toContain(ancienne);

    const apres = await adminPool.query(
      `SELECT version_cle, valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid`,
      [rotation.tenantId],
    );
    expect(apres.rows[0].version_cle).toBe(2);
    expect(String(apres.rows[0].valeur_chiffree).startsWith("v1:2:")).toBe(true);

    // Le secret se relit bien avec la NOUVELLE clé, et vaut toujours la même
    // chose : une rotation qui perd la valeur est pire qu'une rotation ratée.
    process.env["ENCRYPTION_KEY"] = nouvelle;
    process.env["ENCRYPTION_KEY_PREVIOUS"] = ancienne;
    try {
      const { lireSecret } = await import("../lib/tenant-secrets.js");
      await expect(lireSecret(rotation.tenantId, "envoi.smtp_password")).resolves.toBe(secret);
    } finally {
      process.env["ENCRYPTION_KEY"] = ancienne;
      delete process.env["ENCRYPTION_KEY_PREVIOUS"];
    }

    // IDEMPOTENCE : relancé, il ne retouche rien.
    const second = lancer();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/tournés: 0/);

    const inchange = await adminPool.query(
      `SELECT version_cle, valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid`,
      [rotation.tenantId],
    );
    expect(inchange.rows[0].version_cle).toBe(2);
    expect(inchange.rows[0].valeur_chiffree).toBe(apres.rows[0].valeur_chiffree);
  }, 60_000);

  test("deux clés identiques : le script refuse au lieu de ne rien faire", () => {
    const k = nouvelleCle();
    const r = spawnSync(process.execPath, ["lib/db/scripts/rotate-encryption-key.mjs"], {
      cwd: RACINE,
      encoding: "utf8",
      env: { ...process.env, ENCRYPTION_KEY: k, ENCRYPTION_KEY_PREVIOUS: k },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("identiques");
  }, 30_000);
});

// ── f. Démarrage ─────────────────────────────────────────────────────────────

describe("f — le serveur refuse de démarrer sans clé", () => {
  /** Lance le vrai point d'entrée et rend son code de sortie. */
  function demarrer(env: Record<string, string | undefined>) {
    const complet: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...process.env, ...env })) {
      if (v !== undefined) complet[k] = v;
    }
    return spawnSync("npx", ["tsx", "src/index.ts"], {
      cwd: resolve(RACINE, "artifacts/api-server"),
      encoding: "utf8",
      env: complet,
      timeout: 60_000,
    });
  }

  test("sans ENCRYPTION_KEY : code de sortie non nul", () => {
    const r = demarrer({ PORT: "45991", PUBLIC_URL: "http://localhost", ENCRYPTION_KEY: undefined });
    // Le CODE, pas seulement le message : un serveur qui écrit une erreur puis
    // continue de servir est exactement ce qu'on refuse.
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("ENCRYPTION_KEY");
    expect(`${r.stdout}${r.stderr}`).not.toContain("Server listening");
  }, 90_000);

  test("avec une clé MAL FORMÉE : même refus, et la valeur n'est pas recrachée", () => {
    const fautive = Buffer.alloc(16, 3).toString("base64");
    const r = demarrer({ PORT: "45992", PUBLIC_URL: "http://localhost", ENCRYPTION_KEY: fautive });
    expect(r.status).not.toBe(0);
    const sortie = `${r.stdout}${r.stderr}`;
    expect(sortie).toContain("ENCRYPTION_KEY");
    expect(sortie).not.toContain(fautive);
    expect(sortie).not.toContain("Server listening");
  }, 90_000);

  test("en production, sans APP_URL : code de sortie non nul — sinon les liens clients repartent vers nodaq.fr en silence", () => {
    const r = demarrer({
      PORT: "45993",
      PUBLIC_URL: "http://localhost",
      NODE_ENV: "production",
      APP_URL: undefined,
    });
    expect(r.status).not.toBe(0);
    const sortie = `${r.stdout}${r.stderr}`;
    expect(sortie).toContain("APP_URL");
    expect(sortie).not.toContain("Server listening");
  }, 90_000);
});
