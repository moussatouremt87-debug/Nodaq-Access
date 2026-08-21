/**
 * Campagne de relance vocale — ticket 4.18, US-1.
 *
 * Ce que ces tests protègent :
 *   a. RIEN NE PART SANS VALIDATION — proposer crée une `pending_action` dans
 *      la file existante, et rien d'autre. C'est la règle 4 du CLAUDE.md, et
 *      le ticket la redit : « aucun appel n'est composé sans pending_action
 *      approuvée » ;
 *   b. L'INVARIANT, jusqu'en base — une campagne ne peut pas enregistrer un
 *      mandat plus large que la règle, même avec un corps forgé ;
 *   c. LE GEL À L'APPROBATION — le mandat effectif est figé avec la version de
 *      règle qui l'a produit, et un changement de règle ultérieur ne le
 *      réécrit pas. C'est la promesse de l'US-9, vérifiée de bout en bout ;
 *   d. exclure un débiteur avant validation, plus après (US-1) ;
 *   e. un rejet ferme la campagne — laissée « PROPOSEE », elle resterait
 *      éligible alors que le dirigeant a dit non.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
} from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];
let tenantId: string;
let ownerCookie: string;

const REGLE_OUVERTE = {
  echelonnementAutorise: true,
  maxVersements: 4,
  delaiMaxPremierVersementJours: 15,
  retardMaxJours: 45,
  lienPaiementAutorise: true,
  remiseAutorisee: false,
};

const APPELS = [
  { clientId: null, factureId: "F-001", montantCents: 120000, numero: "+33600000001", clientNom: "Martin" },
  { clientId: null, factureId: "F-002", montantCents: 80000, numero: "+33600000002", clientNom: "Durand" },
];

const proposer = (corps: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/relance/campagnes")
    .set("Cookie", ownerCookie)
    .send({ appels: APPELS, ...corps });

async function poserRegle(regle: Record<string, unknown>): Promise<void> {
  await request(app)
    .put("/api/relance/regles")
    .set("Cookie", ownerCookie)
    .send(regle)
    .expect(200);
}

beforeAll(async () => {
  const email = `camp-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Campagne SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
  ownerCookie = reg.headers["set-cookie"][0];
  await poserRegle(REGLE_OUVERTE);
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. Rien ne part sans validation ────────────────────────────────────────

describe("a — proposer ne compose rien, ça remplit la file de validation", () => {
  test("une campagne crée une pending_action du bon type", async () => {
    const r = await proposer().expect(201);
    expect(r.body.pendingActionId).toBeTruthy();
    expect(r.body.campagne.statut).toBe("PROPOSEE");

    const { rows } = await adminPool.query(
      `SELECT type, status, label FROM pending_actions WHERE id = $1`,
      [r.body.pendingActionId],
    );
    expect(rows[0].type).toBe("call_dunning");
    expect(rows[0].status).toBe("EN_ATTENTE");
    // Le libellé doit se lire sans ouvrir le JSON : c'est ce qu'un humain
    // valide.
    expect(rows[0].label).toMatch(/2 appels/i);
  });

  test("la campagne reste PROPOSEE tant que personne n'a validé", async () => {
    const r = await proposer().expect(201);
    const { rows } = await adminPool.query(
      `SELECT statut, regle_version, validee_le FROM campagnes_relance WHERE id = $1`,
      [r.body.campagne.id],
    );
    expect(rows[0].statut).toBe("PROPOSEE");
    // Aucune version ne s'applique encore — c'est ce que dit le NULL.
    expect(rows[0].regle_version).toBeNull();
    expect(rows[0].validee_le).toBeNull();
  });

  test("une campagne sans appel est refusée", async () => {
    const r = await request(app)
      .post("/api/relance/campagnes")
      .set("Cookie", ownerCookie)
      .send({ appels: [] });
    expect(r.status).toBe(400);
  });
});

// ── b. L'invariant, jusqu'en base ──────────────────────────────────────────

describe("b — une campagne ne peut pas s'accorder plus que la règle", () => {
  test("un mandat plus large est RAMENÉ, et le dépassement est dit", async () => {
    const r = await proposer({
      mandat: { remiseAutorisee: true, retardMaxJours: 999, maxVersements: 99 },
    }).expect(201);

    expect(r.body.mandat.remiseAutorisee, "la règle ferme la remise").toBe(false);
    expect(r.body.mandat.retardMaxJours).toBe(REGLE_OUVERTE.retardMaxJours);
    expect(r.body.mandat.maxVersements).toBe(REGLE_OUVERTE.maxVersements);
    // Ramené ET signalé : l'écran ne doit pas faire silencieusement autre
    // chose que ce qui a été demandé.
    expect(r.body.depassements.length).toBeGreaterThan(0);
    expect(r.body.depassements.map((d: { champ: string }) => d.champ)).toContain("remiseAutorisee");
  });

  test("même en base, aucun mandat plus large que la règle n'est écrit", async () => {
    const r = await proposer({ mandat: { remiseAutorisee: true } }).expect(201);
    const { rows } = await adminPool.query(
      `SELECT mandat FROM campagnes_relance WHERE id = $1`,
      [r.body.campagne.id],
    );
    // Le point : même à l'état de PROPOSITION, rien de trop large n'existe en
    // base. Un mandat trop large stocké « en attendant » finirait par être lu
    // par quelqu'un qui le croirait validé.
    expect(rows[0].mandat.remiseAutorisee).toBe(false);
  });

  test("restreindre, en revanche, fonctionne", async () => {
    const r = await proposer({ mandat: { echelonnementAutorise: false, retardMaxJours: 10 } })
      .expect(201);
    expect(r.body.mandat.echelonnementAutorise).toBe(false);
    expect(r.body.mandat.retardMaxJours).toBe(10);
    expect(r.body.restreintLaRegle).toBe(true);
    expect(r.body.depassements).toEqual([]);
  });
});

// ── c. Le gel à l'approbation ──────────────────────────────────────────────

describe("c — le mandat est figé à l'approbation, avec sa version de règle", () => {
  test("approuver gèle le mandat et estampille la version", async () => {
    const propose = await proposer().expect(201);

    await request(app)
      .post(`/api/pending-actions/${propose.body.pendingActionId}/approve`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const { rows } = await adminPool.query(
      `SELECT statut, mandat, regle_version, validee_par_email, validee_le
       FROM campagnes_relance WHERE id = $1`,
      [propose.body.campagne.id],
    );
    expect(rows[0].statut).toBe("VALIDEE");
    expect(rows[0].regle_version).toBeGreaterThan(0);
    expect(rows[0].validee_le).toBeTruthy();
    expect(rows[0].validee_par_email).toContain("@test.nodaq");
    expect(rows[0].mandat.retardMaxJours).toBe(REGLE_OUVERTE.retardMaxJours);
  });

  test("changer la règle APRÈS ne réécrit pas une campagne validée", async () => {
    const propose = await proposer().expect(201);
    await request(app)
      .post(`/api/pending-actions/${propose.body.pendingActionId}/approve`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const avant = await adminPool.query(
      `SELECT mandat, regle_version FROM campagnes_relance WHERE id = $1`,
      [propose.body.campagne.id],
    );

    // Le dirigeant referme tout, après coup.
    await poserRegle({
      echelonnementAutorise: false,
      maxVersements: 2,
      delaiMaxPremierVersementJours: 5,
      retardMaxJours: 7,
      lienPaiementAutorise: false,
      remiseAutorisee: false,
    });

    const apres = await adminPool.query(
      `SELECT mandat, regle_version FROM campagnes_relance WHERE id = $1`,
      [propose.body.campagne.id],
    );

    // LA PROMESSE DE L'US-9, vérifiée de bout en bout : la campagne validée
    // garde son mandat et sa version. Sans cela, un resserrement de règle
    // changerait rétroactivement ce qui avait été autorisé.
    expect(apres.rows[0].mandat).toEqual(avant.rows[0].mandat);
    expect(apres.rows[0].regle_version).toBe(avant.rows[0].regle_version);

    // On remet la règle ouverte pour les tests suivants.
    await poserRegle(REGLE_OUVERTE);
  });

  test("le gel se fait contre la règle EN VIGUEUR À LA VALIDATION, pas à la proposition", async () => {
    // Proposé sous une règle ouverte…
    const propose = await proposer().expect(201);
    expect(propose.body.mandat.lienPaiementAutorise).toBe(true);

    // …le dirigeant referme le lien de paiement AVANT d'approuver.
    await poserRegle({ ...REGLE_OUVERTE, lienPaiementAutorise: false });

    await request(app)
      .post(`/api/pending-actions/${propose.body.pendingActionId}/approve`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const { rows } = await adminPool.query(
      `SELECT mandat FROM campagnes_relance WHERE id = $1`,
      [propose.body.campagne.id],
    );
    // Figer la demande telle quelle aurait laissé partir des appels sous un
    // mandat que la règle n'autorise plus.
    expect(rows[0].mandat.lienPaiementAutorise).toBe(false);

    await poserRegle(REGLE_OUVERTE);
  });
});

// ── d. Exclure un débiteur ─────────────────────────────────────────────────

describe("d — exclure un débiteur avant validation, plus après", () => {
  test("retirer un appel met à jour la campagne ET la file", async () => {
    const propose = await proposer().expect(201);

    const r = await request(app)
      .delete(`/api/relance/campagnes/${propose.body.campagne.id}/appels/F-001`)
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(r.body.appels).toHaveLength(1);

    // La file doit montrer la même liste : un dirigeant qui valide lit le
    // libellé, pas la table.
    const { rows } = await adminPool.query(
      `SELECT label, payload FROM pending_actions WHERE id = $1`,
      [propose.body.pendingActionId],
    );
    expect(rows[0].label).toMatch(/1 appel\b/i);
    expect(rows[0].payload.appels).toHaveLength(1);
  });

  test("après validation, la liste est verrouillée", async () => {
    const propose = await proposer().expect(201);
    await request(app)
      .post(`/api/pending-actions/${propose.body.pendingActionId}/approve`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const r = await request(app)
      .delete(`/api/relance/campagnes/${propose.body.campagne.id}/appels/F-001`)
      .set("Cookie", ownerCookie);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/déjà validée/i);
  });
});

// ── e. Le rejet ferme la campagne ──────────────────────────────────────────

describe("e — un rejet ferme la campagne", () => {
  test("rejeter l'action fait passer la campagne en REJETEE", async () => {
    const propose = await proposer().expect(201);

    await request(app)
      .post(`/api/pending-actions/${propose.body.pendingActionId}/reject`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const { rows } = await adminPool.query(
      `SELECT statut, regle_version FROM campagnes_relance WHERE id = $1`,
      [propose.body.campagne.id],
    );
    // Laissée « PROPOSEE », elle resterait éligible à une exécution alors que
    // le dirigeant a dit non.
    expect(rows[0].statut).toBe("REJETEE");
    expect(rows[0].regle_version, "un rejet ne gèle aucun mandat").toBeNull();
  });
});

// ── f. Le panneau de validation : lire et resserrer (US-1) ─────────────────

describe("f — le mandat se lit et se resserre depuis l'écran de validation", () => {
  test("la campagne se retrouve par son action, avec la règle du tenant", async () => {
    const propose = await proposer().expect(201);

    const r = await request(app)
      .get(`/api/relance/campagnes/par-action/${propose.body.pendingActionId}`)
      .set("Cookie", ownerCookie)
      .expect(200);

    expect(r.body.campagne.id).toBe(propose.body.campagne.id);
    // La règle accompagne la campagne : le panneau doit savoir ce qu'il PEUT
    // proposer, sinon il offrirait des gestes qui seraient ramenés en silence.
    expect(r.body.regle.remiseAutorisee).toBe(REGLE_OUVERTE.remiseAutorisee);
    expect(r.body.regleVersion).toBeGreaterThan(0);
  });

  test("une action sans campagne rend 404, pas une campagne vide", async () => {
    const r = await request(app)
      .get("/api/relance/campagnes/par-action/action-qui-nexiste-pas")
      .set("Cookie", ownerCookie);
    expect(r.status).toBe(404);
  });

  test("resserrer le mandat fonctionne, et met la file à jour", async () => {
    const propose = await proposer().expect(201);

    const r = await request(app)
      .patch(`/api/relance/campagnes/${propose.body.campagne.id}/mandat`)
      .set("Cookie", ownerCookie)
      .send({ echelonnementAutorise: false })
      .expect(200);

    expect(r.body.mandat.echelonnementAutorise).toBe(false);
    expect(r.body.restreintLaRegle).toBe(true);

    const { rows } = await adminPool.query(
      `SELECT payload FROM pending_actions WHERE id = $1`,
      [propose.body.pendingActionId],
    );
    // La file montre le mandat qu'on est en train d'approuver.
    expect(rows[0].payload.mandat.echelonnementAutorise).toBe(false);
  });

  test("resserrer NE PEUT PAS élargir, même en le demandant", async () => {
    // La règle ferme la remise ; l'écran ne le propose pas, mais un appel
    // direct pourrait essayer. L'invariant tient au serveur, pas à l'écran.
    const propose = await proposer().expect(201);

    const r = await request(app)
      .patch(`/api/relance/campagnes/${propose.body.campagne.id}/mandat`)
      .set("Cookie", ownerCookie)
      .send({ remiseAutorisee: true, retardMaxJours: 999 })
      .expect(200);

    expect(r.body.mandat.remiseAutorisee).toBe(false);
    expect(r.body.mandat.retardMaxJours).toBe(REGLE_OUVERTE.retardMaxJours);
    expect(r.body.depassements.length).toBeGreaterThan(0);

    const { rows } = await adminPool.query(
      `SELECT mandat FROM campagnes_relance WHERE id = $1`,
      [propose.body.campagne.id],
    );
    expect(rows[0].mandat.remiseAutorisee).toBe(false);
  });

  test("après validation, le mandat est figé et ne se resserre plus", async () => {
    const propose = await proposer().expect(201);
    await request(app)
      .post(`/api/pending-actions/${propose.body.pendingActionId}/approve`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const r = await request(app)
      .patch(`/api/relance/campagnes/${propose.body.campagne.id}/mandat`)
      .set("Cookie", ownerCookie)
      .send({ echelonnementAutorise: false });

    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/fig/i);
  });
});
