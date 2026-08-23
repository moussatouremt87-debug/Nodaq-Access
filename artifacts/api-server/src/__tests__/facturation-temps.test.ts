/*
 * Facturer le temps passé, de bout en bout — US-A2.4 et US-B5.4.
 *
 * ── Ce que ces tests ajoutent au module partagé ───────────────────────────
 * `facturationTemps.test.ts` éprouve le CALCUL — quel taux, quelles lignes,
 * quels arrondis. Celui-ci fait passer de vraies heures par la VRAIE route et
 * vérifie qu'il en sort une facture cohérente, isolée, et rangée au Classeur.
 *
 * Le critère qui porte tout le risque est rejoué ici sur des données réelles :
 * une facture émise après un changement de tarif applique le taux de la
 * PRESTATION, pas celui du jour.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `temps-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Temps ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

/** Un membre d'équipe, indispensable pour pointer. */
async function membre(tenantId: string, nom = "Thomas"): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO team_members (id, tenant_id, name, role) VALUES ($1, $2::uuid, $3, 'OUVRIER')`,
    [id, tenantId, nom],
  );
  return id;
}

/** Une affaire à laquelle rattacher les heures. */
async function affaire(tenantId: string): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO affaires (id, tenant_id, client_name, label, status)
     VALUES ($1, $2::uuid, 'Cabinet Martin', 'Mission conseil', 'EN_COURS')`,
    [id, tenantId],
  );
  return id;
}

async function pointer(
  tenantId: string, membreId: string, affaireId: string,
  date: string, heures: number, facturable = true,
): Promise<void> {
  await adminPool.query(
    `INSERT INTO pointages (id, tenant_id, membre_id, affaire_id, date, heures, source, facturable)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, 'confirme', $7)`,
    [crypto.randomUUID(), tenantId, membreId, affaireId, date, heures, facturable],
  );
}

const poserTaux = (c: string, corps: Record<string, unknown>) =>
  request(serveurTest(app)).post("/api/taux-horaires").set("Cookie", c).send(corps);

const facturer = (c: string, corps: Record<string, unknown>) =>
  request(serveurTest(app)).post("/api/factures/depuis-heures").set("Cookie", c).send(corps);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("le taux en vigueur à la date de la prestation", () => {
  test("un travail de janvier reste facturé au taux de janvier", async () => {
    // Le cœur de US-A2.4, rejoué sur de vraies données. Une facture au tarif
    // du jour aurait l'air normale et serait fausse.
    const t = await inscrire("taux");
    const m = await membre(t.tenantId);
    const a = await affaire(t.tenantId);

    await poserTaux(t.cookie, { dateEffet: "2026-01-01", montantCents: 8000 }).expect(201);
    await poserTaux(t.cookie, { dateEffet: "2026-07-01", montantCents: 9500 }).expect(201);

    await pointer(t.tenantId, m, a, "2026-01-15", 7);
    await pointer(t.tenantId, m, a, "2026-08-20", 3);

    const { body } = await facturer(t.cookie, {
      du: "2026-01-01", au: "2026-12-31", affaireId: a,
    }).expect(201);

    const lignes = body.facture.lines as { unitPriceCents: number; quantity: number }[];
    expect(lignes).toHaveLength(2);
    const janvier = lignes.find((l) => l.quantity === 7)!;
    const aout = lignes.find((l) => l.quantity === 3)!;
    expect(janvier.unitPriceCents).toBe(8000);   // et non 9500
    expect(aout.unitPriceCents).toBe(9500);
    expect(body.facture.totalHTCents).toBe(7 * 8000 + 3 * 9500);
  });

  test("deux taux le même jour sont refusés", async () => {
    // Lequel appliquerait-on ? L'index unique tranche, pas le code.
    const t = await inscrire("doublon");
    await poserTaux(t.cookie, { dateEffet: "2026-01-01", montantCents: 8000 }).expect(201);
    await poserTaux(t.cookie, { dateEffet: "2026-01-01", montantCents: 9000 }).expect(409);
  });
});

