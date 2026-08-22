/**
 * Retour à chaud sur les productions de l'agent — ticket 4.36, lot C.
 *
 * Le signal qualité se recueille au moment où l'utilisateur JUGE. C'est
 * l'entrée de nos évaluations : chaque pouce en bas récurrent devient un
 * scénario d'éval.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie = "";
let tenantId = "";

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `fb-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `FB ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

beforeAll(async () => {
  const t = await inscrire("a");
  cookie = t.cookie;
  tenantId = t.tenantId;
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

const juger = (corps: Record<string, unknown>) =>
  request(serveurTest(app)).post("/api/agent/feedback").set("Cookie", cookie).send(corps);

describe("a — un clic suffit", () => {
  test("un pouce sans verbatim est accepté, et ne renvoie rien", async () => {
    // Exiger une explication transformerait un geste d'une seconde en corvée,
    // et on ne recueillerait plus rien du tout.
    await juger({ typeProduction: "devis_genere", referenceId: "d1", note: "POUCE_HAUT" })
      .expect(204);

    const { rows } = await adminPool.query(
      `SELECT note, verbatim FROM agent_feedback WHERE tenant_id = $1`, [tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("POUCE_HAUT");
    expect(rows[0].verbatim).toBeNull();
  });

  test("une note inconnue est refusée", async () => {
    await juger({ typeProduction: "devis_genere", note: "MOYEN" }).expect(400);
  });
});

describe("b — un double-clic ne compte pas deux fois", () => {
  test("juger deux fois la même production laisse UNE ligne", async () => {
    const t = await inscrire("double");
    const envoyer = () =>
      request(serveurTest(app)).post("/api/agent/feedback").set("Cookie", t.cookie)
        .send({ typeProduction: "resume", referenceId: "r1", note: "POUCE_BAS" });
    await envoyer().expect(204);
    await envoyer().expect(204);

    // Sans l'index unique, deux pouces fausseraient le taux — le défaut le
    // plus probable, et le plus silencieux.
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM agent_feedback WHERE tenant_id = $1`, [t.tenantId],
    );
    expect(rows[0].n).toBe(1);
  });

  test("le verbatim envoyé APRÈS le pouce n'est pas perdu", async () => {
    // L'écran envoie le pouce dès le clic — pour ne rien perdre si l'onglet se
    // ferme — puis le verbatim quand il arrive. Avec un `onConflictDoNothing`,
    // ce second envoi rendait 204 et le commentaire disparaissait : la seule
    // chose qu'on ait à lire dans un pouce en bas, jetée en silence.
    const t = await inscrire("verbatim-apres");
    const envoyer = (corps: Record<string, unknown>) =>
      request(serveurTest(app)).post("/api/agent/feedback").set("Cookie", t.cookie)
        .send({ typeProduction: "resume", referenceId: "r1", note: "POUCE_BAS", ...corps });

    await envoyer({}).expect(204);
    await envoyer({ verbatim: "il a inventé un montant" }).expect(204);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n, min(verbatim) AS v FROM agent_feedback WHERE tenant_id = $1`,
      [t.tenantId],
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].v).toBe("il a inventé un montant");
  });

  test("un pouce sans verbatim n'efface pas un verbatim déjà donné", async () => {
    // Un re-clic distrait sur le même pouce ne doit pas effacer ce qu'on a
    // écrit : c'est le `coalesce`, et il est invisible sans ce test.
    const t = await inscrire("verbatim-garde");
    const envoyer = (corps: Record<string, unknown>) =>
      request(serveurTest(app)).post("/api/agent/feedback").set("Cookie", t.cookie)
        .send({ typeProduction: "resume", referenceId: "r1", note: "POUCE_BAS", ...corps });

    await envoyer({ verbatim: "les lignes sont dans le désordre" }).expect(204);
    await envoyer({}).expect(204);

    const { rows } = await adminPool.query(
      `SELECT verbatim FROM agent_feedback WHERE tenant_id = $1`, [t.tenantId],
    );
    expect(rows[0].verbatim).toBe("les lignes sont dans le désordre");
  });

  test("changer d'avis remplace la note, sans créer de seconde ligne", async () => {
    const t = await inscrire("avis");
    const envoyer = (note: string) =>
      request(serveurTest(app)).post("/api/agent/feedback").set("Cookie", t.cookie)
        .send({ typeProduction: "resume", referenceId: "r1", note });

    await envoyer("POUCE_HAUT").expect(204);
    await envoyer("POUCE_BAS").expect(204);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n, min(note) AS note FROM agent_feedback WHERE tenant_id = $1`,
      [t.tenantId],
    );
    expect(rows[0].n).toBe(1);
    expect(rows[0].note).toBe("POUCE_BAS");
  });
});

describe("c — la restitution ne compte jamais un silence", () => {
  test("le taux porte sur les seules productions JUGÉES", async () => {
    const t = await inscrire("taux");
    const poser = (ref: string, note: string) =>
      request(serveurTest(app)).post("/api/agent/feedback").set("Cookie", t.cookie)
        .send({ typeProduction: "devis_genere", referenceId: ref, note }).expect(204);
    await poser("a", "POUCE_HAUT");
    await poser("b", "POUCE_HAUT");
    await poser("c", "POUCE_BAS");

    const { body } = await request(serveurTest(app))
      .get("/api/agent/feedback/restitution").set("Cookie", t.cookie).expect(200);

    const ligne = body.parType.find((l: { typeProduction: string }) => l.typeProduction === "devis_genere");
    expect(ligne.total).toBe(3);
    expect(ligne.pouceHaut).toBe(2);
    // 67 et non 66,666… : afficher deux décimales sur trois avis donnerait une
    // précision que la donnée n'a pas.
    expect(ligne.tauxSatisfaction).toBe(67);
  });

  test("seuls les verbatims des pouces BAS remontent", async () => {
    const t = await inscrire("verbatim");
    await request(serveurTest(app)).post("/api/agent/feedback").set("Cookie", t.cookie)
      .send({ typeProduction: "devis_genere", referenceId: "x", note: "POUCE_HAUT", verbatim: "très bien" })
      .expect(204);
    await request(serveurTest(app)).post("/api/agent/feedback").set("Cookie", t.cookie)
      .send({ typeProduction: "devis_genere", referenceId: "y", note: "POUCE_BAS", verbatim: "ligne de gouttière oubliée" })
      .expect(204);

    const { body } = await request(serveurTest(app))
      .get("/api/agent/feedback/restitution").set("Cookie", t.cookie).expect(200);

    // Un « très bien » n'apprend rien à corriger. Ce qu'on veut, c'est ce qui
    // doit devenir un scénario d'éval.
    expect(body.verbatims).toHaveLength(1);
    expect(body.verbatims[0].verbatim).toBe("ligne de gouttière oubliée");
  });
});

describe("d — isolation", () => {
  test("le jugement d'un tenant n'est pas lu par un autre", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    await request(serveurTest(app)).post("/api/agent/feedback").set("Cookie", a.cookie)
      .send({ typeProduction: "secret", referenceId: "s", note: "POUCE_BAS", verbatim: "client Delacroix" })
      .expect(204);

    const { body } = await request(serveurTest(app))
      .get("/api/agent/feedback/restitution").set("Cookie", b.cookie).expect(200);

    // Le verbatim peut nommer un client : le voir fuir serait une divulgation.
    expect(body.parType.some((l: { typeProduction: string }) => l.typeProduction === "secret")).toBe(false);
    expect(JSON.stringify(body)).not.toContain("Delacroix");
  });
});
