/**
 * canal-emission.ts — branche PLATEFORME_AGREEE (US-A2.6).
 *
 * Rien n'appelle sendDocument({ canal: "PLATEFORME_AGREEE" }) depuis une
 * route aujourd'hui (factures.ts envoie toujours par EMAIL) — ce fichier
 * teste la fonction directement. Le chemin réaliste tant qu'aucune PA n'est
 * contractée est PaConfigError (a) ; le chemin de succès (b) prouve le
 * câblage — extraction XML, appel à submitInvoice, écriture pa_transmissions
 * — avec fetch simulé, sans réseau réel.
 */
import { describe, test, expect, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import { buildCiiXml, buildFacturXPdf, type FacturXInvoice } from "@nodaq/facturx";
import { sendDocument } from "../lib/canal-emission";
import { adminPool, createTestTenant, cleanupTenants } from "./helpers";

const cleanupTenantIds: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env["PA_BASE_URL"];
  delete process.env["PA_API_KEY"];
});

const INVOICE: FacturXInvoice = {
  number: "F-PA-0001",
  issueDate: "2026-08-10",
  dueDate: "2026-09-10",
  currency: "EUR",
  operationCategory: "prestation_services",
  seller: {
    name: "Émetteur PA SARL",
    siret: "81234567600009",
    vatNumber: "FR12812345676",
    address: { street: "1 rue Test", postalCode: "75001", city: "Paris", countryCode: "FR" },
  },
  buyer: {
    name: "Client PA",
    siret: "52345678800018",
    address: { street: "2 rue Client", postalCode: "75002", city: "Paris", countryCode: "FR" },
  },
  lines: [{ description: "Prestation", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" }],
  totals: { netCents: 100_000, vatCents: 20_000, grossCents: 120_000, dueCents: 120_000 },
};

async function facturXPdf(): Promise<Buffer> {
  const xml = buildCiiXml(INVOICE, "EN16931");
  return Buffer.from(await buildFacturXPdf(INVOICE, xml, "EN16931"));
}

describe("a — sans plateforme agréée configurée (le chemin réaliste aujourd'hui)", () => {
  test("PaConfigError → résultat en échec explicite, sans lever", async () => {
    const pdf = await facturXPdf();
    const result = await sendDocument({
      canal: "PLATEFORME_AGREEE",
      tenantId: crypto.randomUUID(),
      to: "n/a",
      subject: "n/a",
      body: "n/a",
      documentType: "FACTURE",
      documentId: "fact-test-1",
      attachments: [{ filename: "facture.pdf", content: pdf }],
    });
    expect(result.success).toBe(false);
    expect(result.stub).toMatch(/Aucune plateforme agréée/);
  });
});

describe("b — plateforme agréée configurée (fetch simulé) : câblage complet", () => {
  test("aucune pièce jointe : échec explicite, aucun appel réseau tenté (config résolue avant la vérification)", async () => {
    process.env["PA_BASE_URL"] = "http://pa.test/v1";
    process.env["PA_API_KEY"] = "test-key";
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    const result = await sendDocument({
      canal: "PLATEFORME_AGREEE",
      tenantId: crypto.randomUUID(),
      to: "n/a",
      subject: "n/a",
      body: "n/a",
      documentType: "FACTURE",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Aucun document/);
    expect(spy).not.toHaveBeenCalled();
  });

  test("XML extrait, submitInvoice appelée, statut écrit dans pa_transmissions", async () => {
    process.env["PA_BASE_URL"] = "http://pa.test/v1";
    process.env["PA_API_KEY"] = "test-key";

    const t = await createTestTenant("PA Emission Test");
    cleanupTenantIds.push(t.id);

    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ submissionId: "sub-abc", status: "deposee" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", spy);

    const pdf = await facturXPdf();
    const documentId = `fact-${t.id}`;
    const result = await sendDocument({
      canal: "PLATEFORME_AGREEE",
      tenantId: t.id,
      to: "n/a",
      subject: "n/a",
      body: "n/a",
      documentType: "FACTURE",
      documentId,
      attachments: [{ filename: "facture.pdf", content: pdf }],
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("sub-abc");

    // La requête a atteint {PA_BASE_URL}/invoices avec le XML en payload.
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://pa.test/v1/invoices");
    const body = JSON.parse(init.body as string);
    expect(body.documentId).toBe(documentId);
    expect(body.payload).toContain("<rsm:CrossIndustryInvoice");

    const { rows } = await adminPool.query(
      `SELECT statut, submission_id FROM pa_transmissions WHERE tenant_id = $1 AND document_id = $2`,
      [t.id, documentId],
    );
    expect(rows[0]?.statut).toBe("deposee");
    expect(rows[0]?.submission_id).toBe("sub-abc");
  });

  test("un document déjà encaissé n'est jamais rouvert par un statut antérieur rejoué", async () => {
    process.env["PA_BASE_URL"] = "http://pa.test/v1";
    process.env["PA_API_KEY"] = "test-key";

    const t = await createTestTenant("PA Emission Rejeu Test");
    cleanupTenantIds.push(t.id);
    const documentId = `fact-rejeu-${t.id}`;

    await adminPool.query(
      `INSERT INTO pa_transmissions (id, tenant_id, document_type, document_id, statut)
       VALUES ($1, $2::uuid, 'FACTURE', $3, 'encaissee')`,
      [crypto.randomUUID(), t.id, documentId],
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ submissionId: "sub-rejeu", status: "deposee" }), { status: 200 }),
      ),
    );

    const pdf = await facturXPdf();
    await sendDocument({
      canal: "PLATEFORME_AGREEE",
      tenantId: t.id,
      to: "n/a",
      subject: "n/a",
      body: "n/a",
      documentType: "FACTURE",
      documentId,
      attachments: [{ filename: "facture.pdf", content: pdf }],
    });

    const { rows } = await adminPool.query(
      `SELECT statut FROM pa_transmissions WHERE tenant_id = $1 AND document_id = $2`,
      [t.id, documentId],
    );
    // Toujours "encaissee" — jamais rétrogradé à "deposee".
    expect(rows[0]?.statut).toBe("encaissee");
  });

  test("échec réseau : statut 'erreur' écrit, résultat en échec sans lever", async () => {
    process.env["PA_BASE_URL"] = "http://pa.test/v1";
    process.env["PA_API_KEY"] = "test-key";

    const t = await createTestTenant("PA Emission Echec Test");
    cleanupTenantIds.push(t.id);
    const documentId = `fact-echec-${t.id}`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("erreur serveur", { status: 500 })),
    );

    const pdf = await facturXPdf();
    const result = await sendDocument({
      canal: "PLATEFORME_AGREEE",
      tenantId: t.id,
      to: "n/a",
      subject: "n/a",
      body: "n/a",
      documentType: "FACTURE",
      documentId,
      attachments: [{ filename: "facture.pdf", content: pdf }],
    });

    expect(result.success).toBe(false);

    const { rows } = await adminPool.query(
      `SELECT statut FROM pa_transmissions WHERE tenant_id = $1 AND document_id = $2`,
      [t.id, documentId],
    );
    expect(rows[0]?.statut).toBe("erreur");
  });
});

afterEach(async () => {
  if (cleanupTenantIds.length > 0) {
    await adminPool.query(`DELETE FROM pa_transmissions WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
    await cleanupTenants(...cleanupTenantIds);
    cleanupTenantIds.length = 0;
  }
});
