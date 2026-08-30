/**
 * Enrôlement automatique du domaine d'envoi.
 *
 * AUCUN TEST N'ATTEINT LE RÉSEAU : le transport HTTP est injecté, comme le
 * résolveur DNS de la vérification. Les réponses du fournisseur sont
 * construites à la main.
 *
 * Ce que ces tests protègent :
 *   — la configuration absente rend 503, et le chemin MANUEL reste ouvert ;
 *   — une réponse de forme inattendue est REFUSÉE, jamais devinée ;
 *   — la clé d'API n'apparaît dans AUCUNE réponse ni aucun journal ;
 *   — l'enrôlement ne marque JAMAIS le domaine vérifié ;
 *   — isolation : l'enrôlement d'un tenant n'écrit rien chez un autre.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";
import { creerRouteEnrolement } from "../routes/parametres-envoi";
import {
  enrolerDomaine,
  configTem,
  TemConfigError,
  TemEnrolementError,
  type TransportTem,
} from "../lib/tem";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
let a: Locataire;
let b: Locataire;

/** Une clé d'API tirée au sort : jamais de valeur ressemblant à une vraie. */
const CLE = `test-${crypto.randomBytes(16).toString("hex")}`;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `tem-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app)).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(serveurTest(app)).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

async function poserDomaine(l: Locataire, domaine: string): Promise<void> {
  await request(serveurTest(app)).put("/api/parametres-envoi").set("Cookie", l.cookie)
    .send({ mode: "domaine_authentifie", domaine, emailExpediteur: `contact@${domaine}` })
    .expect(200);
}

/** Une application minimale qui monte la route avec un transport simulé. */
function appAvecTransport(transport: TransportTem, tenantId: string) {
  const mini = express();
  mini.use(express.json());
  mini.use((req, _res, next) => { req.tenantId = tenantId; next(); });
  mini.post("/enroler", creerRouteEnrolement(transport));
  return mini;
}

const reponseOk = (selecteur = "nodaq01", cle = "v=DKIM1; k=rsa; p=MIIBIjAN…"): TransportTem =>
  async () => ({ status: 200, texte: JSON.stringify({ dkim_config: { selector: selecteur, public_key: cle } }) });

/**
 * ── CHAQUE TEST PART D'UN ENVIRONNEMENT CONNU ───────────────────────────────
 *
 * Ce fichier écrivait `process.env.TEM_*` test par test, sans jamais remettre
 * l'état d'origine. `process.env` est un GLOBAL de processus, et
 * `fileParallelism` est actif : plusieurs fichiers de test partagent le même
 * worker, donc les mêmes variables.
 *
 * Le 30/08/2026, « sans TEM_API_KEY, idem » a échoué une fois sur une dizaine
 * de passes complètes, sous Europe/Paris, et n'a pas été reproduit depuis. Je
 * n'ai donc PAS établi l'entrelacement exact — et je ne l'invente pas ici.
 *
 * Ce qui est certain se corrige quand même : un test dont le résultat dépend
 * de ce qu'un voisin a laissé dans l'environnement n'est pas un test, c'est un
 * tirage. La remise à zéro ci-dessous rend chaque cas autonome, et la
 * restauration finale rend le fichier inoffensif pour les autres.
 *
 * Surtout PAS de `retry` : une garde du dépôt l'interdit, et l'épisode lui
 * donne raison — un flottement masqué aurait laissé ce défaut en place.
 */
const ENV_TEM = ["TEM_BASE_URL", "TEM_API_KEY", "TEM_PROJECT_ID"] as const;
const envInitial = new Map<string, string | undefined>();

beforeEach(() => {
  for (const cle of ENV_TEM) delete process.env[cle];
});

beforeAll(async () => {
  for (const cle of ENV_TEM) envInitial.set(cle, process.env[cle]);
  a = await inscrire("a");
  b = await inscrire("b");
  await poserDomaine(a, "toituremartin.fr");
  await poserDomaine(b, "platrerie-durand.fr");
}, 90_000);

afterAll(async () => {
  // L'environnement est rendu tel qu'il a été trouvé : les autres fichiers du
  // même worker ne doivent rien hériter d'ici.
  for (const [cle, valeur] of envInitial) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
  await adminPool.query(`DELETE FROM parametres_envoi WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── Configuration ───────────────────────────────────────────────────────────

