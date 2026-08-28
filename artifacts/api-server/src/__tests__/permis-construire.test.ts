/**
 * Prospection — permis de construire (Sitadel).
 *
 * Ce que ces tests protègent :
 *   — AUCUN permis sans source configurée, et le silence est expliqué ;
 *   — AUCUN permis sans zone renseignée, et le silence est expliqué ;
 *   — un demandeur PARTICULIER n'apparaît QUE dans `informationsParticuliers`
 *     — nom et adresse, jamais téléphone ni e-mail, jamais dans
 *     `pistesProfessionnelles` ;
 *   — `pistesProfessionnelles` reste VIDE tant que PERMIS_AFFICHER_PISTES_PRO
 *     n'est pas activé, même si le transport simulé renvoie un demandeur
 *     marqué personne morale ;
 *   — un particulier N'EST JAMAIS gaté par PERMIS_AFFICHER_PISTES_PRO : il
 *     reste une information dans les deux états du réglage ;
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
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";
import { creerRoutePermis } from "../routes/prospection";
import type { TransportPermis } from "../lib/permis-construire";
import { departementDepuisCodePostal } from "../lib/permis-construire";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `permis-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
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
  process.env["PERMIS_BASE_URL"] = "http://permis.invalide.test";
  process.env["PERMIS_API_KEY"] = "cle-de-test";
  process.env["PERMIS_SOURCE_LABEL"] = "Sitadel";
  process.env["PERMIS_SOURCE_URL"] = "https://exemple.test/sitadel";
}

function retirerSource(): void {
  delete process.env["PERMIS_BASE_URL"];
  delete process.env["PERMIS_API_KEY"];
  delete process.env["PERMIS_SOURCE_LABEL"];
  delete process.env["PERMIS_SOURCE_URL"];
  delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
}

function appAvec(transport: TransportPermis, tenantId: string) {
  const mini = express();
  mini.use((req, _res, next) => { req.tenantId = tenantId; next(); });
  mini.get("/permis", creerRoutePermis(transport));
  return mini;
}

const permisParticulier = () => ({
  numero: "PC-002-001",
  nature: "Rénovation toiture",
  nom_demandeur: "Mme Bernard",
  adresse: "5 rue des Ardoises",
  code_postal: "02120",
  commune: "Marly-Gomont",
  date_octroi: "2026-07-10",
});

const permisProfessionnel = () => ({
  numero: "PC-002-002",
  nature: "Extension commerciale",
  raison_sociale: "BATIPRO SAS",
  type_demandeur: "personne morale",
  adresse: "8 rue de l'Industrie",
  code_postal: "02120",
  commune: "Marly-Gomont",
  date_octroi: "2026-07-12",
});

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
  await reglage(a.tenantId, "company.commune", "Marly-Gomont");
  await reglage(a.tenantId, "company.code_postal", "02120");
}, 90_000);

afterAll(async () => {
  retirerSource();
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("aucun permis sans source configurée", () => {
  test("sans source : listes vides, et la raison est DITE", async () => {
    retirerSource();
    const t: TransportPermis = async () => ({ status: 200, texte: JSON.stringify({ results: [] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(0);
    expect(body.informationsParticuliers).toHaveLength(0);
    expect(body.raisonSilence).toBe("aucune_source");
    expect(body.messageSilence).toMatch(/source publique/i);
  });
});

describe("aucun permis sans zone renseignée", () => {
  test("un tenant sans ville ni code postal n'obtient rien, et sait pourquoi", async () => {
    configurerSource();
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({ results: [permisParticulier(), permisProfessionnel()] }),
    });
    const { body } = await request(appAvec(t, b.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(0);
    expect(body.informationsParticuliers).toHaveLength(0);
    expect(body.raisonSilence).toBe("zone_absente");
  });
});

describe("un particulier est une information, jamais une piste", () => {
  beforeAll(configurerSource);

  test("nom et adresse affichés, aucun téléphone ni e-mail, jamais dans pistesProfessionnelles", async () => {
    const t: TransportPermis = async () => ({ status: 200, texte: JSON.stringify({ results: [permisParticulier()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.informationsParticuliers).toHaveLength(1);
    expect(body.informationsParticuliers[0].nomDemandeur).toBe("Mme Bernard");
    expect(body.informationsParticuliers[0].adresse).toBe("5 rue des Ardoises");
    expect(JSON.stringify(body.informationsParticuliers)).not.toMatch(/telephone|email/i);
    expect(body.pistesProfessionnelles).toHaveLength(0);
    expect(body.avertissement).toMatch(/INFORMATION/);
  });

  test("un particulier reste affiché MÊME quand PERMIS_AFFICHER_PISTES_PRO est activé", async () => {
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    const t: TransportPermis = async () => ({ status: 200, texte: JSON.stringify({ results: [permisParticulier()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.informationsParticuliers).toHaveLength(1);
    expect(body.pistesProfessionnelles).toHaveLength(0);
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });
});

describe("aucune piste professionnelle nommée sans activation explicite", () => {
  beforeAll(configurerSource);

  test("pistesProfessionnelles reste VIDE par défaut, même avec un demandeur exploitable", async () => {
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
    const t: TransportPermis = async () => ({ status: 200, texte: JSON.stringify({ results: [permisProfessionnel()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(0);
    expect(JSON.stringify(body)).not.toMatch(/BATIPRO/);
  });

  test("activé explicitement : la piste professionnelle est nommée, et la source citée", async () => {
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    const t: TransportPermis = async () => ({ status: 200, texte: JSON.stringify({ results: [permisProfessionnel()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(1);
    expect(body.pistesProfessionnelles[0].nomDemandeur).toBe("BATIPRO SAS");
    expect(body.pistesProfessionnelles[0].source.label).toBe("Sitadel");
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });
});

describe("isolation", () => {
  test("les permis d'un tenant dépendent de SES réglages", async () => {
    configurerSource();
    await reglage(b.tenantId, "company.commune", "Laon");
    await reglage(b.tenantId, "company.code_postal", "02000");
    const t: TransportPermis = async () => ({ status: 200, texte: JSON.stringify({ results: [permisParticulier()] }) });

    const rA = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);
    const rB = await request(appAvec(t, b.tenantId)).get("/permis").expect(200);
    expect(rA.body.raisonSilence).toBeNull();
    expect(rB.body.raisonSilence).toBeNull();
  });
});

describe("le registre des traitements est à jour dans cette PR", () => {
  test("une entrée couvre le signal de permis de construire", async () => {
    const { PROCESSING_TEMPLATES, RGPD_REGISTER_VERSION } = await import("@nodaq/shared");
    const entree = PROCESSING_TEMPLATES.find((t) => t.id === "prospection-permis-construire");

    expect(entree, "aucune entrée « prospection-permis-construire » au registre").toBeDefined();
    expect(entree!.legalBasis).toBe("interet_legitime");
    expect(entree!.purpose).toMatch(/PARTICULIER/);
    expect(entree!.source.url).toMatch(/^https?:\/\//);
    expect(RGPD_REGISTER_VERSION >= "2026-08-12").toBe(true);
  });
});

// ── La source RÉELLE ─────────────────────────────────────────────────────────
//
// Ajouté après confrontation au service le 28/08/2026. Le module composait
// `?commune=` ; la source filtre par DÉPARTEMENT (`?dep_code=`). Et tous les
// champs qu'elle rend portent des noms de colonnes Sitadel — `num_pa`,
// `localite`, `date_reelle_autorisation`, `permit_type` — là où le module
// attendait `numero`, `commune`, `date_octroi`, `nature`.
describe("le département déduit du code postal", () => {
  test("métropole : les deux premiers chiffres", () => {
    expect(departementDepuisCodePostal("02120")).toBe("02");
    expect(departementDepuisCodePostal("44300")).toBe("44");
    expect(departementDepuisCodePostal("75011")).toBe("75");
  });

  test("outre-mer : TROIS chiffres", () => {
    // Coupés à deux, la Guadeloupe et Mayotte donneraient le même « 97 ».
    expect(departementDepuisCodePostal("97110")).toBe("971");
    expect(departementDepuisCodePostal("97600")).toBe("976");
  });

  test("Corse : REFUSÉ plutôt que deviné", () => {
    // `20xxx` couvre 2A et 2B, et la limite administrative ne suit pas les
    // tranches postales partout. Envoyer un artisan d'Ajaccio démarcher en
    // Haute-Corse serait une erreur silencieuse qu'il ne pourrait pas
    // comprendre.
    expect(departementDepuisCodePostal("20000")).toBeNull();
    expect(departementDepuisCodePostal("20600")).toBeNull();
  });

  test("ce qui n'est pas un code postal ne donne rien", () => {
    expect(departementDepuisCodePostal(null)).toBeNull();
    expect(departementDepuisCodePostal("")).toBeNull();
    expect(departementDepuisCodePostal("4430")).toBeNull();
    expect(departementDepuisCodePostal("Nantes")).toBeNull();
  });
});

describe("la requête envoyée à la source", () => {
  test("filtre par dep_code, pas par commune", async () => {
    configurerSource();
    const urls: string[] = [];
    const t: TransportPermis = async (url) => {
      urls.push(url);
      return { status: 200, texte: JSON.stringify({ permits: [] }) };
    };
    await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(urls).toHaveLength(1);
    // Le tenant a le code postal 02120.
    expect(urls[0]).toContain("dep_code=02");
    expect(urls[0]).not.toContain("commune=");
  });
});

describe("les noms de champs de la source", () => {
  /** Un permis tel que la source le rend réellement. */
  const permisSitadel = () => ({
    num_pa: "0440872600041",
    permit_type: "PC",
    localite: "MACHECOUL-SAINT-MEME",
    date_reelle_autorisation: "2026-08-05",
    denom_dem: "SCI DU PONT NEUF",
    cj_dem: "6540",
  });

  test("les colonnes Sitadel sont reconnues", async () => {
    configurerSource();
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({ permits: [permisSitadel()] }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(1);
    const p = body.pistesProfessionnelles[0];
    expect(p.numero).toBe("0440872600041");
    expect(p.nature).toBe("PC");
    expect(p.commune).toBe("MACHECOUL-SAINT-MEME");
    expect(p.dateOctroi).toBe("2026-08-05");
    expect(p.nomDemandeur).toBe("SCI DU PONT NEUF");
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });

  test("la catégorie juridique suffit à établir la personne morale", async () => {
    configurerSource();
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    // AUCUN marqueur textuel — seulement `cj_dem`. C'est le cas réel : la
    // source ne rend pas de champ « type de demandeur » en toutes lettres.
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({
        permits: [{ num_pa: "X1", denom_dem: "MAIRIE DE MACHECOUL", cj_dem: "7210" }],
      }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(1);
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });

  test("sans catégorie juridique, le demandeur reste un particulier", async () => {
    configurerSource();
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    // Mesuré sur la base ouverte : un particulier ne porte NI dénomination NI
    // catégorie juridique. Il ne doit jamais devenir une piste, même le
    // réglage activé.
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({
        permits: [{ num_pa: "X2", localite: "MACHECOUL-SAINT-MEME", permit_type: "DP_LOGEMENT" }],
      }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(0);
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });
});
