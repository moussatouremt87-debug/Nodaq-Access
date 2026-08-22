/**
 * Un chantier en cours doit être POINTABLE — ticket 4.31.
 *
 * Verbatim du test du 22/08 : « Quand je crée un chantier en cours, pourquoi
 * il n'apparaît pas dans les heures de la semaine ? »
 *
 * ── La cause ──────────────────────────────────────────────────────────────
 * La proposition hebdomadaire est bâtie sur les AFFECTATIONS et la semaine
 * type. Un chantier créé sans y envoyer personne n'y produit aucune ligne — ce
 * qui est correct : proposer des heures là où personne n'a travaillé, ce
 * serait fabriquer du temps.
 *
 * Le défaut était ailleurs : il n'existait AUCUN moyen d'ajouter cette ligne.
 * Le chantier existait, il était en cours, et aucune heure ne pouvait s'y
 * rattacher.
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

beforeAll(async () => {
  const email = `chp-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Chantier SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantId = body.tenantId;
  tenantIds.push(tenantId);
  cookie = headers["set-cookie"][0];
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

/** Une affaire EN_COURS, sans aucune affectation. */
async function chantierSansAffectation(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO affaires (id, tenant_id, label, status) VALUES ($1, $2::uuid, $3, 'EN_COURS')`,
    [id, tenantId, label],
  );
  return id;
}

const recap = () =>
  request(serveurTest(app)).get("/api/pointages/recapitulatif-semaine").set("Cookie", cookie);

describe("a — le chantier non affecté devient atteignable", () => {
  test("il ne produit AUCUNE ligne pré-remplie, et c'est voulu", async () => {
    const id = await chantierSansAffectation("Toiture Delacroix");
    const { body } = await recap().expect(200);

    // Aucune heure proposée : personne n'y a été envoyé. Proposer du temps ici
    // serait en fabriquer.
    expect(body.lignes.some((l: { affaireId: string }) => l.affaireId === id)).toBe(false);
  });

  test("il figure dans les chantiers disponibles", async () => {
    const id = await chantierSansAffectation("Bardage Morel");
    const { body } = await recap().expect(200);

    // C'EST le correctif : sans cette liste, l'écran n'offrait aucun moyen
    // d'ajouter la ligne, et le chantier restait impointable.
    const dispo = body.chantiersDisponibles as Array<{ affaireId: string | null; libelle: string }>;
    expect(dispo.some((c) => c.affaireId === id)).toBe(true);
    expect(dispo.find((c) => c.affaireId === id)?.libelle).toBe("Bardage Morel");
  });

  test("un chantier TERMINÉ n'est pas proposé", async () => {
    const id = await chantierSansAffectation("Fini depuis longtemps");
    await adminPool.query(`UPDATE affaires SET status = 'TERMINEE' WHERE id = $1`, [id]);

    const { body } = await recap().expect(200);
    // Le même filtre que pour les lignes : on ne pointe pas du temps neuf sur
    // un chantier clos.
    expect(
      (body.chantiersDisponibles as Array<{ affaireId: string | null }>).some(
        (c) => c.affaireId === id,
      ),
    ).toBe(false);
  });
});

describe("b — pas de doublon entre la proposition et la liste", () => {
  test("un chantier DÉJÀ dans les lignes n'est pas reproposé", async () => {
    const id = await chantierSansAffectation("Déjà pointé");
    const [membre] = (
      await adminPool.query(`SELECT id FROM team_members WHERE tenant_id = $1 LIMIT 1`, [tenantId])
    ).rows;
    if (!membre) {
      // Un tenant neuf peut n'avoir aucun membre : on en crée un.
      await adminPool.query(
        `INSERT INTO team_members (id, tenant_id, name, role) VALUES ($1, $2::uuid, 'Thomas', 'OUVRIER')`,
        [crypto.randomUUID(), tenantId],
      );
    }
    const membreId = (
      await adminPool.query(`SELECT id FROM team_members WHERE tenant_id = $1 LIMIT 1`, [tenantId])
    ).rows[0].id as string;

    await adminPool.query(
      `INSERT INTO pointages (id, tenant_id, membre_id, affaire_id, date, heures, source)
       VALUES ($1, $2::uuid, $3, $4, current_date, 7, 'confirme')`,
      [crypto.randomUUID(), tenantId, membreId, id],
    );

    const { body } = await recap().expect(200);
    // Le reproposer ferait créer un doublon là où il fallait corriger une
    // ligne existante.
    expect(body.lignes.some((l: { affaireId: string }) => l.affaireId === id)).toBe(true);
    expect(
      (body.chantiersDisponibles as Array<{ affaireId: string | null }>).some(
        (c) => c.affaireId === id,
      ),
    ).toBe(false);
  });
});

describe("c — isolation", () => {
  test("les chantiers d'un autre tenant n'apparaissent pas", async () => {
    const autre = `chp2-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
    emails.push(autre);
    const { body: b2, headers: h2 } = await request(serveurTest(app))
      .post("/api/auth/register")
      .send({ email: autre, password: "test-pass-1234", nom: "B", tenantNom: "Voisin" })
      .expect(201);
    await completeMfaForRegisteredOwner(b2.userId);
    tenantIds.push(b2.tenantId);

    const id = await chantierSansAffectation("Chez nous seulement");
    const { body } = await request(serveurTest(app))
      .get("/api/pointages/recapitulatif-semaine")
      .set("Cookie", h2["set-cookie"][0])
      .expect(200);

    expect(
      (body.chantiersDisponibles as Array<{ affaireId: string | null }>).some(
        (c) => c.affaireId === id,
      ),
    ).toBe(false);
  });
});
