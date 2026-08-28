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
import { departementBoamp } from "../lib/boamp";

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
  code_departement: ["2"],
  datelimitereponse: "2026-09-15",
  dateparution: "2026-08-20",
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


// ── Ce que l'écran montrait vraiment ─────────────────────────────────────────
//
// Signalé par le fondateur le 28/08/2026 : « les appels d'offres datent de
// 2017 2020 et 2019, rien de récent ». Confronté à la source le jour même,
// trois défauts distincts sont sortis, tous dans la construction de l'URL.
describe("le département tel que le BOAMP l'écrit", () => {
  /*
   * LE défaut invisible. Le BOAMP stocke les départements métropolitains SANS
   * zéro initial. Mesuré sur la source le 28/08/2026 :
   *
   *     code_departement="02" → 0 avis      code_departement="2" → 19 243
   *     code_departement="06" → 0 avis      code_departement="6" → 44 287
   *
   * Un artisan des départements 01 à 09 voyait un écran vide EN PERMANENCE,
   * sous un message lui affirmant que rien n'était publié dans sa zone. Aucun
   * signal ne pouvait le trahir : zéro résultat est une réponse valide.
   */
  test("les départements 01 à 09 perdent leur zéro initial", () => {
    expect(departementBoamp("02120")).toBe("2");   // Aisne
    expect(departementBoamp("06000")).toBe("6");   // Alpes-Maritimes
    expect(departementBoamp("01000")).toBe("1");   // Ain
    expect(departementBoamp("09000")).toBe("9");   // Ariège
  });

  test("les autres départements métropolitains sont inchangés", () => {
    expect(departementBoamp("35000")).toBe("35");
    expect(departementBoamp("59000")).toBe("59");
    expect(departementBoamp("75001")).toBe("75");
  });

  test("outre-mer : trois chiffres", () => {
    expect(departementBoamp("97100")).toBe("971");  // Guadeloupe
    expect(departementBoamp("97400")).toBe("974");  // La Réunion
    expect(departementBoamp("98800")).toBe("988");  // Nouvelle-Calédonie
  });

  /*
   * Le BOAMP écrit la Corse « 20A » et « 20B » — relevé dans sa facette : ni
   * « 2A », ni « 2B », ni « 20 » ne rendent quoi que ce soit. Le code postal
   * ne dit pas de façon fiable duquel des deux il relève. On refuse, comme
   * `departementDepuisCodePostal` le fait déjà pour les permis.
   */
  test("Corse : REFUSÉE plutôt que devinée", () => {
    expect(departementBoamp("20000")).toBeNull();
    expect(departementBoamp("20200")).toBeNull();
  });

  test("ce qui n'est pas un code postal ne donne rien", () => {
    expect(departementBoamp(null)).toBeNull();
    expect(departementBoamp("")).toBeNull();
    expect(departementBoamp("2")).toBeNull();
    expect(departementBoamp("Marly-Gomont")).toBeNull();
  });
});

describe("la requête qui part réellement au BOAMP", () => {
  beforeAll(configurerSource);

  async function urlDe(tenantId: string): Promise<string> {
    let urlAppelee = "";
    const t: TransportBoamp = async (url) => {
      urlAppelee = url;
      return { status: 200, texte: JSON.stringify({ results: [] }) };
    };
    await request(appAvec(t, tenantId)).get("/appels-offres").expect(200);
    return decodeURIComponent(urlAppelee);
  }

  /** Le tenant `a` est à Marly-Gomont, 02120 : le cas qui rendait zéro. */
  test("le département part SANS zéro initial", async () => {
    const url = await urlDe(a.tenantId);
    expect(url).toContain('code_departement="2"');
    expect(url).not.toContain('code_departement="02"');
  });

  /*
   * Sans `order_by`, cette API rend sa page dans l'ordre naturel du jeu, le
   * plus ANCIEN d'abord : le tout premier enregistrement date de 2015, sur
   * 1 701 268 avis. C'est la cause directe de « rien de récent ».
   */
  test("les avis sont triés du plus récemment publié au plus ancien", async () => {
    expect(await urlDe(a.tenantId)).toContain("order_by=dateparution DESC");
  });

  /*
   * Un avis dont la date limite est passée n'est pas « moins intéressant » :
   * il est inexploitable. La borne est calculée en UTC — la CI exécute la
   * suite sous trois fuseaux, et une date locale la ferait basculer d'un jour
   * selon celui qui tourne.
   */
  test("seuls les avis encore ouverts à la réponse sont demandés", async () => {
    const url = await urlDe(a.tenantId);
    /*
     * On vérifie la FORME de la borne, pas sa valeur.
     *
     * Recalculer la date attendue ici la ferait diverger de celle du module
     * si l'horloge franchit minuit entre les deux appels — un flottement
     * rare, jamais reproductible, et que le dépôt interdit de masquer par un
     * `retry`. La garde qui compte est que le filtre SOIT LÀ et bien formé ;
     * que la borne soit le bon jour relève de `toDateString`, éprouvée
     * ailleurs.
     */
    expect(url).toMatch(/datelimitereponse>=date'\d{4}-\d{2}-\d{2}'/);
  });

  /** Sans `limit`, cette API en rend DIX ; 100 est son maximum. */
  test("la page demandée est explicite", async () => {
    expect(await urlDe(a.tenantId)).toContain("limit=100");
  });

  /*
   * La Corse ne déclenche AUCUN appel : demander la France entière plutôt que
   * rien remplirait l'écran d'avis de l'autre bout du pays, ce qui est pire
   * qu'un écran vide — l'artisan croirait à des chantiers près de chez lui.
   */
  test("un département indevinable ne déclenche aucun appel", async () => {
    await reglage(a.tenantId, "company.code_postal", "20000");
    let appele = false;
    const t: TransportBoamp = async (url) => {
      appele = true;
      return { status: 200, texte: JSON.stringify({ results: [] }) };
    };
    const { body } = await request(appAvec(t, a.tenantId)).get("/appels-offres").expect(200);

    expect(appele).toBe(false);
    expect(body.marches).toHaveLength(0);
    await reglage(a.tenantId, "company.code_postal", "02120");
  });
});

describe("la date de parution voyage jusqu'à l'écran", () => {
  beforeAll(configurerSource);

  /*
   * C'est LA question que l'artisan se pose devant cette liste — « est-ce
   * récent ? ». Elle n'était nulle part dans la réponse.
   */
  test("un avis porte sa date de publication", async () => {
    const t: TransportBoamp = async () => ({ status: 200, texte: JSON.stringify({ results: [marcheBrut()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/appels-offres").expect(200);

    expect(body.marches).toHaveLength(1);
    expect(body.marches[0].dateParution).toBe("2026-08-20");
  });

  test("un avis sans date de publication reste rendu, sans elle", async () => {
    const sansDate = { ...marcheBrut(), dateparution: null };
    const t: TransportBoamp = async () => ({ status: 200, texte: JSON.stringify({ results: [sansDate] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/appels-offres").expect(200);

    expect(body.marches).toHaveLength(1);
    expect(body.marches[0].dateParution).toBeNull();
  });
});
