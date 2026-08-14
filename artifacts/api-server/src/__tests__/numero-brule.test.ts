/**
 * Un numéro attribué qui ne deviendra jamais une facture — et sa trace.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UN TROU DANS UNE NUMÉROTATION DOIT POUVOIR S'EXPLIQUER À UN CONTRÔLEUR. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * L'ordre des opérations dans `/emettre` est un arbitrage assumé : le numéro
 * est attribué et validé en base AVANT la génération du PDF, pour que le PDF
 * porte le vrai numéro légal. Si le PDF échoue ensuite, le numéro est perdu et
 * la séquence saute. Mieux vaut un trou qu'une facture légalement émise sans
 * son PDF archivé.
 *
 * Mais pour un contrôleur, une séquence qui passe de 0007 à 0009 est une
 * facture manquante jusqu'à preuve du contraire. Ce test vérifie que la preuve
 * existe : le numéro brûlé et la raison, au moment où cela se produit.
 *
 * ── POURQUOI UN FICHIER À PART ──────────────────────────────────────────────
 * `vi.mock` s'applique au module entier pour tout le fichier. Faire échouer la
 * génération de PDF au milieu de `facturation.test.ts` ferait tomber les tests
 * qui, eux, ont besoin d'un vrai PDF.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Seul `archiveFacturxPdf` échoue ; tout le reste du module est le vrai.
// Un mock total priverait la route de `buildFacturxInvoice` et
// `auditMentionsFR`, et le test ne prouverait plus rien du chemin réel.
vi.mock("../lib/pdf-generation.js", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../lib/pdf-generation.js")>();
  return {
    ...reel,
    archiveFacturxPdf: vi.fn(async () => {
      throw new Error("échec de génération simulé");
    }),
  };
});

const { default: app } = await import("../app");
const { logger } = await import("../lib/logger.js");

const emails: string[] = [];
const tenants: string[] = [];
let cookie = "";

beforeAll(async () => {
  const email = `brule-${Date.now()}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Owner", tenantNom: "Corp Brûlée" })
    .expect(201);
  const { completeMfaForRegisteredOwner } = await import("./helpers");
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const me = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenants.push(me.body.tenantId);

  // Mentions légales : sans elles l'émission serait refusée AVANT l'attribution
  // du numéro, et le test ne traverserait jamais le chemin visé. Même voie que
  // `facturation.test.ts` — l'API réelle, RLS comprise. Le SIRET satisfait Luhn.
  await request(app)
    .patch("/api/parametres")
    .set("Cookie", cookie)
    .send({ "company.siret": "81234567600009", "company.nom": "Corp Brûlée" })
    .expect(200);
});

afterAll(async () => {
  const { cleanupTenants, cleanupUsers } = await import("./helpers");
  await cleanupTenants(...tenants);
  await cleanupUsers(...emails);
});

describe("numéro brûlé", () => {
  test("un PDF qui échoue laisse une trace nommant le numéro et la raison", async () => {
    const brouillon = await request(app)
      .post("/api/factures")
      .set("Cookie", cookie)
      .send({
        customerName: "Client Test SAS",
        issuedDate: "2026-08-01",
        dueDate: "2026-09-01",
        lines: [
          { description: "Travaux", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" },
        ],
        attestationTvaFournie: true,
      })
      .expect(201);

    const avertissements = vi.spyOn(logger, "warn");
    try {
      const res = await request(app)
        .post(`/api/factures/${brouillon.body.id}/emettre`)
        .set("Cookie", cookie)
        .send({ issuedDate: "2026-08-01", dueDate: "2026-09-01" });

      // La facture n'est PAS émise — c'est tout l'intérêt de l'arbitrage.
      expect({ status: res.status, corps: res.body }).toMatchObject({ status: 500 });

      const brules = avertissements.mock.calls.filter(
        ([contexte]) => (contexte as { etape?: string } | undefined)?.etape === "numero_brule",
      );
      expect(brules).toHaveLength(1);

      // Le numéro ET la raison : un contrôleur doit pouvoir relier le trou de
      // la séquence à un incident daté, pas à une facture disparue.
      expect(brules[0]?.[0]).toMatchObject({
        raison: "echec_generation_pdf",
        numero: expect.stringMatching(/^FACT-2026-\d{4}$/),
      });
    } finally {
      avertissements.mockRestore();
    }

    // Et la facture est restée BROUILLON, donc réémettable.
    const apres = await request(app)
      .get(`/api/factures/${brouillon.body.id}`)
      .set("Cookie", cookie);
    expect(apres.body.statut).toBe("BROUILLON");
  });
});
