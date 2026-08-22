/**
 * L'invitation dit la VÉRITÉ sur son envoi — ticket 4.27.
 *
 * Verbatim du test du 22/08 : « Quand j'invite un comptable, je check la boîte
 * mail, aucune invitation n'apparaît même dans les spams. »
 *
 * ── La cause ──────────────────────────────────────────────────────────────
 * Aucun SMTP n'est configuré sur ce déploiement : `getTransporter()` rend
 * `null`, `sendDocument` journalise « échec » et ne poste rien. La route
 * répondait pourtant 201, et l'écran affichait « Un e-mail a été envoyé à … »
 * SANS regarder le résultat. Le comptable attendait un courrier qui ne
 * partirait jamais, et rien dans le produit ne le disait.
 *
 * En test, `getTransporter()` rend `null` d'emblée (NODE_ENV=test) : ce fichier
 * décrit donc exactement la situation vécue en production sur ce déploiement.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { createHash } from "node:crypto";
import app from "../app.js";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie = "";
let tenantId = "";

beforeAll(async () => {
  const email = `inv-owner-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Invit SARL" })
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

/** Invite un comptable et rend la réponse. */
async function inviter(): Promise<Record<string, unknown>> {
  const invite = `compta-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@cabinet.test`;
  emails.push(invite);
  const { body } = await request(app)
    .post("/api/membres/inviter")
    .set("Cookie", cookie)
    .send({ email: invite, role: "ACCOUNTANT" })
    .expect(201);
  return body as Record<string, unknown>;
}

describe("a — sans SMTP, la réponse ne prétend pas que le courrier est parti", () => {
  test("`envoye` vaut false, et le motif est dit", async () => {
    const body = await inviter();
    // C'EST le point. Avant, seul un 201 revenait, et l'écran en déduisait un
    // succès.
    expect(body["envoye"]).toBe(false);
    expect(String(body["motifEchec"])).toContain("SMTP");
  });

  test("le journal d'envoi enregistre l'échec, pas un succès", async () => {
    await inviter();
    const { rows } = await adminPool.query(
      `SELECT statut FROM envois_journal
        WHERE tenant_id = $1 ORDER BY envoye_le DESC LIMIT 1`, [tenantId],
    );
    expect(rows[0]?.statut).toBe("echec");
  });
});

describe("b — le lien de secours permet d'inviter quand même", () => {
  test("le lien rendu est bien celui de l'invitation créée", async () => {
    const body = await inviter();
    const lien = String(body["lienInvitation"]);
    expect(lien).toContain("/membres/accepter/");

    // Le jeton en clair n'existe qu'ici : la base n'en garde que le condensat.
    // On vérifie donc que le lien rendu correspond bien à la LIGNE créée, et
    // pas à un jeton fabriqué au hasard.
    const jeton = lien.split("/membres/accepter/")[1]!;
    const condensat = createHash("sha256").update(jeton).digest("hex");
    const { rows } = await adminPool.query(
      `SELECT id FROM tenant_invites WHERE token_sha256 = $1`, [condensat],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(body["id"]);
  });

  test("le lien fonctionne réellement : l'aperçu de l'invitation répond", async () => {
    const body = await inviter();
    const jeton = String(body["lienInvitation"]).split("/membres/accepter/")[1]!;
    // Un lien qu'on donne à copier doit mener quelque part — sinon on a
    // remplacé un e-mail qui n'arrive pas par une adresse qui ne marche pas.
    const apercu = await request(app).get(`/api/membres/inviter/${jeton}`).expect(200);
    expect(apercu.body.email).toBe(body["email"]);
  });

  test("un jeton inventé ne donne rien", async () => {
    await request(app)
      .get(`/api/membres/inviter/${crypto.randomBytes(32).toString("hex")}`)
      .expect(404);
  });
});

describe("c — le condensat seul est conservé", () => {
  test("le jeton en clair n'est nulle part en base", async () => {
    const body = await inviter();
    const jeton = String(body["lienInvitation"]).split("/membres/accepter/")[1]!;
    // Le rendre dans la réponse HTTP n'autorise pas à le STOCKER : un jeton
    // lisible en base serait un mot de passe en clair.
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM tenant_invites
        WHERE tenant_id = $1 AND token_sha256 = $2`, [tenantId, jeton],
    );
    expect(rows[0].n).toBe(0);
  });
});
