/**
 * US-A7.4 — Attestation de souveraineté, vérifiable et non périmable.
 *
 * Ce que ces tests protègent :
 *   a. AC1/AC2 — l'artisan produit lui-même le document, sans écrire au
 *      support : un PDF non vide, à son nom, listant les sous-traitants ;
 *   b. la distinction VÉRIFIÉ / DÉCLARÉ figure noir sur blanc. C'est ce qui
 *      sépare cette attestation du « document marketing déconnecté de
 *      l'architecture réelle » que le point d'attention de la story refuse ;
 *   c. AC3, LE CŒUR — quand la destination réellement configurée diverge de
 *      ce que le registre déclare, la route REFUSE d'émettre. Le document ne
 *      peut donc pas devenir silencieusement faux : il disparaît d'abord ;
 *   d. aucun secret ne fuit dans un document destiné à circuler chez un tiers ;
 *   e. la comparaison elle-même, testée en pur, sans toucher à l'environnement.
 *
 * ── Sur la manipulation de `LLM_BASE_URL` ────────────────────────────────
 * `vitest.setup.ts` pointe le modèle sur `fake-llm.internal.test`. C'est un
 * hôte qui DIVERGE du registre — l'état par défaut de la suite est donc le
 * refus. Les cas nominaux repositionnent la variable sur la valeur de
 * production le temps de l'appel, et la restaurent systématiquement : la
 * suite tourne en `singleFork`, une variable laissée en travers empoisonnerait
 * les fichiers suivants.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import {
  SOUS_TRAITANTS,
  divergencesSouverainete,
  hoteDeUrl,
  hoteAttendu,
} from "@nodaq/shared";
import {
  adminPool,
  cookieHeader,
  createTestUser,
  createTestMembership,
  createTestSession,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  texteBrut,
} from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];

let ownerCookie: string;
let tenantId: string;

/** L'URL que la configuration de production porte, telle que le registre l'attend. */
const URL_PRODUCTION = `https://${hoteAttendu("modele-ia")}/v1`;
const URL_TEST = process.env["LLM_BASE_URL"]!;

/** Exécute `action` avec `LLM_BASE_URL` posée à `url`, puis restaure. */
async function avecLlmBaseUrl<T>(url: string | undefined, action: () => Promise<T>): Promise<T> {
  const avant = process.env["LLM_BASE_URL"];
  if (url === undefined) delete process.env["LLM_BASE_URL"];
  else process.env["LLM_BASE_URL"] = url;
  try {
    return await action();
  } finally {
    if (avant === undefined) delete process.env["LLM_BASE_URL"];
    else process.env["LLM_BASE_URL"] = avant;
  }
}

const demanderAttestation = (cookie: string) =>
  request(app).get("/api/souverainete/attestation").set("Cookie", cookie);

