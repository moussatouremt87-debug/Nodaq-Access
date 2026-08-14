/**
 * Prospection — sous-traitance depuis les attributions de marchés publics (DECP).
 *
 * Ce que ces tests protègent :
 *   — AUCUNE attribution sans source configurée, et le silence est expliqué ;
 *   — AUCUNE attribution sans zone renseignée, et le silence est expliqué ;
 *   — AUCUNE attribution sans métier mappé à des divisions CPV, et le
 *     silence est expliqué ;
 *   — le filtre de pertinence (divisions CPV) part réellement dans la requête ;
 *   — un agrégat sous le seuil d'anonymat est supprimé, et compté ;
 *   — AUCUN titulaire n'est jamais nommé tant que DECP_AFFICHER_TITULAIRES_PRO
 *     n'est pas activé — MÊME si le transport simulé renvoie des titulaires
 *     qu'on pourrait croire professionnels. C'est la garde centrale : les DECP
 *     ne portent aucun marqueur fiable personne physique/morale, donc rien ne
 *     doit fuir par défaut ;
 *   — la source est CITÉE dans la réponse ;
 *   — isolation entre tenants.
 *
 * Aucun test n'atteint le réseau : le transport est injecté.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";
import { creerRouteSousTraitance } from "../routes/prospection";
import type { TransportDecp } from "../lib/decp";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `decp-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

async function reglage(tenantId: string, cle: string, valeur: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, cle, valeur],
  );
}

function configurerSource(): void {
  process.env["DECP_BASE_URL"] = "http://decp.invalide.test";
  process.env["DECP_SOURCE_LABEL"] = "DECP";
  process.env["DECP_SOURCE_URL"] = "https://exemple.test/decp";
}

function retirerSource(): void {
  delete process.env["DECP_BASE_URL"];
  delete process.env["DECP_SOURCE_LABEL"];
  delete process.env["DECP_SOURCE_URL"];
  delete process.env["DECP_AFFICHER_TITULAIRES_PRO"];
}

function appAvec(transport: TransportDecp, tenantId: string) {
  const mini = express();
  mini.use((req, _res, next) => { req.tenantId = tenantId; next(); });
  mini.get("/sous-traitance", creerRouteSousTraitance(transport));
  return mini;
}

/** Six attributions dans le même secteur × zone : franchit le seuil de 5. */
const attributionsBrutes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    siretetablissement: `1234567890${i.toString().padStart(2, "0")}`.slice(0, 14),
    denominationsocialeetablissement: `TITULAIRE ${i} SAS`,
    codecpv: "45260000",
    lieuexecutionnom: "Marly-Gomont",
    codedepartementexecution: "02",
    montant: 50_000,
    datenotification: "2026-07-01",
    objetmarche: "Réfection de toiture",
  }));

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
  await reglage(a.tenantId, "company.adresse_ville", "Marly-Gomont");
  await reglage(a.tenantId, "company.adresse_cp", "02120");
  await reglage(a.tenantId, "votre-metier.metier", "batiment");
}, 90_000);

