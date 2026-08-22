/**
 * Prospection — avis de marchés publics (BOAMP).
 *
 * Ce que ces tests protègent :
 *   — AUCUN marché sans source configurée, et le silence est expliqué ;
 *   — AUCUN marché sans zone renseignée, et le silence est expliqué ;
 *   — AUCUN marché sans métier mappé à des codes de marché public, et le
 *     silence est expliqué — un menuisier ne doit jamais voir des résultats
 *     non filtrés sous prétexte que son métier n'a pas de correspondance ;
 *   — le filtre de pertinence (mots-clés) part réellement dans la requête ;
 *   — la source est CITÉE dans la réponse, pas seulement stockée ;
 *   — isolation entre tenants.
 *
 * Aucun test n'atteint le réseau : le transport est injecté. Le BOAMP est la
 * source la plus simple du lot — aucune personne physique n'y apparaît
 * jamais, donc aucun test de garde d'anonymisation ici (contrairement à DECP
 * et RNIC).
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";
import { creerRouteAppelsOffres } from "../routes/prospection";
import type { TransportBoamp } from "../lib/boamp";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `boamp-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
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

async function reglage(tenantId: string, cle: string, valeur: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, cle, valeur],
  );
}

function configurerSource(): void {
  process.env["BOAMP_BASE_URL"] = "http://boamp.invalide.test";
  process.env["BOAMP_SOURCE_LABEL"] = "BOAMP";
  process.env["BOAMP_SOURCE_URL"] = "https://exemple.test/boamp";
}

function retirerSource(): void {
  delete process.env["BOAMP_BASE_URL"];
  delete process.env["BOAMP_SOURCE_LABEL"];
  delete process.env["BOAMP_SOURCE_URL"];
}

function appAvec(transport: TransportBoamp, tenantId: string) {
  const mini = express();
  mini.use((req, _res, next) => { req.tenantId = tenantId; next(); });
  mini.get("/appels-offres", creerRouteAppelsOffres(transport));
  return mini;
}

const marcheBrut = () => ({
  objet: "Réfection de toiture — école primaire",
  nomacheteur: "Commune de Marly-Gomont",
  cpv: ["45260000"],
  code_departement: ["02"],
  datelimitereponse: "2026-09-15",
  nature_libelle: "Avis de marché",
});

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
  await reglage(a.tenantId, "company.commune", "Marly-Gomont");
  await reglage(a.tenantId, "company.code_postal", "02120");
  // `votre-metier.metier`, pas `metier.secteur` : c'est la clé que l'écran
  // « Votre métier » pose réellement — voir le commentaire dans
  // creerRouteAppelsOffres.
  await reglage(a.tenantId, "votre-metier.metier", "batiment");
}, 90_000);

afterAll(async () => {
  retirerSource();
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("aucun marché sans source configurée", () => {
  test("sans source : zéro marché, et la raison est DITE", async () => {
    retirerSource();
    const t: TransportBoamp = async () => ({ status: 200, texte: JSON.stringify({ results: [] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/appels-offres").expect(200);

    expect(body.marches).toHaveLength(0);
    expect(body.raisonSilence).toBe("aucune_source");
    expect(body.messageSilence).toMatch(/source publique/i);
  });
});

describe("aucun marché sans zone renseignée", () => {
  test("un tenant sans ville ni code postal n'obtient rien, et sait pourquoi", async () => {
    configurerSource();
    const t: TransportBoamp = async () => ({ status: 200, texte: JSON.stringify({ results: [marcheBrut()] }) });
    const { body } = await request(appAvec(t, b.tenantId)).get("/appels-offres").expect(200);

    expect(body.marches).toHaveLength(0);
    expect(body.raisonSilence).toBe("zone_absente");
  });
});

describe("aucun marché sans métier mappé", () => {
  test("un métier sans correspondance CPV établie n'obtient rien, et sait pourquoi", async () => {
    configurerSource();
    await reglage(b.tenantId, "company.commune", "Laon");
    await reglage(b.tenantId, "company.code_postal", "02000");
    await reglage(b.tenantId, "votre-metier.metier", "retail");
    const t: TransportBoamp = async () => ({ status: 200, texte: JSON.stringify({ results: [marcheBrut()] }) });
    const { body } = await request(appAvec(t, b.tenantId)).get("/appels-offres").expect(200);

    expect(body.marches).toHaveLength(0);
    expect(body.raisonSilence).toBe("secteur_non_couvert");
    expect(body.messageSilence).toMatch(/métier/i);
  });
});

describe("avec source, zone et métier mappé", () => {
  beforeAll(configurerSource);

  test("les marchés sont rendus, et la source est CITÉE", async () => {
    const t: TransportBoamp = async () => ({ status: 200, texte: JSON.stringify({ results: [marcheBrut()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/appels-offres").expect(200);

    expect(body.raisonSilence).toBeNull();
    expect(body.marches).toHaveLength(1);
    expect(body.marches[0].objet).toBe("Réfection de toiture — école primaire");
    expect(body.marches[0].source.label).toBe("BOAMP");
    expect(body.avertissement).toMatch(/organismes publics/i);
  });

  test("la requête part avec les mots-clés du métier, en recherche plein texte", async () => {
    let urlAppelee = "";
    const t: TransportBoamp = async (url) => {
      urlAppelee = url;
      return { status: 200, texte: JSON.stringify({ results: [] }) };
    };
    await request(appAvec(t, a.tenantId)).get("/appels-offres").expect(200);

    // search(objet, "terme") DANS where= — pas un paramètre q= séparé,
    // confirmé ignoré par cette API lors d'un accès réel.
    expect(decodeURIComponent(urlAppelee)).toContain('search(objet,"bâtiment")');
  });

  test("une réponse de forme inconnue est REFUSÉE, jamais devinée", async () => {
    const t: TransportBoamp = async () => ({ status: 200, texte: JSON.stringify({ items: [marcheBrut()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/appels-offres").expect(502);
    expect(body.error).toMatch(/items/);
  });
});

describe("isolation", () => {
  test("les marchés d'un tenant dépendent de SES réglages", async () => {
    configurerSource();
    await reglage(b.tenantId, "company.commune", "Laon");
    await reglage(b.tenantId, "company.code_postal", "02000");
    await reglage(b.tenantId, "votre-metier.metier", "maintenance");
    const t: TransportBoamp = async () => ({ status: 200, texte: JSON.stringify({ results: [marcheBrut()] }) });

    const rA = await request(appAvec(t, a.tenantId)).get("/appels-offres").expect(200);
    const rB = await request(appAvec(t, b.tenantId)).get("/appels-offres").expect(200);
    expect(rA.body.raisonSilence).toBeNull();
    expect(rB.body.raisonSilence).toBeNull();
  });
});
