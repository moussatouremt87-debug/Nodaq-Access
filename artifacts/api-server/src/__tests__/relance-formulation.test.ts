/**
 * La formulation des répliques par le modèle — ticket 4.18.
 *
 * Ce que ces tests protègent :
 *   a. le modèle FORMULE — sa phrase est bien celle qu'on prononce, sinon tout
 *      ce lot ne serait qu'un détour réseau vers des phrases pré-écrites ;
 *   b. LES GARDES MORDENT — une menace, un chiffre inventé ou un registre de
 *      courrier ne sortent jamais du serveur. Le simulateur LLM produit
 *      délibérément ces trois fautes ;
 *   c. LE FILET TIENT — modèle en panne ou non configuré, l'agent parle quand
 *      même : il est au téléphone avec quelqu'un, et un silence est pire
 *      qu'une phrase moins vivante ;
 *   d. la route ne décide rien — elle ne lit ni règle ni mandat.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie: string;

const formuler = (corps: Record<string, unknown>) =>
  request(app).post("/api/relance/formulation").set("Cookie", cookie).send(corps);

/**
 * Le marqueur qui pilote le simulateur voyage dans l'HISTORIQUE, pas dans les
 * faits : les faits définissent les chiffres autorisés, et y glisser du texte
 * de test brouillerait la garde qu'on veut justement éprouver.
 */
const cas = (marqueur: string) => [{ locuteur: "debiteur", propos: marqueur }];

beforeAll(async () => {
  const email = `formul-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Formulation SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantIds.push(reg.body.tenantId);
  cookie = reg.headers["set-cookie"][0];
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. Le modèle formule ───────────────────────────────────────────────────

describe("a — la réplique vient du modèle", () => {
  test("une sortie conforme est prononcée telle quelle", async () => {
    const r = await formuler({ intention: "demander_date" }).expect(200);
    expect(r.body.source).toBe("modele");
    expect(r.body.replique).toBe("Ah, d'accord. Alors, je note ça.");
  });

  test("l'enrobage de guillemets est retiré, pas le contenu", async () => {
    // Le simulateur encadre sa réponse de guillemets, comme le font les vrais
    // modèles malgré la consigne.
    const r = await formuler({ intention: "demander_date" }).expect(200);
    expect(r.body.replique).not.toMatch(/^["«]/);
  });

  test("une intention inconnue est refusée", async () => {
    await formuler({ intention: "menacer" }).expect(400);
  });
});

// ── b. Les gardes de sortie ────────────────────────────────────────────────

describe("b — ce que le modèle produit de fautif ne sort jamais", () => {
  test("une menace n'est pas prononcée", async () => {
    const r = await formuler({
      intention: "demander_date",
      historique: cas("formulation-test-menace"),
    }).expect(200);

    expect(r.body.source).toBe("secours");
    expect(r.body.replique).not.toMatch(/contentieux/i);
  });

  test("un chiffre que personne n'a fourni n'est pas prononcé", async () => {
    // La garde de la règle 3 : le modèle ne fixe aucun montant. Ici il en
    // invente un (9999) alors que les faits disent 1200.
    const r = await formuler({
      intention: "recapituler_promesse",
      faits: { montant: "1200 €", date: "15 septembre" },
      historique: cas("formulation-test-chiffre"),
    }).expect(200);

    expect(r.body.source).toBe("secours");
    expect(r.body.replique).not.toContain("9999");
    // Le filet, lui, ne dit que les faits reçus.
    expect(r.body.replique).toContain("1200 €");
    expect(r.body.replique).toContain("15 septembre");
  });

  test("une réplique en registre de courrier n'est pas prononcée", async () => {
    const r = await formuler({
      intention: "refuser_et_transmettre",
      historique: cas("formulation-test-courrier"),
    }).expect(200);

    expect(r.body.source).toBe("secours");
    expect(r.body.replique).not.toMatch(/nous vous prions|bien vouloir/i);
  });
});

// ── c. Le filet ────────────────────────────────────────────────────────────

describe("c — l'agent parle même quand le modèle ne répond pas", () => {
  test("modèle en panne : réplique de secours, jamais une erreur", async () => {
    // Pas de 503 : l'agent est AU TÉLÉPHONE. Un code d'erreur produirait un
    // blanc au milieu d'une conversation avec une personne réelle.
    const r = await formuler({
      intention: "clore_contestation",
      historique: cas("formulation-test-panne"),
    }).expect(200);

    expect(r.body.source).toBe("secours");
    expect(r.body.replique.length).toBeGreaterThan(0);
  });

  test("chaque intention a un filet prononçable", async () => {
    for (const intention of [
      "demander_date",
      "refuser_et_transmettre",
      "clore_contestation",
      "clore_paiement_annonce",
      "clore_rappel_humain",
      "clore_opposition",
    ]) {
      const r = await formuler({ intention, historique: cas("formulation-test-panne") }).expect(200);
      expect(r.body.source, intention).toBe("secours");
      expect(r.body.replique.trim().length, intention).toBeGreaterThan(0);
    }
  });
});

// ── d. La route ne décide rien ─────────────────────────────────────────────

describe("d — la formulation ne décide rien", () => {
  test("elle prononce les chiffres reçus sans les vérifier ni les recalculer", async () => {
    // Elle ne consulte NI la règle du tenant NI le mandat : au moment où on
    // l'appelle, `deciderEchelonnement` a déjà tranché. Un second contrôle ici
    // créerait une deuxième source de vérité, et la permissive gagne toujours
    // le jour où les deux divergent.
    const r = await formuler({
      intention: "offrir_echelonnement",
      faits: { nombre_de_versements: "3", jours_avant_le_premier_versement: "10" },
      historique: cas("formulation-test-panne"),
    }).expect(200);

    expect(r.body.replique).toContain("3");
    expect(r.body.replique).toContain("10");
  });

  test("une session est exigée", async () => {
    await request(app)
      .post("/api/relance/formulation")
      .send({ intention: "demander_date" })
      .expect(401);
  });
});