beforeAll(async () => {
  const email = `a74-owner-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({
      email,
      password: "test-pass-1234",
      nom: "Patron A74",
      tenantNom: "Charpente Dubois",
    })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
  ownerCookie = reg.headers["set-cookie"][0];

  for (const [cle, valeur] of [
    ["company.raison_sociale", "Charpente Dubois SARL"],
    ["company.siret", "44556677889900"],
    ["company.adresse", "12 rue des Compagnons"],
    ["company.code_postal", "31000"],
    ["company.commune", "Toulouse"],
  ]) {
    await adminPool.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [tenantId, cle, valeur],
    );
  }
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. AC1/AC2 — le document se produit seul ───────────────────────────────

describe("a — AC1/AC2 : l'attestation se télécharge sans passer par le support", () => {
  test("un PDF non vide, servi comme tel", async () => {
    const r = await avecLlmBaseUrl(URL_PRODUCTION, () =>
      demanderAttestation(ownerCookie).expect(200),
    );
    expect(r.headers["content-type"]).toContain("application/pdf");
    expect(r.headers["content-disposition"]).toContain(".pdf");
    // Un corps vide passerait sans ce contrôle : le type MIME ne prouve rien.
    expect(r.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.body.length).toBeGreaterThan(1000);
  });

  test("il porte le nom de l'entreprise et son SIRET", async () => {
    const r = await avecLlmBaseUrl(URL_PRODUCTION, () =>
      demanderAttestation(ownerCookie).expect(200),
    );
    const texte = texteBrut(r.body as Buffer);
    expect(texte).toContain("Charpente Dubois SARL");
    expect(texte).toContain("44556677889900");
    expect(texte).toContain("Toulouse");
  });

  test("chaque sous-traitant déclaré figure au document", async () => {
    // Le registre est la source ; le test le PARCOURT plutôt que de recopier
    // trois lignes. Un sous-traitant ajouté demain sans être imprimé fera
    // tomber ce test — c'est exactement ce qu'on veut protéger.
    const r = await avecLlmBaseUrl(URL_PRODUCTION, () =>
      demanderAttestation(ownerCookie).expect(200),
    );
    const texte = texteBrut(r.body as Buffer);
    for (const st of SOUS_TRAITANTS) {
      // Un fragment du rôle plutôt que le rôle entier : pdfkit coupe les
      // longues lignes, et une coupure tomberait au milieu de la chaîne
      // cherchée. Le début suffit à distinguer les trois.
      expect(texte, `sous-traitant « ${st.id} » absent du document`).toContain(st.role.slice(0, 20));
    }
    // L'hôte réellement constaté pour le modèle, imprimé tel quel.
    expect(texte).toContain(hoteAttendu("modele-ia")!);
  });
});

// ── b. Vérifié vs déclaré ──────────────────────────────────────────────────

describe("b — le document distingue ce qu'il constate de ce qu'il déclare", () => {
  test("les deux niveaux de preuve sont nommés", async () => {
    const r = await avecLlmBaseUrl(URL_PRODUCTION, () =>
      demanderAttestation(ownerCookie).expect(200),
    );
    const texte = texteBrut(r.body as Buffer);
    expect(texte).toContain("Ce qui est v");        // « Ce qui est vérifié… »
    expect(texte).toContain("RIFI");                // « VÉRIFIÉ À L'ÉMISSION »
    expect(texte).toContain("CLAR");                // « DÉCLARÉ PAR L'ÉDITEUR »
  });

  test("aucune certification n'est revendiquée", async () => {
    // Une attestation qui s'attribuerait HDS ou SecNumCloud serait fausse, et
    // fausse au pire endroit : dans un dossier de marché public.
    const r = await avecLlmBaseUrl(URL_PRODUCTION, () =>
      demanderAttestation(ownerCookie).expect(200),
    );
    const texte = texteBrut(r.body as Buffer);
    expect(texte).toContain("revendique");          // « ne revendique aucune certification »
    expect(texte).toContain("aucune certification");
  });
});

// ── c. AC3 — le refus d'émettre ────────────────────────────────────────────

describe("c — AC3 : le document ne peut pas se périmer en silence", () => {
  test("destination repointée ailleurs → 409, et AUCUN PDF", async () => {
    const r = await avecLlmBaseUrl("https://modele.example.com/v1", () =>
      demanderAttestation(ownerCookie),
    );
    expect(r.status).toBe(409);
    expect(r.headers["content-type"]).not.toContain("application/pdf");
    // Le message nomme les deux hôtes : sans cela, l'utilisateur ne saurait
    // pas quoi faire remonter à l'éditeur.
    expect(r.body.error).toContain("modele.example.com");
    expect(r.body.error).toContain(hoteAttendu("modele-ia")!);
  });

  test("la configuration de la suite diverge déjà — l'attestation est refusée par défaut", async () => {
    // `vitest.setup.ts` pointe sur un faux modèle. Sans intervention, le
    // document n'est pas produit : la garde n'a pas besoin d'être armée à la
    // main pour agir.
    expect(hoteDeUrl(URL_TEST)).not.toBe(hoteAttendu("modele-ia"));
    const r = await demanderAttestation(ownerCookie);
    expect(r.status).toBe(409);
  });

  test("une fois la configuration remise en ligne avec le registre, le document repart", async () => {
    const r = await avecLlmBaseUrl(URL_PRODUCTION, () => demanderAttestation(ownerCookie));
    expect(r.status).toBe(200);
  });

  test("destination absente → 503, pas un PDF muet", async () => {
    const r = await avecLlmBaseUrl(undefined, () => demanderAttestation(ownerCookie));
    expect(r.status).toBe(503);
    expect(r.body.error).toBeTruthy();
  });
});

// ── d. Aucun secret dans un document qui circule ───────────────────────────

describe("d — le document ne transporte aucun secret", () => {
  test("ni clé d'API, ni URL complète, ni chaîne de connexion", async () => {
    const r = await avecLlmBaseUrl(URL_PRODUCTION, () =>
      demanderAttestation(ownerCookie).expect(200),
    );
    const texte = texteBrut(r.body as Buffer);

    expect(texte).not.toContain(process.env["LLM_API_KEY"]!);
    // L'HÔTE est imprimé, jamais l'URL entière : le chemin appartient à la
    // configuration, pas au donneur d'ordre.
    expect(texte).not.toContain(URL_PRODUCTION);
    expect(texte).not.toContain("postgres://");
    expect(texte).not.toContain("postgresql://");
    for (const marqueur of ["LLM_API_KEY", "ENCRYPTION_KEY", "DATABASE_URL"]) {
      expect(texte, `${marqueur} n'a rien à faire dans ce document`).not.toContain(marqueur);
    }
  });
});

