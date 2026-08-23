/*
 * Tout document créé apparaît au Classeur — ticket 4.31 b.
 *
 * ── Le verbatim que ces tests rendent faux ────────────────────────────────
 * Session de test du 22/08 : « j'avais ajouté une facture au tout début mais
 * elle n'apparaît pas dans le classeur ». C'était exact — seul l'envoi de
 * photo écrivait au Classeur.
 *
 * ── Pourquoi une garde d'EXHAUSTIVITÉ et pas seulement des cas ────────────
 * Le ticket demandait de passer par un bus d'événements, qui n'existe pas
 * dans ce dépôt. À défaut, l'indexation passe par UNE fonction appelée à dix
 * endroits — et rien n'oblige le onzième producteur à l'appeler.
 *
 * Le dernier test de ce fichier compte donc les documents en base et les
 * entrées de Classeur, et échoue sur le moindre écart. C'est lui qui rattrape
 * ce que l'architecture ne peut pas empêcher ici : un futur `POST /devis`
 * bis, un import, un outil de l'agent. Il ne dira pas QUOI corriger, mais il
 * dira que quelque chose manque, et c'est ce qui compte.
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
let cookie = "";
let tenantId = "";

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `clas-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Clas ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

beforeAll(async () => {
  const t = await inscrire("a");
  cookie = t.cookie; tenantId = t.tenantId;
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

/** Les entrées de Classeur d'un tenant, par type de source. */
async function entrees(tid: string, sourceType?: string) {
  const { rows } = await adminPool.query(
    `SELECT name, category, source_type, source_id
       FROM classeur_documents
      WHERE tenant_id = $1 ${sourceType ? "AND source_type = $2" : ""}`,
    sourceType ? [tid, sourceType] : [tid],
  );
  return rows;
}

describe("chaque document créé entre au Classeur", () => {
  test("une facture y apparaît, sous son numéro", async () => {
    const t = await inscrire("facture");
    const { body } = await request(serveurTest(app))
      .post("/api/factures").set("Cookie", t.cookie).send({
        customerName: "Client", issuedDate: "2026-05-01", dueDate: "2026-06-01",
        lines: [{ description: "Pose", quantity: 1, unitPriceCents: 45_000, vatRate: 20 }],
      }).expect(201);

    const rangees = await entrees(t.tenantId, "FACTURE");
    expect(rangees).toHaveLength(1);
    expect(rangees[0].source_id).toBe(body.id);
    // Un brouillon n'a pas encore de numéro : le nom retombe sur l'identifiant
    // plutôt que d'écrire « Facture null ».
    expect(rangees[0].name).toContain("Facture");
    expect(rangees[0].category).toBe("FACTURE");
  });

  test("un devis y apparaît, sous sa référence", async () => {
    const t = await inscrire("devis");
    const { body } = await request(serveurTest(app))
      .post("/api/devis").set("Cookie", t.cookie).send({
        clientName: "Client",
        lines: [{ description: "Étude", quantity: 1, unitPriceCents: 30_000 }],
      }).expect(201);

    const rangees = await entrees(t.tenantId, "DEVIS");
    expect(rangees).toHaveLength(1);
    expect(rangees[0].source_id).toBe(body.id);
    expect(rangees[0].name).toContain(body.reference);
  });

  test("un contrat y apparaît", async () => {
    const t = await inscrire("contrat");
    const { body } = await request(serveurTest(app))
      .post("/api/contrats").set("Cookie", t.cookie)
      .send({ label: "Entretien annuel", cadence: "mensuel", amountCents: 12_000 })
      .expect(201);

    const rangees = await entrees(t.tenantId, "CONTRAT");
    expect(rangees).toHaveLength(1);
    expect(rangees[0].source_id).toBe(body.id);
    expect(rangees[0].name).toContain("Entretien annuel");
  });
});