describe("configuration absente → 503, et le manuel reste ouvert", () => {
  test("sans TEM_BASE_URL, la route rend 503 et NOMME la variable", async () => {
    delete process.env["TEM_BASE_URL"];
    process.env["TEM_API_KEY"] = CLE;

    const r = await request(appAvecTransport(reponseOk(), a.tenantId)).post("/enroler").expect(503);
    expect(r.body.variableManquante).toBe("TEM_BASE_URL");
    // Le chemin manuel reste proposé : on ne remplace pas une béquille par un trou.
    expect(r.body.replManuel).toBe(true);
  });

  test("sans TEM_API_KEY, idem", async () => {
    process.env["TEM_BASE_URL"] = "http://tem.invalide.test";
    delete process.env["TEM_API_KEY"];

    /*
     * ── CE CAS A FLOTTÉ, ET LA CAUSE N'EST PAS ÉTABLIE ─────────────────────
     *
     * Il a échoué une fois le 30/08/2026 sur une dizaine de passes complètes,
     * sous Europe/Paris, et n'a jamais été reproduit depuis — ni en isolation,
     * ni en passe complète.
     *
     * Ce qu'on sait : ce test supprime lui-même la variable juste avant la
     * requête, et aucun AUTRE fichier du dépôt ne la pose. L'explication
     * évidente — un voisin qui la réécrit — ne tient donc pas.
     *
     * Plutôt que d'inventer une cause ou de masquer le cas par un `retry`
     * (qu'une garde du dépôt interdit), on rend le prochain échec DIAGNOSTIQUE.
     * Le message dira ce qui a réellement été observé.
     *
     * La valeur de la clé n'est JAMAIS affichée — seulement sa présence.
     */
    const observe = () =>
      `clé définie : ${process.env["TEM_API_KEY"] !== undefined} · ` +
      `base définie : ${process.env["TEM_BASE_URL"] !== undefined}`;

    const r = await request(appAvecTransport(reponseOk(), a.tenantId)).post("/enroler");
    expect(r.status, `attendu 503 — ${observe()} · corps : ${JSON.stringify(r.body)}`).toBe(503);
    expect(r.body.variableManquante, `${observe()}`).toBe("TEM_API_KEY");
  });

  test("la CLÉ n'apparaît dans aucune réponse", async () => {
    process.env["TEM_BASE_URL"] = "http://tem.invalide.test";
    process.env["TEM_API_KEY"] = CLE;
    const r = await request(appAvecTransport(reponseOk(), a.tenantId)).post("/enroler").expect(200);
    expect(JSON.stringify(r.body)).not.toContain(CLE);
  });

  test("la clé part dans l'EN-TÊTE, et nulle part ailleurs", async () => {
    process.env["TEM_BASE_URL"] = "http://tem.invalide.test";
    process.env["TEM_API_KEY"] = CLE;
    let vu: { url: string; headers: Record<string, string>; body: string } | null = null;
    const transport: TransportTem = async (url, init) => {
      vu = { url, headers: init.headers, body: init.body };
      return { status: 200, texte: JSON.stringify({ dkim_config: { selector: "s", public_key: "p" } }) };
    };
    await enrolerDomaine("toituremartin.fr", transport);

    expect(vu!.headers["X-Auth-Token"]).toBe(CLE);
    // Le CORPS ne porte que le domaine : une clé recopiée dans le corps
    // finirait dans les journaux d'accès du fournisseur.
    expect(vu!.body).not.toContain(CLE);
    expect(vu!.body).toContain("toituremartin.fr");
    // L'URL vient de la configuration, jamais d'une constante du code.
    expect(vu!.url).toBe("http://tem.invalide.test/domains");
  });
});

// ── Formes de réponse ───────────────────────────────────────────────────────

