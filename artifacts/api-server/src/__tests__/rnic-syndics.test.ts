/**
 * Prospection — syndics de copropriété (RNIC).
 *
 * Ce que ces tests protègent :
 *   — AUCUN syndic sans source configurée, et le silence est expliqué ;
 *   — AUCUN syndic sans zone renseignée, et le silence est expliqué ;
 *   — un agrégat de syndics BÉNÉVOLES sous le seuil d'anonymat est supprimé,
 *     et compté ;
 *   — AUCUN syndic bénévole n'est JAMAIS nommé, quel que soit le réglage ;
 *   — syndicsProfessionnels reste VIDE tant que RNIC_AFFICHER_SYNDICS_PRO
 *     n'est pas activé — même si le transport simulé renvoie des syndics
 *     marqués professionnels ;
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
import { adminPool, cleanupTenants, cleanupUsers } from "./helpers";
import { creerRouteSyndics } from "../routes/prospection";
import type { TransportRnic } from "../lib/rnic-syndics";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `rnic-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
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
  process.env["RNIC_BASE_URL"] = "http://rnic.invalide.test";
  process.env["RNIC_SOURCE_LABEL"] = "RNIC";
  process.env["RNIC_SOURCE_URL"] = "https://exemple.test/rnic";
}

function retirerSource(): void {
  delete process.env["RNIC_BASE_URL"];
  delete process.env["RNIC_SOURCE_LABEL"];
  delete process.env["RNIC_SOURCE_URL"];
  delete process.env["RNIC_AFFICHER_SYNDICS_PRO"];
}

function appAvec(transport: TransportRnic, tenantId: string) {
  const mini = express();
  mini.use((req, _res, next) => { req.tenantId = tenantId; next(); });
  mini.get("/syndics", creerRouteSyndics(transport));
  return mini;
}

const syndicsBenevoles = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    commune: "Marly-Gomont",
    code_postal: "02120",
    type_syndic: "benevole",
    nom_syndic: `M. Résident ${i}`,
  }));

const syndicProfessionnel = () => ({
  commune: "Marly-Gomont",
  code_postal: "02120",
  type_syndic: "professionnel",
  denomination_syndic: "FONCIA MARLY",
});

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
  await reglage(a.tenantId, "company.adresse_ville", "Marly-Gomont");
  await reglage(a.tenantId, "company.adresse_cp", "02120");
}, 90_000);

afterAll(async () => {
  retirerSource();
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("aucun syndic sans source configurée", () => {
  test("sans source : zéro agrégat, et la raison est DITE", async () => {
    retirerSource();
    const t: TransportRnic = async () => ({ status: 200, texte: JSON.stringify({ results: [] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/syndics").expect(200);

    expect(body.agregats).toHaveLength(0);
    expect(body.raisonSilence).toBe("aucune_source");
    expect(body.messageSilence).toMatch(/source publique/i);
  });
});

describe("aucun syndic sans zone renseignée", () => {
  test("un tenant sans ville ni code postal n'obtient rien, et sait pourquoi", async () => {
    configurerSource();
    const t: TransportRnic = async () => ({ status: 200, texte: JSON.stringify({ results: syndicsBenevoles(6) }) });
    const { body } = await request(appAvec(t, b.tenantId)).get("/syndics").expect(200);

    expect(body.agregats).toHaveLength(0);
    expect(body.raisonSilence).toBe("zone_absente");
  });
});

describe("un syndic bénévole n'est jamais nommé", () => {
  beforeAll(configurerSource);

  test("sous le seuil : l'agrégat est supprimé, et compté", async () => {
    const t: TransportRnic = async () => ({ status: 200, texte: JSON.stringify({ results: syndicsBenevoles(3) }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/syndics").expect(200);

    expect(body.agregats).toHaveLength(0);
    expect(body.agregatsTus).toBe(1);
  });

  test("au-dessus du seuil : publié en agrégat, sans AUCUN nom", async () => {
    const t: TransportRnic = async () => ({ status: 200, texte: JSON.stringify({ results: syndicsBenevoles(6) }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/syndics").expect(200);

    expect(body.agregats).toHaveLength(1);
    expect(body.agregats[0].occurrences).toBe(6);
    expect(JSON.stringify(body)).not.toMatch(/Résident/);
  });

  test("même RNIC_AFFICHER_SYNDICS_PRO activé, un bénévole n'apparaît jamais dans syndicsProfessionnels", async () => {
    process.env["RNIC_AFFICHER_SYNDICS_PRO"] = "true";
    const t: TransportRnic = async () => ({ status: 200, texte: JSON.stringify({ results: syndicsBenevoles(6) }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/syndics").expect(200);

    expect(body.syndicsProfessionnels).toHaveLength(0);
    delete process.env["RNIC_AFFICHER_SYNDICS_PRO"];
  });
});

describe("aucun syndic professionnel nommé sans activation explicite", () => {
  beforeAll(configurerSource);

  test("syndicsProfessionnels reste VIDE par défaut, même avec un syndic exploitable", async () => {
    delete process.env["RNIC_AFFICHER_SYNDICS_PRO"];
    const t: TransportRnic = async () => ({ status: 200, texte: JSON.stringify({ results: [syndicProfessionnel()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/syndics").expect(200);

    expect(body.syndicsProfessionnels).toHaveLength(0);
    expect(JSON.stringify(body)).not.toMatch(/FONCIA/);
  });

  test("activé explicitement : le syndic professionnel est nommé, et la source citée", async () => {
    process.env["RNIC_AFFICHER_SYNDICS_PRO"] = "true";
    const t: TransportRnic = async () => ({ status: 200, texte: JSON.stringify({ results: [syndicProfessionnel()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/syndics").expect(200);

    expect(body.syndicsProfessionnels).toHaveLength(1);
    expect(body.syndicsProfessionnels[0].nomSyndic).toBe("FONCIA MARLY");
    expect(body.syndicsProfessionnels[0].source.label).toBe("RNIC");
    delete process.env["RNIC_AFFICHER_SYNDICS_PRO"];
  });
});

describe("isolation", () => {
  test("les agrégats d'un tenant dépendent de SES réglages", async () => {
    configurerSource();
    await reglage(b.tenantId, "company.adresse_ville", "Laon");
    await reglage(b.tenantId, "company.adresse_cp", "02000");
    const t: TransportRnic = async () => ({ status: 200, texte: JSON.stringify({ results: syndicsBenevoles(6) }) });

    const rA = await request(appAvec(t, a.tenantId)).get("/syndics").expect(200);
    const rB = await request(appAvec(t, b.tenantId)).get("/syndics").expect(200);
    expect(rA.body.raisonSilence).toBeNull();
    expect(rB.body.raisonSilence).toBeNull();
  });
});

describe("le registre des traitements est à jour dans cette PR", () => {
  test("une entrée couvre le repérage de syndics depuis le RNIC", async () => {
    const { PROCESSING_TEMPLATES, RGPD_REGISTER_VERSION } = await import("@nodaq/shared");
    const entree = PROCESSING_TEMPLATES.find((t) => t.id === "prospection-syndics-rnic");

    expect(entree, "aucune entrée « prospection-syndics-rnic » au registre").toBeDefined();
    expect(entree!.legalBasis).toBe("interet_legitime");
    expect(entree!.purpose).toMatch(/bénévoles/i);
    expect(entree!.source.url).toMatch(/^https?:\/\//);
    expect(RGPD_REGISTER_VERSION >= "2026-08-12").toBe(true);
  });
});
