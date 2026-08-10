/**
 * PDF de devis.
 *
 * Ce que ces tests protègent :
 *   — le PDF se rend, porte les lignes, les trois totaux et le nom de
 *     l'entreprise ;
 *   — il ne contient PAS les mentions de pénalités de retard, qui ne
 *     concernent que les factures ;
 *   — l'e-mail d'envoi porte exactement une pièce jointe ;
 *   — le lien public sert le PDF par le JETON, rend 404 sur un jeton inconnu,
 *     et n'ouvre rien sur le devis d'un autre tenant ;
 *   — le PDF reste servi APRÈS acceptation.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import zlib from "node:zlib";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers } from "./helpers";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
let a: Locataire;
let b: Locataire;

let compteurIp = 0;
const ipUnique = (): string => `203.0.113.${(compteurIp++ % 250) + 1}`;
const publicGet = (chemin: string) => request(app).get(chemin).set("X-Forwarded-For", ipUnique());

async function inscrire(nom: string): Promise<Locataire> {
  const email = `pdfdevis-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

/** Devis créé par l'API, avec des lignes réelles. */
async function creerDevis(l: Locataire): Promise<{ id: string; reference: string }> {
  const { body } = await request(app).post("/api/devis").set("Cookie", l.cookie)
    .send({
      clientName: "Madame Bernard",
      validUntil: "2027-12-31",
      lines: [
        { description: "Cloison BA13", quantity: 30, unitPriceCents: 4_500, vatRate: 10, unit: "m2" },
        { description: "Peinture deux couches", quantity: 30, unitPriceCents: 2_000, vatRate: 10, unit: "m2" },
      ],
    })
    .expect(201);
  return { id: body.id, reference: body.reference };
}

/**
 * Le texte d'un PDF, flux décompressés ET chaînes recollées.
 *
 * Deux obstacles, tous deux réels :
 *
 *  1. pdfkit COMPRESSE les flux de contenu (Flate) — lire les octets bruts ne
 *     montre que l'en-tête et les tables d'objets ;
 *  2. il écrit le texte en CHAÎNES HEXADÉCIMALES découpées par le CRÉNAGE :
 *     `[<4465> 15 <766973206eb0…>] TJ` vaut « Devis n° … ». Les nombres de
 *     crénage s'intercalent entre les fragments, donc décoder chaque chaîne
 *     séparément ne recolle pas « Devis ».
 *
 * On inflate, puis on traite chaque tableau `[…] TJ` en BLOC : les fragments
 * hexadécimaux sont décodés et concaténés, les nombres de crénage jetés.
 */
function texteBrut(pdf: Buffer): string {
  const flux: string[] = [];
  let i = 0;
  for (;;) {
    const debut = pdf.indexOf("stream", i);
    if (debut === -1) break;
    let d = debut + "stream".length;
    if (pdf[d] === 0x0d) d++;
    if (pdf[d] === 0x0a) d++;
    const fin = pdf.indexOf("endstream", d);
    if (fin === -1) break;
    try {
      flux.push(zlib.inflateSync(pdf.subarray(d, fin)).toString("latin1"));
    } catch {
      // Flux non compressé ou binaire — polices, images : rien à en tirer.
    }
    i = fin + 1;
  }

  const decodeHex = (hex: string): string => {
    const propre = hex.replace(/\s+/g, "");
    if (propre.length === 0 || propre.length % 2 !== 0) return "";
    return Buffer.from(propre, "hex").toString("latin1");
  };

  const lisible = flux
    .join("\n")
    .replace(/\[([^\]]*)\]\s*TJ/g, (_tout, contenu: string) =>
      [...contenu.matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((m) => decodeHex(m[1]!)).join(""),
    );

  return lisible;
}

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
  for (const [cle, valeur] of [["company.nom", "Toiture Martin SARL"], ["company.siret", "12345678901234"]]) {
    await adminPool.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [a.tenantId, cle, valeur],
    );
  }
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── Le PDF lui-même ─────────────────────────────────────────────────────────