// ── e. Le périmètre d'accès ────────────────────────────────────────────────

describe("e — l'attestation engage l'entreprise : elle reste au dirigeant", () => {
  test("un MEMBER ne peut pas la produire", async () => {
    const email = `a74-membre-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
    emails.push(email);
    const user = await createTestUser(email);
    await createTestMembership(user.id, tenantId, "MEMBER");
    await adminPool.query(`UPDATE users SET mfa_enabled_at = now() WHERE id = $1`, [user.id]);
    const session = await createTestSession(user.id, tenantId);

    const r = await avecLlmBaseUrl(URL_PRODUCTION, () =>
      demanderAttestation(cookieHeader(session.id)),
    );
    expect(r.status).toBe(403);
  });
});

// ── f. La comparaison, en pur ──────────────────────────────────────────────

describe("f — la comparaison d'hôtes se tient seule", () => {
  test("un hôte conforme ne produit aucune divergence", () => {
    expect(divergencesSouverainete({ LLM_BASE_URL: URL_PRODUCTION })).toEqual([]);
  });

  test("un port ajouté est une divergence — un hôte, c'est aussi son port", () => {
    const d = divergencesSouverainete({ LLM_BASE_URL: `https://${hoteAttendu("modele-ia")}:8443/v1` });
    expect(d).toHaveLength(1);
    expect(d[0]!.observe).toBe(`${hoteAttendu("modele-ia")}:8443`);
  });

  test("une variable absente ou illisible est une divergence, pas un silence", () => {
    expect(divergencesSouverainete({})[0]!.observe).toBeNull();
    expect(divergencesSouverainete({ LLM_BASE_URL: "pas-une-url" })[0]!.observe).toBeNull();
  });

  test("hoteDeUrl se comporte comme URL.host", () => {
    expect(hoteDeUrl("https://API.Scaleway.AI/v1")).toBe("api.scaleway.ai");
    expect(hoteDeUrl("http://user:pass@interne.test:9000/x")).toBe("interne.test:9000");
    expect(hoteDeUrl(undefined)).toBeUndefined();
    expect(hoteDeUrl("")).toBeUndefined();
  });

  test("tout sous-traitant qui déclare un hôte attendu déclare aussi sa variable", () => {
    // Sans variable, l'hôte attendu ne serait comparé à rien : la garde
    // paraîtrait armée tout en ne protégeant personne.
    for (const st of SOUS_TRAITANTS) {
      if (st.hoteAttendu) expect(st.variableEnv, `« ${st.id} »`).toBeTruthy();
    }
  });
});