describe("l'indexation est idempotente", () => {
  test("indexer deux fois le même document laisse UNE entrée", async () => {
    // L'unicité appartient au moteur — index partiel sur
    // (tenant, source_type, source_id). Un contrôle applicatif
    // « existe déjà ? » se contourne par deux requêtes simultanées.
    const t = await inscrire("idem");
    const { body } = await request(serveurTest(app))
      .post("/api/contrats").set("Cookie", t.cookie)
      .send({ label: "Doublon", cadence: "mensuel", amountCents: 1_000 })
      .expect(201);

    await adminPool.query(
      `INSERT INTO classeur_documents (id, tenant_id, name, category, source_type, source_id)
       VALUES ($1, $2, 'Contrat Doublon', 'CONTRAT', 'CONTRAT', $3)
       ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), t.tenantId, body.id],
    );

    expect(await entrees(t.tenantId, "CONTRAT")).toHaveLength(1);
  });

  test("deux fichiers déposés à la main peuvent coexister — ils n'ont pas de source", async () => {
    // Ce que ce test prouve : l'index d'unicité n'empêche pas deux documents
    // sans source. Ce n'est PAS la clause `WHERE source_id IS NOT NULL` qui
    // l'autorise — NULL est distinct de NULL dans un index unique PostgreSQL,
    // vérifié en retirant la clause : aucun test ne bouge. Le test garde sa
    // valeur, il documente juste une propriété du moteur plutôt qu'une garde.
    const t = await inscrire("depot");
    for (const nom of ["photo-1.jpg", "photo-2.jpg"]) {
      await adminPool.query(
        `INSERT INTO classeur_documents (id, tenant_id, name, category) VALUES ($1, $2, $3, 'DIVERS')`,
        [crypto.randomUUID(), t.tenantId, nom],
      );
    }
    const sansSource = (await entrees(t.tenantId)).filter((r) => r.source_id === null);
    expect(sansSource).toHaveLength(2);
  });
});

describe("l'isolation du Classeur", () => {
  test("le document d'un tenant n'apparaît pas chez un autre", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    await request(serveurTest(app))
      .post("/api/contrats").set("Cookie", a.cookie)
      .send({ label: "Secret Delacroix", cadence: "mensuel", amountCents: 1_000 })
      .expect(201);

    const { body } = await request(serveurTest(app))
      .get("/api/classeur").set("Cookie", b.cookie).expect(200);
    expect(JSON.stringify(body)).not.toContain("Delacroix");
  });
});

describe("la garde d'exhaustivité", () => {
  test("aucun document en base n'est absent du Classeur", async () => {
    // La garde qui rattrape ce que l'architecture ne peut pas empêcher : un
    // futur producteur qui oublierait d'appeler `indexerAuClasseur`.
    //
    // Elle porte sur TOUS les tenants de la base de test, pas seulement ceux
    // de ce fichier : c'est ce qui la rend sensible aux autres suites, qui
    // créent bien plus de documents que celle-ci.
    const manquants = await adminPool.query(`
      SELECT 'FACTURE' AS type, f.id FROM factures f
        WHERE NOT EXISTS (SELECT 1 FROM classeur_documents c
                           WHERE c.source_type = 'FACTURE' AND c.source_id = f.id)
      UNION ALL
      SELECT 'DEVIS', d.id FROM devis d
        WHERE NOT EXISTS (SELECT 1 FROM classeur_documents c
                           WHERE c.source_type = 'DEVIS' AND c.source_id = d.id)
      UNION ALL
      SELECT 'AVOIR', a.id FROM avoirs a
        WHERE NOT EXISTS (SELECT 1 FROM classeur_documents c
                           WHERE c.source_type = 'AVOIR' AND c.source_id = a.id)
      UNION ALL
      SELECT 'CONTRAT', ct.id FROM contrats ct
        WHERE NOT EXISTS (SELECT 1 FROM classeur_documents c
                           WHERE c.source_type = 'CONTRAT' AND c.source_id = ct.id)
      LIMIT 20
    `);

    const detail = manquants.rows.map((r) => `${r.type}:${r.id}`).join(", ");
    expect(
      manquants.rows,
      `documents absents du Classeur : ${detail}\n`
      + "→ un producteur de document n'appelle pas `indexerAuClasseur`.",
    ).toHaveLength(0);
  });
});
