/**
 * Prospection par signaux publics — axes proposés et enrichissement.
 *
 * Ce que ces tests protègent :
 *   — AUCUNE suggestion sans source configurée, et le silence est expliqué ;
 *   — AUCUNE cible particulier, sur aucune route ;
 *   — les personnes PHYSIQUES sont écartées du registre public, y compris
 *     celles dont on ne peut pas établir la nature ;
 *   — pas de base légale ⇒ pas d'enrichissement ;
 *   — la source est CITÉE dans la réponse, pas seulement stockée ;
 *   — isolation entre tenants ;
 *   — le registre des traitements est à jour dans cette PR.
 *
 * Aucun test n'atteint le réseau : le transport est injecté.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers } from "./helpers";
import { creerRouteEnrichissement } from "../routes/prospection";
import {
  chercherEntreprises,
  estPersonneMorale,
  AnnuaireConfigError,
  AnnuaireError,
  type TransportAnnuaire,
} from "../lib/annuaire-entreprises";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `signaux-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
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
  process.env["ANNUAIRE_BASE_URL"] = "http://annuaire.invalide.test";
  process.env["ANNUAIRE_SOURCE_LABEL"] = "Annuaire des entreprises";
  process.env["ANNUAIRE_SOURCE_URL"] = "https://exemple.test/annuaire";
}

function retirerSource(): void {
  delete process.env["ANNUAIRE_BASE_URL"];
  delete process.env["ANNUAIRE_SOURCE_LABEL"];
  delete process.env["ANNUAIRE_SOURCE_URL"];
}

/** Application minimale qui monte l'enrichissement avec un transport simulé. */
function appAvec(transport: TransportAnnuaire, tenantId: string) {
  const mini = express();
  mini.use(express.json());
  mini.use((req, _res, next) => { req.tenantId = tenantId; next(); });
  mini.post("/enrichir/:id", creerRouteEnrichissement(transport));
  return mini;
}

/** Une société (personne MORALE : catégorie juridique 55xx). */
const societe = (nom = "SYNDIC MARLY SAS") => ({
  siren: "123456789",
  nom_complet: nom,
  categorie_juridique: "5710",
  adresse: "12 rue des Ardoises",
  code_postal: "02120",
  commune: "Marly-Gomont",
});

/** Un entrepreneur individuel : personne PHYSIQUE, catégorie 1xxx. */
const entrepreneurIndividuel = () => ({
  siren: "987654321",
  nom_complet: "DUPONT JEAN",
  categorie_juridique: "1000",
  commune: "Marly-Gomont",
});

async function contactPro(l: Locataire, avecBase = true): Promise<string> {
  const { body: c } = await request(app).post("/api/prospection/contacts").set("Cookie", l.cookie)
    .send({ nom: "SYNDIC MARLY SAS", type: "PRO", ville: "Marly-Gomont" }).expect(201);
  if (avecBase) {
    await request(app).post(`/api/prospection/contacts/${c.id}/base`).set("Cookie", l.cookie)
      .send({ base: "INTERET_LEGITIME_PRO", source: "annuaire public des entreprises" })
      .expect(201);
  }
  return c.id;
}

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
  await reglage(a.tenantId, "metier.secteur", "batiment");
  await reglage(a.tenantId, "company.adresse_ville", "Marly-Gomont");
}, 90_000);