describe("le PDF d'un devis se rend", () => {
  test("la route authentifiée rend un PDF non vide", async () => {
    const d = await creerDevis(a);
    const r = await request(app).get(`/api/devis/${d.id}/pdf`).set("Cookie", a.cookie).expect(200);
    expect(r.headers["content-type"]).toContain("application/pdf");
    expect(r.headers["content-disposition"]).toContain(".pdf");
    // Un PDF commence par %PDF-. Sans ce contrôle, un corps vide passerait.
    expect(r.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.body.length).toBeGreaterThan(1000);
  });

  test("il porte le titre DEVIS, pas FACTURE", async () => {
    const d = await creerDevis(a);
    const r = await request(app).get(`/api/devis/${d.id}/pdf`).set("Cookie", a.cookie).expect(200);
    const texte = texteBrut(r.body as Buffer);
    expect(texte).toContain("Devis n");
    expect(texte).not.toContain("Facture n");
  });

  test("il NE contient PAS les mentions de pénalités de retard", async () => {
    // Elles ne concernent que les factures. Les faire figurer sur un devis
    // annoncerait une créance là où il n'y a qu'une proposition.
    const d = await creerDevis(a);
    const r = await request(app).get(`/api/devis/${d.id}/pdf`).set("Cookie", a.cookie).expect(200);
    const texte = texteBrut(r.body as Buffer);
    expect(texte).not.toContain("nalit");        // « pénalités de retard »
    expect(texte).not.toContain("recouvrement");
    expect(texte).not.toContain("L.441-10");
  });

  test("un devis d'un autre tenant n'est pas atteignable", async () => {
    const d = await creerDevis(a);
    await request(app).get(`/api/devis/${d.id}/pdf`).set("Cookie", b.cookie).expect(404);
  });
});

// ── La pièce jointe ─────────────────────────────────────────────────────────

describe("l'e-mail d'envoi porte le devis", () => {
  test("exactement UNE pièce jointe", async () => {
    // Le canal accepte des pièces jointes depuis toujours ; personne ne lui en
    // passait. Le client recevait un lien et n'avait rien à garder.
    const canal = await import("../lib/canal-emission.js");
    const espion = vi.spyOn(canal, "sendDocument");

    const d = await creerDevis(a);
    await request(app).post(`/api/devis/${d.id}/envoyer`).set("Cookie", a.cookie)
      .send({ emailTo: "client@example.test" }).expect(200);

    expect(espion).toHaveBeenCalled();
    const options = espion.mock.calls.at(-1)![0];
    expect(options.attachments).toHaveLength(1);
    expect(options.attachments![0]!.filename).toMatch(/\.pdf$/);
    expect(options.attachments![0]!.contentType).toBe("application/pdf");
    expect(Buffer.from(options.attachments![0]!.content).subarray(0, 5).toString()).toBe("%PDF-");
    espion.mockRestore();
  });
});

// ── Le lien public ──────────────────────────────────────────────────────────

