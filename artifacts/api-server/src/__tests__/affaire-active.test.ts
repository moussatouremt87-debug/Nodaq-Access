/**
 * Une affaire active, c'est la MÊME chose partout.
 *
 * Constaté le 29/08/2026 : quatre chantiers acceptés, avec devis signés, heures
 * pointées et factures — et un Cockpit qui affichait « Chantiers en cours : 0 ».
 * Six endroits comptaient les affaires actives, avec trois réponses
 * différentes.
 *
 * Ces tests visent le COMPORTEMENT observable, écran par écran, et non la
 * constante : c'est ce que voit l'artisan qui doit s'accorder, pas une liste
 * partagée dont chaque appelant ferait ensuite ce qu'il veut.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import {
  adminPool, cleanupTenants, cleanupUsers,
  completeMfaForRegisteredOwner, serveurTest,
} from "./helpers";
import { STATUTS_AFFAIRE_ACTIVE, estAffaireActive } from "../lib/affaire-active";

let cookie: string;
let tenantId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

async function affaire(status: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO affaires (id, tenant_id, label, client_name, status, origine)
     VALUES ($1, $2::uuid, $3, 'Client Test', $4, 'DIRECT')`,
    [crypto.randomUUID(), tenantId, `Chantier ${status}`, status],
  );
}

beforeAll(async () => {
  const email = `affaire-active-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Tenant Affaires" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(serveurTest(app))
    .get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);
}, 120_000);

afterAll(async () => {
  await adminPool.query(`DELETE FROM affaires WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

const get = (chemin: string) =>
  request(serveurTest(app)).get(`/api${chemin}`).set("Cookie", cookie);

describe("un chantier ACCEPTEE est un chantier en cours", () => {
  /*
   * LA garde née du constat. `ACCEPTEE` est le statut que produit la
   * conversion d'un devis accepté — le chemin normal du métier. Rien ne fait
   * jamais passer une affaire en `EN_COURS` par la suite : seul l'import de
   * reprise écrit ce statut.
   */
  test("le Cockpit le compte", async () => {
    await affaire("ACCEPTEE");
    const res = await get("/cockpit/kpis");
    expect(res.status).toBe(200);
    expect(res.body.affairesEnCours).toBeGreaterThan(0);
  });

  test("l'écran Affaires le rend, et le Cockpit annonce le même nombre", async () => {
    const liste = await get("/affaires");
    const actives = (liste.body.affaires as Array<{ status: string }>)
      .filter((a) => estAffaireActive(a.status)).length;
    const kpis = await get("/cockpit/kpis");
    // Deux écrans, un seul nombre. C'est exactement ce qui divergeait.
    expect(kpis.body.affairesEnCours).toBe(actives);
  });
});

describe("la définition est partagée, pas recopiée", () => {
  test("les deux statuts du parcours normal en font partie", () => {
    expect(estAffaireActive("ACCEPTEE")).toBe(true);
    expect(estAffaireActive("EN_COURS")).toBe(true);
  });

  test("un statut terminal n'en fait pas partie", () => {
    for (const fini of ["TERMINEE", "PERDUE", "ARCHIVEE", "PROSPECT"]) {
      expect(estAffaireActive(fini), `${fini} ne doit pas être actif`).toBe(false);
    }
  });

  /*
   * Les variantes accentuées sont conservées volontairement — aucun chemin
   * d'écriture actuel ne les produit, mais une base existante peut les porter.
   * Ce test les fige : les retirer devra être un geste délibéré, pas un
   * nettoyage de passage.
   */
  test("les variantes accentuées historiques restent reconnues", () => {
    expect(estAffaireActive("ACCEPTÉE")).toBe(true);
    expect(estAffaireActive("ACCEPTÉ")).toBe(true);
    expect(STATUTS_AFFAIRE_ACTIVE).toHaveLength(4);
  });
});