describe("la réponse du fournisseur est validée, jamais devinée", () => {
  // `beforeEach` et non `beforeAll` : la remise à zéro du fichier s'exécute
  // avant chaque test, et un `beforeAll` ne repasserait jamais derrière elle.
  beforeEach(() => {
    process.env["TEM_BASE_URL"] = "http://tem.invalide.test";
    process.env["TEM_API_KEY"] = CLE;
  });

  test.each([
    ["dkim_config", { dkim_config: { selector: "sel1", public_key: "cle1" } }],
    ["dkim", { dkim: { selector: "sel1", public_key: "cle1" } }],
    ["à plat", { dkim_selector: "sel1", dkim_public_key: "cle1" }],
  ])("forme « %s » → acceptée", async (_nom, charge) => {
    const t: TransportTem = async () => ({ status: 200, texte: JSON.stringify(charge) });
    const r = await enrolerDomaine("toituremartin.fr", t);
    expect(r).toEqual({ selecteur: "sel1", valeur: "cle1" });
  });

  test("une forme INCONNUE est refusée, et le message dit quels champs sont arrivés", async () => {
    // On refuse plutôt que de deviner : un enrôlement qu'on croirait réussi
    // ferait publier un DKIM inexistant, et les devis partiraient en
    // indésirables sans que personne comprenne.
    const t: TransportTem = async () => ({
      status: 200,
      texte: JSON.stringify({ id: "abc", name: "toituremartin.fr", statut: "pending" }),
    });
    await expect(enrolerDomaine("toituremartin.fr", t)).rejects.toThrow(TemEnrolementError);
    await expect(enrolerDomaine("toituremartin.fr", t)).rejects.toThrow(/id, name, statut/);
  });

  test("le message d'erreur ne recrache PAS les valeurs reçues", async () => {
    const t: TransportTem = async () => ({
      status: 200,
      texte: JSON.stringify({ jeton_interne: "SECRET-A-NE-PAS-DIVULGUER" }),
    });
    try {
      await enrolerDomaine("toituremartin.fr", t);
      throw new Error("aurait dû échouer");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      expect(m).toContain("jeton_interne");           // le NOM du champ
      expect(m).not.toContain("SECRET-A-NE-PAS-DIVULGUER"); // jamais sa valeur
    }
  });

  test("un code d'erreur ne fait pas fuiter le corps de la réponse", async () => {
    const t: TransportTem = async () => ({
      status: 401,
      texte: JSON.stringify({ message: "invalid token", token_echo: CLE }),
    });
    try {
      await enrolerDomaine("toituremartin.fr", t);
      throw new Error("aurait dû échouer");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      expect(m).toContain("401");
      expect(m).not.toContain(CLE);
    }
  });

  test("une réponse qui n'est pas du JSON est refusée", async () => {
    const t: TransportTem = async () => ({ status: 200, texte: "<html>502 Bad Gateway</html>" });
    await expect(enrolerDomaine("x.fr", t)).rejects.toThrow(TemEnrolementError);
  });

  test("un transport injoignable rend une erreur d'enrôlement, pas un plantage", async () => {
    const t: TransportTem = async () => { throw new Error("ECONNREFUSED"); };
    await expect(enrolerDomaine("x.fr", t)).rejects.toThrow(TemEnrolementError);
  });
});

// ── Effets en base ──────────────────────────────────────────────────────────