describe("la facture produite", () => {
  test("elle est un BROUILLON sans numéro, comme toute création", async () => {
    // L'émission scelle un document immuable et consomme un numéro : elle
    // reste un geste d'écran délibéré.
    const t = await inscrire("brouillon");
    const m = await membre(t.tenantId);
    const a = await affaire(t.tenantId);
    await poserTaux(t.cookie, { dateEffet: "2026-01-01", montantCents: 8000 }).expect(201);
    await pointer(t.tenantId, m, a, "2026-03-02", 7);

    const { body } = await facturer(t.cookie, { du: "2026-03-01", au: "2026-03-31", affaireId: a }).expect(201);
    expect(body.facture.statut).toBe("BROUILLON");
    expect(body.facture.number).toBe("");
  });

  test("elle porte ses bornes de période — un doublon devient visible", async () => {
    const t = await inscrire("bornes");
    const m = await membre(t.tenantId);
    const a = await affaire(t.tenantId);
    await poserTaux(t.cookie, { dateEffet: "2026-01-01", montantCents: 8000 }).expect(201);
    await pointer(t.tenantId, m, a, "2026-03-02", 7);

    const { body } = await facturer(t.cookie, { du: "2026-03-01", au: "2026-03-31", affaireId: a }).expect(201);
    const { rows } = await adminPool.query(
      "SELECT heures_du, heures_au FROM factures WHERE id = $1", [body.facture.id],
    );
    expect(rows[0].heures_du).toBeTruthy();
    expect(rows[0].heures_au).toBeTruthy();
  });

  test("elle entre au Classeur comme toute facture", async () => {
    const t = await inscrire("classeur");
    const m = await membre(t.tenantId);
    const a = await affaire(t.tenantId);
    await poserTaux(t.cookie, { dateEffet: "2026-01-01", montantCents: 8000 }).expect(201);
    await pointer(t.tenantId, m, a, "2026-03-02", 7);

    const { body } = await facturer(t.cookie, { du: "2026-03-01", au: "2026-03-31", affaireId: a }).expect(201);
    const { rows } = await adminPool.query(
      "SELECT source_id FROM classeur_documents WHERE tenant_id = $1 AND source_type = 'FACTURE'",
      [t.tenantId],
    );
    expect(rows.map((r) => r.source_id)).toContain(body.facture.id);
  });

  test("une ligne par journée, avec sa date lisible", async () => {
    // C'est l'annexe du critère 2, obtenue par construction.
    const t = await inscrire("annexe");
    const m = await membre(t.tenantId);
    const a = await affaire(t.tenantId);
    await poserTaux(t.cookie, { dateEffet: "2026-01-01", montantCents: 8000 }).expect(201);
    await pointer(t.tenantId, m, a, "2026-03-02", 7);
    await pointer(t.tenantId, m, a, "2026-03-03", 3.5);

    const { body } = await facturer(t.cookie, { du: "2026-03-01", au: "2026-03-31", affaireId: a }).expect(201);
    const descriptions = (body.facture.lines as { description: string }[]).map((l) => l.description);
    expect(descriptions[0]).toContain("02/03/2026");
    expect(descriptions[1]).toContain("03/03/2026");
  });
});

describe("le temps non facturable", () => {
  test("il sort de la facture, et il est NOMMÉ dans la réponse", async () => {
    // US-B5.4. Une facture silencieuse sur du travail écarté est une facture
    // qu'on croit complète.
    // DEUX membres, et non deux pointages du même membre le même jour :
    // `pointages_unique_membre_affaire_jour` l'interdit. C'est une limite
    // réelle du produit — on ne peut pas scinder la journée d'une personne
    // sur une même affaire en part facturable et part non facturable — et
    // elle est signalée dans la PR plutôt que contournée en silence.
    const t = await inscrire("nonfact");
    const m1 = await membre(t.tenantId, "Facturable");
    const m2 = await membre(t.tenantId, "Interne");
    const a = await affaire(t.tenantId);
    await poserTaux(t.cookie, { dateEffet: "2026-01-01", montantCents: 8000 }).expect(201);
    await pointer(t.tenantId, m1, a, "2026-03-02", 6, true);
    await pointer(t.tenantId, m2, a, "2026-03-02", 2, false);

    const { body } = await facturer(t.cookie, { du: "2026-03-01", au: "2026-03-31", affaireId: a }).expect(201);
    expect(body.totalHeures).toBe(6);
    expect(body.ecartes).toHaveLength(1);
    expect(body.ecartes[0].motif).toMatch(/non facturable/);
    // Et le taux d'occupation en découle : 6 sur 8.
    expect(body.tauxOccupation).toBe(75);
  });

  test("une période entièrement non facturable ne produit PAS de facture vide", async () => {
    const t = await inscrire("vide");
    const m = await membre(t.tenantId);
    const a = await affaire(t.tenantId);
    await poserTaux(t.cookie, { dateEffet: "2026-01-01", montantCents: 8000 }).expect(201);
    await pointer(t.tenantId, m, a, "2026-03-02", 4, false);

    const { body } = await facturer(t.cookie, { du: "2026-03-01", au: "2026-03-31", affaireId: a }).expect(422);
    expect(body.error).toMatch(/Aucune heure facturable/);
    expect(body.ecartes).toHaveLength(1);
  });
});

describe("les refus qui expliquent", () => {
  test("sans aucun taux enregistré, on dit quoi faire", async () => {
    const t = await inscrire("sanstaux");
    const m = await membre(t.tenantId);
    const a = await affaire(t.tenantId);
    await pointer(t.tenantId, m, a, "2026-03-02", 7);

    const { body } = await facturer(t.cookie, { du: "2026-03-01", au: "2026-03-31", affaireId: a }).expect(422);
    expect(body.error).toMatch(/Renseignez-en un/);
  });

  test("une affaire ET un client à la fois est refusé", async () => {
    // Même exclusivité que le pointage lui-même (US-A4.1).
    const t = await inscrire("exclusif");
    await facturer(t.cookie, {
      du: "2026-03-01", au: "2026-03-31", affaireId: "a", clientId: "c",
    }).expect(400);
    await facturer(t.cookie, { du: "2026-03-01", au: "2026-03-31" }).expect(400);
  });

  test("une période à l'envers est refusée", async () => {
    const t = await inscrire("envers");
    await facturer(t.cookie, { du: "2026-03-31", au: "2026-03-01", affaireId: "a" }).expect(400);
  });
});

describe("l'isolation", () => {
  test("les taux d'un tenant ne sont pas lus par un autre", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    await poserTaux(a.cookie, { dateEffet: "2026-01-01", montantCents: 12345 }).expect(201);

    const { body } = await request(serveurTest(app))
      .get("/api/taux-horaires").set("Cookie", b.cookie).expect(200);
    expect(JSON.stringify(body)).not.toContain("12345");
  });
});
