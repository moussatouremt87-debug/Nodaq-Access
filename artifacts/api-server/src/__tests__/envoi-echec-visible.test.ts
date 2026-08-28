/**
 * Un envoi qui échoue doit se VOIR.
 *
 * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
 * `sendDocument` NE LÈVE PAS quand aucun SMTP n'est configuré : il REND
 * `success: false` avec `error: "aucun SMTP configuré"`. Deux routes ne le
 * lisaient pas.
 *
 * `factures.ts` JETAIT le résultat — le `try/catch` autour n'attrapait rien,
 * puisque rien n'était levé. La réponse ne portait aucune trace de l'échec, et
 * l'écran annonçait « Envoyée par e-mail » d'après la case cochée par
 * l'utilisateur. L'artisan croyait avoir facturé son client.
 *
 * `devis.ts` rendait le MODE d'envoi et l'avertissement de délivrabilité, mais
 * pas le succès — un devis jamais parti s'affichait comme envoyé.
 *
 * Ironie du dépôt : `membres.ts` (les invitations d'équipe) le faisait déjà
 * correctement, avec `envoye` et `motifEchec`. Les deux documents qui engagent
 * de l'argent étaient précisément les deux qui se taisaient.
 *
 * ── POURQUOI CES TESTS TIENNENT SANS RIEN SIMULER ─────────────────────────
 * En environnement de test, `getTransporter()` rend `null` par construction
 * (`canal-emission.ts` : « aucun test ne doit atteindre un serveur de
 * messagerie réel »). L'échec d'envoi est donc l'état NATUREL ici — il n'y a
 * rien à forcer, et c'est exactement la situation d'un déploiement sans SMTP.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie = "";

beforeAll(async () => {
  const email = `env-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Charpente Ferrand" })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  cookie = headers["set-cookie"][0];

  await request(serveurTest(app))
    .patch("/api/parametres")
    .set("Cookie", cookie)
    .send({ "company.siret": "81234567600009", "company.raison_sociale": "Charpente Ferrand" })
    .expect(200);
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

/** Une facture en brouillon, prête à émettre. TVA à 20 % : sans elle, l'audit
 *  Factur-X exige une mention justificative et refuse l'émission. */
async function brouillon(): Promise<string> {
  const { body } = await request(serveurTest(app))
    .post("/api/factures")
    .set("Cookie", cookie)
    .send({
      customerName: "Delacroix",
      issuedDate: "2026-08-01",
      dueDate: "2026-09-01",
      lines: [
        { description: "Pose", quantity: 1, unitPriceCents: 120000, vatRate: 20, vatCategory: "S" },
      ],
    })
    .expect(201);
  return body.id as string;
}

describe("Émettre une facture avec envoi", () => {
  test("l'échec d'envoi est AVOUÉ dans la réponse", async () => {
    const id = await brouillon();
    const { body } = await request(serveurTest(app))
      .post(`/api/factures/${id}/emettre`)
      .set("Cookie", cookie)
      .send({ sendEmail: true, emailTo: "delacroix@exemple.fr" })
      .expect(200);

    // LA garde du défaut : sans elle, la réponse ne disait rien.
    expect(body.envoiEmail).toBeDefined();
    expect(body.envoiEmail.demande).toBe(true);
    expect(body.envoiEmail.envoye).toBe(false);
    expect(body.envoiEmail.motifEchec).toBeTruthy();
  });

  test("l'émission RÉUSSIT quand même — la facture est numérotée et définitive", async () => {
    const id = await brouillon();
    const { body } = await request(serveurTest(app))
      .post(`/api/factures/${id}/emettre`)
      .set("Cookie", cookie)
      .send({ sendEmail: true, emailTo: "delacroix@exemple.fr" })
      .expect(200);

    // L'e-mail a échoué, l'émission non. Confondre les deux ferait croire
    // qu'on peut réémettre — or un numéro de facture ne se rejoue jamais.
    expect(body.number).toBeTruthy();
    expect(body.status).not.toBe("BROUILLON");
    expect(body.envoiEmail.envoye).toBe(false);
  });

  test("sans envoi demandé, rien n'est prétendu", async () => {
    const id = await brouillon();
    const { body } = await request(serveurTest(app))
      .post(`/api/factures/${id}/emettre`)
      .set("Cookie", cookie)
      .send({})
      .expect(200);

    expect(body.envoiEmail.demande).toBe(false);
    expect(body.envoiEmail.motifEchec).toBeNull();
  });
});

describe("Envoyer un devis", () => {
  test("le succès est rendu, pas seulement le mode d'envoi", async () => {
    const { body: devis } = await request(serveurTest(app))
      .post("/api/devis")
      .set("Cookie", cookie)
      .send({
        clientName: "Delacroix",
        validUntil: "2026-12-31",
        lines: [
          { description: "Charpente", quantity: 1, unitPriceCents: 500000, vatRate: 20, vatCategory: "S" },
        ],
      })
      .expect(201);

    const { body } = await request(serveurTest(app))
      .post(`/api/devis/${devis.id}/envoyer`)
      .set("Cookie", cookie)
      .send({ emailTo: "delacroix@exemple.fr" })
      .expect(200);

    expect(body.envoye).toBe(false);
    expect(body.motifEchec).toBeTruthy();
    // Le champ existant n'a pas bougé — la charge est ADDITIVE.
    expect(body).toHaveProperty("acceptUrl");
  });
});