afterAll(async () => {
  retirerSource();
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("aucune attribution sans source configurée", () => {
  test("sans source : zéro agrégat, et la raison est DITE", async () => {
    retirerSource();
    const t: TransportDecp = async () => ({ status: 200, texte: JSON.stringify({ results: [] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/sous-traitance").expect(200);

    expect(body.agregats).toHaveLength(0);
    expect(body.raisonSilence).toBe("aucune_source");
    expect(body.messageSilence).toMatch(/source publique/i);
  });
});

describe("aucune attribution sans zone renseignée", () => {
  test("un tenant sans ville ni code postal n'obtient rien, et sait pourquoi", async () => {
    configurerSource();
    const t: TransportDecp = async () => ({ status: 200, texte: JSON.stringify({ results: attributionsBrutes(6) }) });
    const { body } = await request(appAvec(t, b.tenantId)).get("/sous-traitance").expect(200);

    expect(body.agregats).toHaveLength(0);
    expect(body.raisonSilence).toBe("zone_absente");
  });
});

describe("aucune attribution sans métier mappé", () => {
  test("un métier sans correspondance CPV établie n'obtient rien, et sait pourquoi", async () => {
    configurerSource();
    await reglage(b.tenantId, "company.adresse_ville", "Laon");
    await reglage(b.tenantId, "company.adresse_cp", "02000");
    await reglage(b.tenantId, "votre-metier.metier", "negoce");
    const t: TransportDecp = async () => ({ status: 200, texte: JSON.stringify({ results: attributionsBrutes(6) }) });
    const { body } = await request(appAvec(t, b.tenantId)).get("/sous-traitance").expect(200);

    expect(body.agregats).toHaveLength(0);
    expect(body.raisonSilence).toBe("secteur_non_couvert");
    expect(body.messageSilence).toMatch(/métier/i);
  });
});

describe("la requête part avec les divisions CPV du métier", () => {
  beforeAll(configurerSource);

  test("le filtre codecpv_division est dans l'URL appelée", async () => {
    let urlAppelee = "";
    const t: TransportDecp = async (url) => {
      urlAppelee = url;
      return { status: 200, texte: JSON.stringify({ results: [] }) };
    };
    await request(appAvec(t, a.tenantId)).get("/sous-traitance").expect(200);

    expect(decodeURIComponent(urlAppelee)).toMatch(/codecpv_division="45"/);
  });
});

describe("seuil d'anonymat", () => {
  beforeAll(configurerSource);

  test("sous le seuil : l'agrégat est supprimé, et compté", async () => {
    const t: TransportDecp = async () => ({ status: 200, texte: JSON.stringify({ results: attributionsBrutes(3) }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/sous-traitance").expect(200);

    expect(body.agregats).toHaveLength(0);
    expect(body.agregatsTus).toBe(1);
    expect(body.seuilAnonymat).toBe(5);
  });

  test("au-dessus du seuil : l'agrégat est publié, SANS aucun titulaire nommé", async () => {
    const t: TransportDecp = async () => ({ status: 200, texte: JSON.stringify({ results: attributionsBrutes(6) }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/sous-traitance").expect(200);

    expect(body.agregats).toHaveLength(1);
    expect(body.agregats[0].occurrences).toBe(6);
    expect(JSON.stringify(body.agregats)).not.toMatch(/TITULAIRE/);
  });
});

describe("aucun titulaire nommé sans activation explicite", () => {
  beforeAll(configurerSource);

  test("titulairesProfessionnels reste VIDE par défaut, même avec des données exploitables", async () => {
    delete process.env["DECP_AFFICHER_TITULAIRES_PRO"];
    const t: TransportDecp = async () => ({ status: 200, texte: JSON.stringify({ results: attributionsBrutes(6) }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/sous-traitance").expect(200);

    expect(body.titulairesProfessionnels).toHaveLength(0);
    expect(JSON.stringify(body)).not.toMatch(/TITULAIRE 0 SAS/);
  });

  test("activé explicitement : les titulaires sont nommés, et la source citée", async () => {
    process.env["DECP_AFFICHER_TITULAIRES_PRO"] = "true";
    const t: TransportDecp = async () => ({ status: 200, texte: JSON.stringify({ results: attributionsBrutes(6) }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/sous-traitance").expect(200);

    expect(body.titulairesProfessionnels.length).toBe(6);
    expect(body.titulairesProfessionnels[0].titulaireNom).toBe("TITULAIRE 0 SAS");
    expect(body.titulairesProfessionnels[0].source.label).toBe("DECP");
    delete process.env["DECP_AFFICHER_TITULAIRES_PRO"];
  });
});

describe("isolation", () => {
  test("les agrégats d'un tenant dépendent de SES réglages", async () => {
    configurerSource();
    await reglage(b.tenantId, "company.adresse_ville", "Laon");
    await reglage(b.tenantId, "company.adresse_cp", "02000");
    await reglage(b.tenantId, "votre-metier.metier", "maintenance");
    const t: TransportDecp = async () => ({ status: 200, texte: JSON.stringify({ results: attributionsBrutes(6) }) });

    const rA = await request(appAvec(t, a.tenantId)).get("/sous-traitance").expect(200);
    const rB = await request(appAvec(t, b.tenantId)).get("/sous-traitance").expect(200);
    expect(rA.body.raisonSilence).toBeNull();
    expect(rB.body.raisonSilence).toBeNull();
  });
});

describe("le registre des traitements est à jour dans cette PR", () => {
  test("une entrée couvre la sous-traitance depuis les DECP", async () => {
    const { PROCESSING_TEMPLATES, RGPD_REGISTER_VERSION } = await import("@nodaq/shared");
    const entree = PROCESSING_TEMPLATES.find((t) => t.id === "prospection-sous-traitance-decp");

    expect(entree, "aucune entrée « prospection-sous-traitance-decp » au registre").toBeDefined();
    expect(entree!.legalBasis).toBe("interet_legitime");
    expect(entree!.purpose).toMatch(/entrepreneur individuel/i);
    expect(entree!.source.url).toMatch(/^https?:\/\//);
    expect(RGPD_REGISTER_VERSION >= "2026-08-12").toBe(true);
  });
});