describe("ce que l'enrôlement écrit — et ce qu'il n'écrit pas", () => {
  // `beforeEach` et non `beforeAll` : la remise à zéro du fichier s'exécute
  // avant chaque test, et un `beforeAll` ne repasserait jamais derrière elle.
  beforeEach(() => {
    process.env["TEM_BASE_URL"] = "http://tem.invalide.test";
    process.env["TEM_API_KEY"] = CLE;
  });

  test("le sélecteur et la clé PUBLIQUE sont rangés", async () => {
    const r = await request(appAvecTransport(reponseOk("nodaq07", "v=DKIM1; p=ABC"), a.tenantId))
      .post("/enroler").expect(200);
    expect(r.body.enrole).toBe(true);
    expect(r.body.dkimSelecteur).toBe("nodaq07");

    const { rows } = await adminPool.query(
      `SELECT dkim_selecteur, dkim_valeur, verifie_le FROM parametres_envoi WHERE tenant_id = $1::uuid`,
      [a.tenantId],
    );
    expect(rows[0].dkim_selecteur).toBe("nodaq07");
    expect(rows[0].dkim_valeur).toBe("v=DKIM1; p=ABC");
  });

  test("L'ENRÔLEMENT NE MARQUE JAMAIS LE DOMAINE VÉRIFIÉ", async () => {
    // Il dit seulement que le fournisseur connaît le domaine et a émis une clé.
    // Il ne dit RIEN de ce qui est publié dans le DNS. Confondre les deux ferait
    // expédier depuis un domaine dont SPF et DKIM ne sont pas en place — pire
    // que le repli, parce que l'artisan croirait avoir envoyé.
    await adminPool.query(
      `UPDATE parametres_envoi SET verifie_le = NOW() WHERE tenant_id = $1::uuid`, [a.tenantId]);

    await request(appAvecTransport(reponseOk("nouveau"), a.tenantId)).post("/enroler").expect(200);

    const { rows } = await adminPool.query(
      `SELECT verifie_le FROM parametres_envoi WHERE tenant_id = $1::uuid`, [a.tenantId]);
    // Un nouvel enrôlement REMET la vérification à zéro : la clé a changé, ce
    // qui est publié dans le DNS ne correspond plus.
    expect(rows[0].verifie_le).toBeNull();
  });

  test("sans domaine renseigné → 409, et rien n'est appelé", async () => {
    const t = vi.fn(async () => ({ status: 200, texte: "{}" }));
    const sansDomaine = await inscrire("sans-domaine");
    await request(appAvecTransport(t as unknown as TransportTem, sansDomaine.tenantId))
      .post("/enroler").expect(409);
    expect(t).not.toHaveBeenCalled();
  });

  test("l'enrôlement d'un tenant n'écrit rien chez un autre", async () => {
    const avant = await adminPool.query(
      `SELECT dkim_selecteur FROM parametres_envoi WHERE tenant_id = $1::uuid`, [b.tenantId]);

    await request(appAvecTransport(reponseOk("pour-a"), a.tenantId)).post("/enroler").expect(200);

    const apres = await adminPool.query(
      `SELECT dkim_selecteur FROM parametres_envoi WHERE tenant_id = $1::uuid`, [b.tenantId]);
    expect(apres.rows[0].dkim_selecteur).toBe(avant.rows[0].dkim_selecteur);
    expect(apres.rows[0].dkim_selecteur).not.toBe("pour-a");
  });
});

// ── Garde de configuration ──────────────────────────────────────────────────

describe("aucune URL de fournisseur en dur", () => {
  test("le module ne contient aucune URL absolue", async () => {
    // Même doctrine que `LLM_BASE_URL` : une URL écrite en dur produit du code
    // qui PARAÎT juste et échoue en production, d'autant que les tests, qui
    // simulent le transport, resteraient verts.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(resolve(__dirname, "../lib/tem.ts"), "utf8");
    // Le retrait des commentaires de ligne EXIGE que « // » ne soit pas précédé
    // de « : ». Sans cette précaution il mange le « // » de « https:// », et la
    // garde ne peut alors JAMAIS se déclencher : elle détruit exactement ce
    // qu'elle cherche. Découvert en la cassant exprès — une URL écrite en dur
    // passait au vert.
    const sansCommentaires = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/gm, "$1");
    expect(sansCommentaires).not.toMatch(/https?:\/\/[a-z0-9.-]+/i);
  });

  test("`configTem` lève quand la configuration manque, sans citer la clé", () => {
    const sauve = process.env["TEM_API_KEY"];
    process.env["TEM_BASE_URL"] = "http://tem.invalide.test";
    process.env["TEM_API_KEY"] = "";
    try {
      expect(() => configTem()).toThrow(TemConfigError);
      // Le message nomme la VARIABLE, jamais sa valeur.
      try { configTem(); } catch (err) {
        expect((err as TemConfigError).variableManquante).toBe("TEM_API_KEY");
      }
    } finally {
      if (sauve !== undefined) process.env["TEM_API_KEY"] = sauve;
    }
  });
});
