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
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";
import { creerRoutePermis } from "../routes/prospection";
import type { TransportPermis } from "../lib/permis-construire";
import { departementDepuisCodePostal } from "../lib/permis-construire";
import { ecrireCachePermis, TTL_CACHE_PERMIS_MS } from "../lib/cache-permis";

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

/**
 * Le cas RÉEL et majoritaire : Sitadel anonymise les personnes physiques.
 * Mesuré sur un échantillon de la base ouverte, 44 permis sur 100 ne portent
 * ni dénomination ni catégorie juridique. `permisParticulier()` ci-dessus,
 * avec son « Mme Bernard », est en fait le cas EXCEPTIONNEL.
 */
const permisParticulierAnonyme = () => ({
  num_pa: "PC-002-003",
  permit_type: "Construction maison individuelle",
  full_address: "12 chemin du Moulin",
  commune: "Marly-Gomont",
  date_reelle_autorisation: "2026-07-18",
  superficie_terrain: 394,
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

/*
 * Le cache est PARTAGÉ entre tous les locataires et survit d'un test à
 * l'autre : sans cette purge, la première requête d'un fichier remplirait
 * l'entrée du département 02 et tous les transports suivants ne seraient
 * jamais appelés. Les tests verdiraient en n'exerçant plus rien.
 */
beforeEach(async () => {
  await adminPool.query("TRUNCATE cache_permis");
});

afterAll(async () => {
  await adminPool.query("TRUNCATE cache_permis");
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
    expect(body.avertissement).toMatch(/SIGNAL DE CHANTIER/);
    // Le cadrage a changé de mot, jamais de fond : ce qui est interdit ici
    // doit rester écrit noir sur blanc dans la réponse elle-même.
    expect(body.avertissement).toMatch(/jamais une piste à contacter/i);
    expect(body.avertissement).toMatch(/ANONYMIS/i);
  });

  test("un particulier reste affiché MÊME quand PERMIS_AFFICHER_PISTES_PRO est activé", async () => {
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    const t: TransportPermis = async () => ({ status: 200, texte: JSON.stringify({ results: [permisParticulier()] }) });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.informationsParticuliers).toHaveLength(1);
    expect(body.pistesProfessionnelles).toHaveLength(0);
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });

  /**
   * Ce que la source publie VRAIMENT sur un particulier : le chantier, pas la
   * personne. Sans ces trois champs, la ligne ne dit que « des travaux, quelque
   * part » — et l'écran affichait au-dessus d'elle un nom vide.
   */
  test("un permis ANONYMISÉ porte quand même son chantier : adresse, nature, date, superficie", async () => {
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({ results: [permisParticulierAnonyme()] }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.informationsParticuliers).toHaveLength(1);
    const p = body.informationsParticuliers[0];
    expect(p.nomDemandeur).toBeNull();          // la source ne le publie pas
    expect(p.adresse).toBe("12 chemin du Moulin");
    expect(p.commune).toBe("Marly-Gomont");
    expect(p.nature).toBe("Construction maison individuelle");
    expect(p.dateOctroi).toBe("2026-07-18");
    expect(p.superficieTerrain).toBe(394);
  });

  /**
   * LA RÉGRESSION que ce ticket corrige.
   *
   * La source voyageait avec la piste PROFESSIONNELLE seulement ; l'écran se
   * rabattait sur celle de la première d'entre elles. Or ces pistes sont
   * derrière `PERMIS_AFFICHER_PISTES_PRO`, désactivé en production : le repli
   * rendait une URL vide, et le panneau affichait un lien vers nulle part.
   * Un signal qu'on ne peut pas vérifier ne vaut rien.
   */
  test("la source voyage avec CHAQUE particulier, sans dépendre des pistes pro", async () => {
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({ results: [permisParticulierAnonyme(), permisProfessionnel()] }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(0);   // le cas de production
    expect(body.informationsParticuliers[0].source.label).toBe("Sitadel");
    expect(body.informationsParticuliers[0].source.url).toMatch(/^https?:\/\//);
  });

  test("une superficie absente ou nulle vaut null, jamais « 0 m² »", async () => {
    const sansTerrain = { ...permisParticulierAnonyme(), superficie_terrain: 0 };
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({ results: [sansTerrain, permisParticulier()] }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    // `0` est une case non renseignée, pas une mesure : l'afficher ferait
    // passer une absence pour un terrain de zéro mètre carré.
    expect(body.informationsParticuliers[0].superficieTerrain).toBeNull();
    // Et un permis dont la source ne dit rien du terrain non plus.
    expect(body.informationsParticuliers[1].superficieTerrain).toBeNull();
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

// ── La réponse RÉELLE du service ─────────────────────────────────────────────
//
// Relevée avec une vraie clé le 28/08/2026, département 75. Elle contredit
// l'essai public sur DEUX points, et c'est pourquoi ces tests existent :
// l'essai rendait `localite` et l'enveloppe `permits`, le service réel rend
// `adr_localite_ter` et `data`. Sans vérification, la commune serait restée
// vide sans qu'aucune erreur ne le dise.
describe("la réponse réelle du service", () => {
  /** Un permis tel que le service le rend, champs verbatim. */
  const permisReel = () => ({
    id: 10374327,
    num_pa: "07510826V0325",
    dep_code: "75",
    comm_code: "75056",
    adr_localite_ter: "PARIS 08",
    full_address: "1 RUE D'ARGENSON 75008 PARIS 08",
    date_reelle_autorisation: "2026-08-05",
    permit_type: "DP_LOCAUX",
    superficie_terrain: 394,
    denom_dem: "WELLBAW",
    siren_dem: "844587063",
  });

  test("l'enveloppe `data` et les champs réels sont lus", async () => {
    configurerSource();
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({ data: [permisReel()] }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(1);
    const p = body.pistesProfessionnelles[0];
    expect(p.numero).toBe("07510826V0325");
    expect(p.nature).toBe("DP_LOCAUX");
    expect(p.nomDemandeur).toBe("WELLBAW");
    // Le piège : `adr_localite_ter`, pas `localite`.
    expect(p.commune).toBe("PARIS 08");
    expect(p.adresse).toBe("1 RUE D'ARGENSON 75008 PARIS 08");
    expect(p.dateOctroi).toBe("2026-08-05");
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });

  test("le SIREN suffit à établir la personne morale", async () => {
    configurerSource();
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    // Le service ne rend NI catégorie juridique NI type de demandeur en
    // toutes lettres — vérifié sur la liste complète de ses champs. Le SIREN
    // est le seul marqueur disponible, et il suffit : un particulier n'en a
    // pas.
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({
        data: [{ num_pa: "X1", denom_dem: "WELLBAW", siren_dem: "844587063" }],
      }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(1);
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });

  test("un SIREN sérialisé en nombre est accepté", async () => {
    configurerSource();
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    // Refuser sur ce détail de sérialisation ferait perdre TOUTES les pistes,
    // et l'erreur parlerait de « forme inattendue » sans dire laquelle.
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({
        data: [{ num_pa: "X2", denom_dem: "WELLBAW", siren_dem: 844587063 }],
      }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(1);
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });

  test("sans SIREN ni nom, le demandeur reste un particulier", async () => {
    configurerSource();
    process.env["PERMIS_AFFICHER_PISTES_PRO"] = "true";
    const t: TransportPermis = async () => ({
      status: 200,
      texte: JSON.stringify({
        data: [{ num_pa: "X3", adr_localite_ter: "PARIS 08", permit_type: "DP_LOGEMENT" }],
      }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.pistesProfessionnelles).toHaveLength(0);
    delete process.env["PERMIS_AFFICHER_PISTES_PRO"];
  });
});


// ── Le cache, né du quota ────────────────────────────────────────────────────
//
// PermisAPI plafonne le plan gratuit à 500 requêtes par mois. Chaque ouverture
// de l'écran Prospection en consommait une : le quota s'est épuisé en quelques
// jours de test, et la section s'est mise à répondre 429 — que l'écran
// affichait « Impossible de charger les permis », comme une panne du produit.
describe("le cache des permis", () => {
  beforeAll(configurerSource);

  function transportComptant(reponse: () => { status: number; texte: string }) {
    const etat = { appels: 0 };
    const t: TransportPermis = async () => {
      etat.appels++;
      return reponse();
    };
    return { t, etat };
  }

  const ok = () => ({ status: 200, texte: JSON.stringify({ results: [permisParticulier()] }) });

  test("une entrée fraîche évite un second appel à la source", async () => {
    const { t, etat } = transportComptant(ok);

    await request(appAvec(t, a.tenantId)).get("/permis").expect(200);
    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    // LA garde : sans cache, ce serait 2. C'est tout l'objet du ticket.
    expect(etat.appels).toBe(1);
    expect(body.informationsParticuliers).toHaveLength(1);
    // Rien n'est périmé : l'écran ne doit afficher aucune mention de date.
    expect(body.donneesDu).toBeNull();
  });

  /*
   * Le point qui justifie l'absence de `tenant_id` sur cette table. Deux
   * artisans du même département lisent la MÊME entrée : c'est ce qui divise
   * les appels au lieu de les multiplier. Un cache par locataire aurait
   * consommé le quota d'autant plus vite qu'il y a de clients.
   */
  test("deux locataires du même département partagent l'entrée", async () => {
    await reglage(b.tenantId, "company.commune", "Laon");
    await reglage(b.tenantId, "company.code_postal", "02000");   // même département
    const { t, etat } = transportComptant(ok);

    await request(appAvec(t, a.tenantId)).get("/permis").expect(200);
    const { body } = await request(appAvec(t, b.tenantId)).get("/permis").expect(200);

    expect(etat.appels).toBe(1);
    expect(body.informationsParticuliers).toHaveLength(1);
  });

  test("une entrée périmée fait rappeler la source", async () => {
    const vieux = new Date(Date.now() - TTL_CACHE_PERMIS_MS - 60_000);
    await ecrireCachePermis("02", [], vieux);
    const { t, etat } = transportComptant(ok);

    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(etat.appels).toBe(1);
    expect(body.informationsParticuliers).toHaveLength(1);   // la donnée fraîche
    expect(body.donneesDu).toBeNull();
  });

  /*
   * Une entrée d'hier vaut infiniment mieux qu'un écran rouge : les
   * autorisations d'urbanisme sont publiées au mois, un chantier d'hier est
   * toujours un chantier. Mais on le DIT — servir du périmé en silence serait
   * mentir sur la fraîcheur.
   */
  test("quota atteint AVEC cache : on sert le périmé, et on le dit", async () => {
    const vieux = new Date(Date.now() - TTL_CACHE_PERMIS_MS - 60_000);
    await ecrireCachePermis("02", [], vieux);
    const { t } = transportComptant(() => ({ status: 429, texte: "" }));

    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    expect(body.donneesDu).toBe(vieux.toISOString());
    expect(body.informationsParticuliers).toHaveLength(0);
  });

  /*
   * Sans rien en cache, il faut parler — et bien parler. Un 429 est un
   * plafond de la SOURCE, qui se lève tout seul ; ce n'est pas une panne de
   * nodaq. La règle 3 bis interdit un message qui laisse croire à une impasse.
   */
  test("quota atteint SANS cache : un message qui dit le vrai", async () => {
    const { t } = transportComptant(() => ({ status: 429, texte: "" }));

    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(503);

    expect(body.quotaSourceAtteint).toBe(true);
    expect(body.error).toMatch(/plafond/i);
    expect(body.error).toMatch(/réessayez/i);
    // Le mot qui a fait croire à une panne pendant des jours.
    expect(body.error).not.toMatch(/impossible/i);
  });

  test("une VRAIE panne de la source reste une panne, pas un quota", async () => {
    const { t } = transportComptant(() => ({ status: 500, texte: "" }));

    const { body } = await request(appAvec(t, a.tenantId)).get("/permis").expect(502);

    expect(body.quotaSourceAtteint).toBe(false);
    expect(body.error).toMatch(/500/);
  });

  test("une réponse en échec n'écrase JAMAIS le cache", async () => {
    const recent = new Date(Date.now() - TTL_CACHE_PERMIS_MS - 60_000);
    await ecrireCachePermis("02", [], recent);
    const { t } = transportComptant(() => ({ status: 429, texte: "" }));
    await request(appAvec(t, a.tenantId)).get("/permis").expect(200);

    const { rows } = await adminPool.query("SELECT charge_le FROM cache_permis WHERE departement = $1", ["02"]);
    expect(new Date(rows[0].charge_le).toISOString()).toBe(recent.toISOString());
  });
});

describe("la table de cache ne porte aucune donnée de locataire", () => {
  /*
   * `cache_permis` est la SEULE table du schéma sans `tenant_id`, et c'est
   * délibéré : elle ne contient que de l'open data publique, partagée. Cette
   * garde fige la décision. Si quelqu'un y ajoutait un jour une colonne
   * `tenant_id` sans y mettre de RLS, la garde `pg_class` de la CI le
   * rattraperait ; si quelqu'un y ajoutait de la donnée de locataire SOUS un
   * autre nom, ce test-ci le rattrape.
   */
  test("aucune colonne ne désigne un locataire", async () => {
    const { rows } = await adminPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cache_permis'`,
    );
    const colonnes = rows.map((r) => r.column_name).sort();

    expect(colonnes).toEqual(["charge_le", "departement", "donnees"]);
    expect(colonnes.some((c) => /tenant|user|client|membre/i.test(c))).toBe(false);
  });
});
