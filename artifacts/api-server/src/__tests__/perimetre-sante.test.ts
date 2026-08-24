/*
 * La limite de périmètre en santé, sur les vraies routes — US-B9.4.
 *
 * `perimetre-sante-exhaustif.test.ts` éprouve la STRUCTURE : aucune zone de
 * prose du schéma n'échappe au classement. Celui-ci éprouve le COMPORTEMENT :
 * un praticien bute réellement sur la limite, et un maçon ne la voit jamais.
 *
 * ── La moitié qui compte autant que le refus ──────────────────────────────
 * Une garde qui refuserait tout passerait les tests de refus sans protéger
 * personne — et surtout, elle supprimerait le produit pour ce secteur. La
 * moitié des tests ci-dessous vérifie donc que le praticien peut TOUJOURS
 * facturer, encaisser et suivre sa trésorerie. C'est la règle 3 bis a du
 * dépôt : un refus rédigé trop largement attrape le cœur du métier.
 */
import { describe, test, expect, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];

async function inscrire(nom: string, vertical: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `sante-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Cabinet ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, 'votre-metier.metier', $2)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [body.tenantId, vertical],
  );
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

const poster = (cookie: string, chemin: string, corps: Record<string, unknown>) =>
  request(serveurTest(app)).post(`/api${chemin}`).set("Cookie", cookie).send(corps);

afterAll(async () => {
  await adminPool.query(`DELETE FROM sites WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await adminPool.query(`DELETE FROM factures WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await adminPool.query(`DELETE FROM devis WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("un praticien ne PEUT pas saisir de prose sur un patient", () => {
  test("une note sur un client est refusée, avec orientation", async () => {
    const t = await inscrire("kine", "sante_liberale");
    const { body } = await poster(t.cookie, "/clients", {
      nom: "Madame Martin", notes: "Lombalgie chronique, séances hebdomadaires",
    }).expect(422);

    expect(body.code).toBe("PERIMETRE_HORS_HDS");
    expect(body.champsRefuses).toContain("notes");
    expect(body.error).toMatch(/HDS/);
    // Et rien n'a été créé : un refus qui laisserait la fiche derrière lui
    // aurait enregistré la donnée qu'il prétend interdire.
    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM clients WHERE tenant_id = $1", [t.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  test("le refus ORIENTE vers un outil certifié, il ne dit pas seulement non", async () => {
    // Quatrième critère. « Champ non autorisé » se lit comme un défaut ; il
    // faut dire où va cette information.
    const t = await inscrire("orient", "sante_liberale");
    const { body } = await poster(t.cookie, "/clients", { nom: "X", notes: "diagnostic" }).expect(422);
    expect(body.error).toMatch(/logiciel métier/);
  });

  test("le refus dit que la FACTURATION continue — règle 3 bis a", async () => {
    // Sans cette phrase, le praticien conclut que nodaq ne sert à rien pour
    // lui, et le produit recommande la concurrence dans sa première minute.
    const t = await inscrire("bisa", "sante_liberale");
    const { body } = await poster(t.cookie, "/clients", { nom: "X", notes: "d" }).expect(422);
    expect(body.error).toMatch(/factur/i);
  });

  test("une note sur un SITE est refusée aussi — US-B7.1", async () => {
    // Un site est rattaché à un CLIENT, et en santé le client est le patient.
    // « Accès difficile, patient en fauteuil » est une donnée de santé autant
    // qu'un diagnostic.
    //
    // Ce test existe parce que la garde structurelle a REFUSÉ de passer quand
    // la table `sites` est arrivée. Elle exige une entrée dans la liste ; elle
    // ne prouve pas que le refus s'applique — d'où ce test-ci.
    const t = await inscrire("site", "sante_liberale");
    const cl = crypto.randomUUID();
    await adminPool.query(
      `INSERT INTO clients (id, tenant_id, nom) VALUES ($1, $2::uuid, 'Madame Martin')`,
      [cl, t.tenantId],
    );

    const { body } = await poster(t.cookie, "/sites", {
      clientId: cl, libelle: "Domicile", notes: "Accès difficile, patient en fauteuil",
    }).expect(422);
    expect(body.code).toBe("PERIMETRE_HORS_HDS");

    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM sites WHERE tenant_id = $1", [t.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  test("effacer une note reste possible", async () => {
    // Le geste qu'on veut ENCOURAGER. Le refuser empêcherait de nettoyer ce
    // qui a déjà été saisi avant la mise en place de la limite.
    const t = await inscrire("effacer", "sante_liberale");
    await poster(t.cookie, "/clients", { nom: "Madame Martin", notes: "" }).expect(201);
  });
});

describe("le produit reste ENTIER pour ce praticien", () => {
  test("il crée un client sans note", async () => {
    const t = await inscrire("client", "sante_liberale");
    const { body } = await poster(t.cookie, "/clients", { nom: "Madame Martin" }).expect(201);
    expect(body.nom).toBe("Madame Martin");
  });

  test("il facture une consultation — le libellé de LIGNE n'est pas visé", async () => {
    // C'est le cœur du métier. Bloquer la description d'une ligne rendrait la
    // facturation impossible, c'est-à-dire supprimerait le produit.
    const t = await inscrire("facture", "sante_liberale");
    const { body } = await poster(t.cookie, "/factures", {
      customerName: "Madame Martin",
      issuedDate: "2026-08-24", dueDate: "2026-09-23",
      lines: [{ description: "Séance de rééducation", quantity: 3, unitPriceCents: 5_000, vatRate: 0 }],
    }).expect(201);
    expect(body.totalHTCents).toBe(15_000);
  });

  test("il consulte sa trésorerie", async () => {
    const t = await inscrire("treso", "sante_liberale");
    await request(serveurTest(app)).get("/api/cockpit/kpis").set("Cookie", t.cookie).expect(200);
  });
});

describe("les autres secteurs ne voient jamais cette limite", () => {
  test.each(["batiment", "professions_liberales"])("un tenant %s note librement", async (v) => {
    // `professions_liberales` porte un secret professionnel mais pas de donnée
    // de santé : un avocat n'a pas de dossier médical, et lui retirer ses
    // notes serait une restriction sans fondement.
    const t = await inscrire(`libre-${v}`, v);
    await poster(t.cookie, "/clients", {
      nom: "Client", notes: "Rappeler avant le 15, dossier en cours",
    }).expect(201);
  });
});

describe("le Classeur — pièces jointes", () => {
  test("un document rattaché à un DOSSIER patient est refusé", async () => {
    // Un compte-rendu scanné et accroché au dossier : exactement l'entrée de
    // données cliniques « par la bande » que la story nomme.
    const t = await inscrire("classeur", "sante_liberale");
    const a = crypto.randomUUID();
    await adminPool.query(
      `INSERT INTO affaires (id, tenant_id, label, status) VALUES ($1, $2::uuid, 'Suivi', 'EN_COURS')`,
      [a, t.tenantId],
    );

    const { body } = await request(serveurTest(app))
      .post("/api/classeur").set("Cookie", t.cookie)
      .field("affaireId", a)
      .attach("file", Buffer.from("%PDF-1.4 compte rendu"), {
        filename: "cr.pdf", contentType: "application/pdf",
      })
      .expect(422);
    expect(body.code).toBe("PERIMETRE_HORS_HDS");
  });

  test("un document d'ENTREPRISE reste téléversable", async () => {
    // Une facture fournisseur, une attestation d'assurance : rattachées à
    // personne. Les interdire aurait privé le cabinet de son classeur
    // comptable sans rien protéger.
    const t = await inscrire("compta", "sante_liberale");
    await request(serveurTest(app))
      .post("/api/classeur").set("Cookie", t.cookie)
      .attach("file", Buffer.from("%PDF-1.4 facture edf"), {
        filename: "edf.pdf", contentType: "application/pdf",
      })
      .expect(201);
  });
});