afterAll(async () => {
  retirerSource();
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── Axes proposés ───────────────────────────────────────────────────────────

describe("aucune suggestion sans source", () => {
  test("sans source configurée : zéro axe, et la raison est DITE", async () => {
    retirerSource();
    const { body } = await request(app).get("/api/prospection/axes")
      .set("Cookie", a.cookie).expect(200);

    expect(body.axes).toHaveLength(0);
    expect(body.raisonSilence).toBe("aucune_source");
    // Se taire sans le dire ferait croire qu'il n'y a rien à démarcher.
    expect(body.messageSilence).toMatch(/source publique/i);
  });

  test("avec une source, chaque axe la CITE", async () => {
    configurerSource();
    const { body } = await request(app).get("/api/prospection/axes")
      .set("Cookie", a.cookie).expect(200);

    expect(body.axes.length).toBeGreaterThan(0);
    for (const axe of body.axes) {
      expect(axe.source.label).toBe("Annuaire des entreprises");
      expect(axe.source.url).toMatch(/^https?:\/\//);
    }
    expect(body.raisonSilence).toBeNull();
  });

  test("un tenant sans secteur renseigné n'obtient rien, et sait pourquoi", async () => {
    configurerSource();
    const { body } = await request(app).get("/api/prospection/axes")
      .set("Cookie", b.cookie).expect(200);
    expect(body.axes).toHaveLength(0);
    expect(body.raisonSilence).toBe("secteur_absent");
  });
});

describe("aucune cible particulier", () => {
  test("l'avertissement est affiché en PERMANENCE, même sans axe", async () => {
    retirerSource();
    const sansAxe = await request(app).get("/api/prospection/axes").set("Cookie", a.cookie).expect(200);
    expect(sansAxe.body.avertissement).toMatch(/PROFESSIONNELS/);
    expect(sansAxe.body.avertissement).toMatch(/consentement/i);

    configurerSource();
    const avecAxes = await request(app).get("/api/prospection/axes").set("Cookie", a.cookie).expect(200);
    expect(avecAxes.body.avertissement).toMatch(/PROFESSIONNELS/);
  });

  test("aucun axe rendu ne mentionne un particulier", async () => {
    configurerSource();
    const { body } = await request(app).get("/api/prospection/axes")
      .set("Cookie", a.cookie).expect(200);
    expect(JSON.stringify(body.axes)).not.toMatch(/particulier/i);
  });
});

// ── Le registre public écarte les personnes physiques ───────────────────────

describe("les personnes PHYSIQUES sont écartées à la source", () => {
  beforeAll(configurerSource);

  test("un entrepreneur individuel n'est jamais rendu", async () => {
    // Le proposer reviendrait à proposer un particulier.
    const t: TransportAnnuaire = async () => ({
      status: 200,
      texte: JSON.stringify({ results: [societe(), entrepreneurIndividuel()] }),
    });
    const trouvees = await chercherEntreprises({ quoi: "x", ou: "y" }, t);
    expect(trouvees).toHaveLength(1);
    expect(trouvees[0]!.nom).toBe("SYNDIC MARLY SAS");
  });

  test("DANS LE DOUTE, ON ÉCARTE : sans catégorie juridique, la ligne est refusée", () => {
    // Mieux vaut manquer une entreprise que démarcher une personne.
    expect(estPersonneMorale({ nom_complet: "SANS CATEGORIE" })).toBe(false);
    expect(estPersonneMorale({ nom_complet: "X", categorie_juridique: "  " })).toBe(false);
    expect(estPersonneMorale({ nom_complet: "X", categorie_juridique: "5710" })).toBe(true);
    expect(estPersonneMorale({ nom_complet: "X", categorie_juridique: "1000" })).toBe(false);
  });

  test("une réponse de forme inconnue est REFUSÉE, jamais devinée", async () => {
    const t: TransportAnnuaire = async () => ({
      status: 200, texte: JSON.stringify({ items: [societe()] }),
    });
    await expect(chercherEntreprises({ quoi: "x", ou: "y" }, t)).rejects.toThrow(AnnuaireError);
    await expect(chercherEntreprises({ quoi: "x", ou: "y" }, t)).rejects.toThrow(/items/);
  });

  test("sans configuration, la recherche lève au lieu d'inventer", async () => {
    retirerSource();
    const t: TransportAnnuaire = async () => ({ status: 200, texte: "{}" });
    await expect(chercherEntreprises({ quoi: "x", ou: "y" }, t)).rejects.toThrow(AnnuaireConfigError);
    configurerSource();
  });
});

// ── Enrichissement ──────────────────────────────────────────────────────────

describe("pas de base légale, pas d'enrichissement", () => {
  beforeAll(configurerSource);

  test("un contact SANS base légale est refusé en 409, et rien n'est appelé", async () => {
    // Enrichir d'abord et régulariser ensuite serait l'inverse de ce que le
    // registre des traitements décrit.
    const id = await contactPro(a, false);
    const t = vi.fn(async () => ({ status: 200, texte: JSON.stringify({ results: [societe()] }) }));
    const r = await request(appAvec(t as unknown as TransportAnnuaire, a.tenantId))
      .post(`/enrichir/${id}`).expect(409);
    expect(r.body.error).toMatch(/base légale/i);
    expect(t).not.toHaveBeenCalled();
  });

  test("un contact PARTICULIER est refusé en 422", async () => {
    const { body: c } = await request(app).post("/api/prospection/contacts").set("Cookie", a.cookie)
      .send({ nom: "Madame Bernard", type: "PARTICULIER", ville: "Marly-Gomont" }).expect(201);
    await request(app).post(`/api/prospection/contacts/${c.id}/base`).set("Cookie", a.cookie)
      .send({ base: "CONSENTEMENT", source: "formulaire du site" }).expect(201);

    const t = vi.fn(async () => ({ status: 200, texte: "{}" }));
    await request(appAvec(t as unknown as TransportAnnuaire, a.tenantId))
      .post(`/enrichir/${c.id}`).expect(422);
    expect(t).not.toHaveBeenCalled();
  });

  test("un contact PRO avec base est enrichi, et la SOURCE est citée", async () => {
    const id = await contactPro(a);
    const t: TransportAnnuaire = async () => ({
      status: 200, texte: JSON.stringify({ results: [societe()] }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).post(`/enrichir/${id}`).expect(200);

    expect(body.enrichi).toBe(true);
    expect(body.champs).toContain("adresse");
    // Citée dans la RÉPONSE, pas seulement stockée.
    expect(body.source.label).toBe("Annuaire des entreprises");

    const { rows } = await adminPool.query(
      `SELECT adresse, code_postal, siret FROM contacts_prospection WHERE id = $1`, [id]);
    expect(rows[0].adresse).toBe("12 rue des Ardoises");
    expect(rows[0].code_postal).toBe("02120");
    expect(rows[0].siret).toBe("123456789");
  });

  test("l'enrichissement N'ÉCRASE PAS ce que l'artisan a corrigé", async () => {
    const id = await contactPro(a);
    await adminPool.query(
      `UPDATE contacts_prospection SET adresse = 'Adresse corrigée à la main' WHERE id = $1`, [id]);

    const t: TransportAnnuaire = async () => ({
      status: 200, texte: JSON.stringify({ results: [societe()] }),
    });
    const { body } = await request(appAvec(t, a.tenantId)).post(`/enrichir/${id}`).expect(200);
    expect(body.champs).not.toContain("adresse");

    const { rows } = await adminPool.query(
      `SELECT adresse FROM contacts_prospection WHERE id = $1`, [id]);
    expect(rows[0].adresse).toBe("Adresse corrigée à la main");
  });

  test("la provenance est consignée dans une NOUVELLE ligne de base légale", async () => {
    const id = await contactPro(a);
    const t: TransportAnnuaire = async () => ({
      status: 200, texte: JSON.stringify({ results: [societe()] }),
    });
    await request(appAvec(t, a.tenantId)).post(`/enrichir/${id}`).expect(200);

    const { rows } = await adminPool.query(
      `SELECT source FROM contact_bases WHERE contact_id = $1 ORDER BY created_at`, [id]);
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe("annuaire public des entreprises");   // intacte
    expect(rows[1].source).toMatch(/enrichi depuis Annuaire des entreprises/);
  });

  test("aucune correspondance → un résultat, pas une invention", async () => {
    const id = await contactPro(a);
    const t: TransportAnnuaire = async () => ({ status: 200, texte: JSON.stringify({ results: [] }) });
    const { body } = await request(appAvec(t, a.tenantId)).post(`/enrichir/${id}`).expect(200);
    expect(body.enrichi).toBe(false);
    expect(body.motif).toMatch(/Aucune correspondance/);
  });
});

// ── Isolation ───────────────────────────────────────────────────────────────

describe("isolation", () => {
  beforeAll(configurerSource);

  test("le contact d'un tenant n'est pas enrichissable depuis un autre", async () => {
    const chezA = await contactPro(a);
    const t = vi.fn(async () => ({ status: 200, texte: JSON.stringify({ results: [societe()] }) }));
    // Le contexte est celui de B : la policy ne lui montre pas la ligne de A.
    await request(appAvec(t as unknown as TransportAnnuaire, b.tenantId))
      .post(`/enrichir/${chezA}`).expect(404);
    expect(t).not.toHaveBeenCalled();
  });

  test("les axes d'un tenant dépendent de SES réglages", async () => {
    await reglage(b.tenantId, "metier.secteur", "paysage");
    await reglage(b.tenantId, "company.adresse_ville", "Laon");

    const rA = await request(app).get("/api/prospection/axes").set("Cookie", a.cookie).expect(200);
    const rB = await request(app).get("/api/prospection/axes").set("Cookie", b.cookie).expect(200);

    expect(rA.body.axes.every((x: { zone: string }) => x.zone === "Marly-Gomont")).toBe(true);
    expect(rB.body.axes.every((x: { zone: string }) => x.zone === "Laon")).toBe(true);
    // Le bâtiment propose des entreprises générales, le paysage non.
    const ciblesB = rB.body.axes.map((x: { cible: string }) => x.cible);
    expect(ciblesB).not.toContain("entreprise_generale");
  });
});

// ── Registre des traitements ────────────────────────────────────────────────

describe("le registre des traitements est à jour dans cette PR", () => {
  test("une entrée couvre la prospection par signaux publics", async () => {
    const { PROCESSING_TEMPLATES, RGPD_REGISTER_VERSION } = await import("@nodaq/shared");
    const entree = PROCESSING_TEMPLATES.find((t) => t.id === "prospection-signaux-publics");

    expect(entree, "aucune entrée « prospection-signaux-publics » au registre").toBeDefined();
    expect(entree!.legalBasis).toBe("interet_legitime");
    // Elle doit NOMMER l'exclusion des personnes physiques : c'est ce qui
    // justifie l'intérêt légitime plutôt que le consentement.
    expect(entree!.purpose).toMatch(/PROFESSIONNELS/);
    expect(entree!.purpose).toMatch(/personnes physiques/i);
    expect(entree!.source.url).toMatch(/^https?:\/\//);
    // La version du catalogue est datée : une entrée ajoutée sans bump serait
    // invisible pour qui suit les évolutions du registre.
    expect(RGPD_REGISTER_VERSION >= "2026-08-10").toBe(true);
  });
});