describe("le PDF servi par le JETON, sans session", () => {
  const jetonDe = (url: string): string => url.split("/").pop()!;

  async function devisEnvoye(l: Locataire): Promise<{ id: string; token: string; reference: string }> {
    const d = await creerDevis(l);
    const { body } = await request(app).post(`/api/devis/${d.id}/envoyer`).set("Cookie", l.cookie)
      .send({ emailTo: "client@example.test" }).expect(200);
    return { ...d, token: jetonDe(body.acceptUrl) };
  }

  test("un jeton valide sert le PDF", async () => {
    const d = await devisEnvoye(a);
    const r = await publicGet(`/api/public/devis/${d.token}/pdf`).expect(200);
    expect(r.headers["content-type"]).toContain("application/pdf");
    expect(r.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("la page d'acceptation annonce le chemin du PDF, jamais l'identifiant du devis", async () => {
    const d = await devisEnvoye(a);
    const { body } = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(200);
    expect(body.pdfUrl).toBe(`/api/public/devis/${d.token}/pdf`);
    expect(JSON.stringify(body)).not.toContain(d.id);
  });

  test("un jeton inconnu → 404", async () => {
    await publicGet(`/api/public/devis/${crypto.randomUUID()}/pdf`).expect(404);
  });

  test("le jeton d'un tenant ne sert que SON devis", async () => {
    const chezA = await devisEnvoye(a);
    const chezB = await devisEnvoye(b);
    const rA = await publicGet(`/api/public/devis/${chezA.token}/pdf`).expect(200);
    const rB = await publicGet(`/api/public/devis/${chezB.token}/pdf`).expect(200);
    // Le PDF de A nomme l'entreprise de A ; celui de B ne la nomme pas.
    expect(texteBrut(rA.body as Buffer)).toContain("Toiture Martin SARL");
    expect(texteBrut(rB.body as Buffer)).not.toContain("Toiture Martin SARL");
  });

  test("LE PDF RESTE SERVI APRÈS ACCEPTATION", async () => {
    // C'est précisément à ce moment-là que le client veut garder son document.
    const d = await devisEnvoye(a);
    await request(app).post(`/api/public/devis/${d.token}/accept`)
      .set("X-Forwarded-For", ipUnique())
      .send({ signataire: "Jean Client" }).expect(200);

    const r = await publicGet(`/api/public/devis/${d.token}/pdf`).expect(200);
    expect(r.body.subarray(0, 5).toString()).toBe("%PDF-");

    // Et la page « déjà accepté » propose toujours le lien.
    const { body } = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(200);
    expect(body.alreadyAccepted).toBe(true);
    expect(body.pdfUrl).toBeTruthy();
  });
});

// ── Mise en forme du document ───────────────────────────────────────────────

describe("les dates sont affichées à la française", () => {
  test("le PDF montre JJ/MM/AAAA, jamais AAAA-MM-JJ", async () => {
    // « 2026-08-10 » est le format d'ÉCHANGE, pas celui qu'on montre à un
    // client. Le XML Factur-X, lui, reste en ISO — il n'est pas touché.
    const { body: cree } = await request(app).post("/api/devis").set("Cookie", a.cookie)
      .send({
        clientName: "Madame Bernard",
        validUntil: "2027-12-31",
        lines: [{ description: "Cloison BA13", quantity: 1, unitPriceCents: 10_000, vatRate: 10 }],
      })
      .expect(201);

    const r = await request(app).get(`/api/devis/${cree.id}/pdf`).set("Cookie", a.cookie).expect(200);
    const texte = texteBrut(r.body as Buffer);

    expect(texte).toContain("31/12/2027");
    expect(texte).not.toContain("2027-12-31");
    // La date du document suit la même règle.
    expect(texte).toMatch(/Date : \d{2}\/\d{2}\/\d{4}/);
    expect(texte).not.toMatch(/Date : \d{4}-\d{2}-\d{2}/);
  });

  test("une valeur qui n'est pas une date métier ressort telle quelle", async () => {
    // Mieux vaut afficher une valeur inattendue que la déformer en silence.
    const { genererPdfDevis } = await import("../lib/pdf-devis.js");
    const devis = {
      id: "x", tenantId: "t", reference: "DEV-TEST", clientName: "C",
      status: "ENVOYE", lines: [], totalHTCents: 0, totalTTCCents: 0,
      tvaRate: 20, remise: 0, autoliquidation: false, retenueGarantiePct: 0,
      validUntil: "date inconnue", notes: null, clientAddress: null, chantierAddress: null,
      affaireId: null, clientId: null, acceptTokenSha256: null, acceptedAt: null,
      acceptedBy: null, acceptedIp: null, dateEnvoi: null,
      createdAt: new Date("2026-08-10T12:00:00Z"), updatedAt: new Date(),
    } as unknown as Parameters<typeof genererPdfDevis>[0];

    const pdf = await genererPdfDevis(devis, { nom: "Test", siret: "" });
    expect(texteBrut(pdf)).toContain("date inconnue");
  });
});
