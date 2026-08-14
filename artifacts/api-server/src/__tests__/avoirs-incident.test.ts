/**
 * Une facture peut rester ANNULEE_PAR_AVOIR par un avoir qui n'existe pas.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNE LIGNE DE JOURNAL DANS UN CONTENEUR QUE PERSONNE NE LIT NE PROTÈGE   ║
 * ║  DE RIEN.                                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * `POST /avoirs` réclame la facture (TX1) AVANT que l'avoir existe. Si TX2 (ou
 * la génération du PDF) échoue, une compensation restaure la facture — mais
 * si CETTE compensation échoue à son tour, rien ne la restaure : elle reste
 * ANNULEE_PAR_AVOIR sans avoir correspondant. Le CA (lib/chiffreAffaires.ts)
 * compte la facture à sa valeur pleine et ne retranche jamais l'avoir manquant
 * : le chiffre gonfle du montant exact de la facture annulée.
 *
 * migration 026 + lib/incidents-facturation.ts posent une trace DURABLE pour
 * ce cas. Ce fichier éprouve cette trace, et une garde structurelle
 * indépendante (une facture ne doit jamais référencer un avoir inexistant).
 *
 * ── COMMENT ON FORCE L'ÉCHEC ────────────────────────────────────────────────
 * `withTenant` (@workspace/db) est appelé QUATRE FOIS, dans cet ordre, par une
 * création d'avoir qui va jusqu'au bout : lecture des paramètres vendeur
 * (loadSellerInfo), TX1 (réclame la facture), TX2 (insère l'avoir), et — si
 * TX2 échoue — la compensation. `armer([...])` réinitialise le compteur juste
 * avant la requête sous test : il ne compte donc PAS les appels faits par
 * `beforeAll` (inscription, mentions légales) ni par la création de la
 * facture elle-même.
 *
 * Si l'ordre des appels dans avoirs.ts change, ce test le dira — c'est le
 * comportement voulu, pas une fragilité à masquer.
 *
 * ── POURQUOI UN FICHIER À PART ──────────────────────────────────────────────
 * `vi.mock` s'applique au module entier pour tout le fichier — même raison
 * que numero-brule.test.ts : un mock qui vaut pour toute la suite ferait
 * échouer des tests qui, eux, ont besoin d'un `withTenant` intact.
 */
import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";

const controle = vi.hoisted(() => ({ compteur: 0, appelsEnEchec: new Set<number>() }));

vi.mock("@workspace/db", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@workspace/db")>();
  const withTenantEspion: typeof reel.withTenant = (tenantId, fn) => {
    controle.compteur += 1;
    if (controle.appelsEnEchec.has(controle.compteur)) {
      return Promise.reject(new Error(`échec simulé au ${controle.compteur}e appel de withTenant`));
    }
    return reel.withTenant(tenantId, fn);
  };
  return { ...reel, withTenant: withTenantEspion };
});

/** Arme le prochain appel HTTP : ces N-ièmes appels de `withTenant` échoueront. */
function armer(appels: number[]): void {
  controle.compteur = 0;
  controle.appelsEnEchec = new Set(appels);
}
function desarmer(): void {
  controle.appelsEnEchec = new Set();
}

const { default: app } = await import("../app");
const {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  createTestUser,
  createTestMembership,
  createTestSession,
  cookieHeader,
  completeMfaForRegisteredOwner,
} = await import("./helpers");

const emails: string[] = [];
const tenants: string[] = [];
let cookieOwner = "";
let tenantId = "";

beforeAll(async () => {
  const email = `incident-${Date.now()}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Owner", tenantNom: "Corp Sinistrée" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookieOwner = reg.headers["set-cookie"]?.[0] ?? "";
  const me = await request(app).get("/api/auth/me").set("Cookie", cookieOwner).expect(200);
  tenantId = me.body.tenantId;
  tenants.push(tenantId);

  // Mentions légales : sans elles l'émission serait refusée AVANT l'attribution
  // du numéro d'avoir, et aucun de ces tests ne traverserait le chemin visé.
  await request(app)
    .patch("/api/parametres")
    .set("Cookie", cookieOwner)
    .send({ "company.siret": "81234567600009", "company.nom": "Corp Sinistrée" })
    .expect(200);
});

afterAll(async () => {
  await cleanupTenants(...tenants);
  await cleanupUsers(...emails);
});

afterEach(() => {
  desarmer();
});

/** Crée une facture EMISE d'un montant connu et rend id/numéro/montant TTC. */
async function creerFactureEmise(): Promise<{ id: string; number: string; amountCents: number }> {
  const brouillon = await request(app)
    .post("/api/factures")
    .set("Cookie", cookieOwner)
    .send({
      customerName: "Client Sinistre SAS",
      issuedDate: "2026-08-01",
      dueDate: "2026-09-01",
      lines: [
        { description: "Travaux", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" },
      ],
      attestationTvaFournie: true,
    })
    .expect(201);

  const emise = await request(app)
    .post(`/api/factures/${brouillon.body.id}/emettre`)
    .set("Cookie", cookieOwner)
    .send({ issuedDate: "2026-08-01", dueDate: "2026-09-01" })
    .expect(200);

  return { id: brouillon.body.id, number: emise.body.number, amountCents: emise.body.amountCents };
}

describe("le sinistre : TX2 échoue, la compensation échoue à son tour", () => {
  test("une trace durable est posée, avec de quoi restaurer l'état", async () => {
    const facture = await creerFactureEmise();

    armer([3, 4]); // 3 = TX2 (insertion de l'avoir), 4 = compensation
    const motif = "Sinistre — annulation totale, TX2 puis compensation échouent";
    const res = await request(app)
      .post("/api/avoirs")
      .set("Cookie", cookieOwner)
      .send({
        factureRefId: facture.id,
        montantHtCents: facture.amountCents,
        montantTvaCents: 0,
        motif,
      });

    // La création de l'avoir ÉCHOUE — c'est le point de départ du sinistre.
    expect(res.status).toBe(500);

    const { rows } = await adminPool.query(
      `SELECT facture_id, charge_utile FROM incidents_facturation WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].facture_id).toBe(facture.id);

    const chargeUtile = rows[0].charge_utile as Record<string, unknown>;
    expect(chargeUtile).toMatchObject({
      factureId: facture.id,
      factureNumero: facture.number,
      residuelARestaurerCents: facture.amountCents,
      statutPrecedent: "EMISE",
      motif,
    });
    expect(chargeUtile.numeroAvoirBrule).toMatch(/^AVOIR-\d{4}-\d{4}$/);

    // Et la facture, elle, reste dans l'état incohérent que rien n'a réparé —
    // exactement le sinistre que la trace documente.
    const apres = await request(app)
      .get(`/api/factures/${facture.id}`)
      .set("Cookie", cookieOwner)
      .expect(200);
    expect(apres.body.statut).toBe("ANNULEE_PAR_AVOIR");
  });
});

describe("la compensation réussit : aucun incident n'est créé", () => {
  test("un incident qui se déclenche sur le chemin nominal serait pire qu'aucun incident", async () => {
    const facture = await creerFactureEmise();

    armer([3]); // seul TX2 échoue — la compensation (4) n'est pas armée
    const res = await request(app)
      .post("/api/avoirs")
      .set("Cookie", cookieOwner)
      .send({
        factureRefId: facture.id,
        montantHtCents: facture.amountCents,
        montantTvaCents: 0,
        motif: "TX2 échoue seul — compensation nominale",
      });
    expect(res.status).toBe(500);

    const { rows } = await adminPool.query(
      `SELECT id FROM incidents_facturation WHERE facture_id = $1`,
      [facture.id],
    );
    expect(rows).toHaveLength(0);

    // Et la facture est revenue exactement comme avant : EMISE, résiduel intact.
    const apres = await request(app)
      .get(`/api/factures/${facture.id}`)
      .set("Cookie", cookieOwner)
      .expect(200);
    expect(apres.body.statut).toBe("EMISE");
    expect(apres.body.residualCents).toBe(facture.amountCents);
  });
});

describe("cohérence — aucune facture ne référence un avoir inexistant", () => {
  test("une facture fabriquée à la main avec un avoir_id dans le vide fait échouer la garde", async () => {
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      const { rows: t } = await client.query(
        "INSERT INTO tenants (id, nom) VALUES (gen_random_uuid(), 'Épreuve cohérence') RETURNING id",
      );
      const tenant = t[0].id as string;

      const factureId = "facture-coherence-test";
      const avoirFantome = crypto.randomUUID(); // n'existe dans AUCUNE ligne d'avoirs
      await client.query(
        `INSERT INTO factures (id, tenant_id, customer_name, number, issued_date, due_date, amount_cents, statut, avoir_id)
         VALUES ($1, $2::uuid, 'Client', 'FACT-COHER-0001', '2026-08-01', '2026-09-01', 1000, 'ANNULEE_PAR_AVOIR', $3)`,
        [factureId, tenant, avoirFantome],
      );

      // La garde : aucune facture ne doit référencer un avoir qui n'existe pas.
      const orphelines = await client.query(
        `SELECT f.id FROM factures f
          WHERE f.tenant_id = $1::uuid
            AND f.avoir_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM avoirs a WHERE a.id = f.avoir_id)`,
        [tenant],
      );

      // La fabrication est bien détectée — c'est ce que ce test prouve.
      expect(orphelines.rows.map(r => r.id)).toEqual([factureId]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("visibilité — la ligne du cockpit n'appartient qu'au OWNER", () => {
  test("un MEMBER ne voit pas le compteur, même dans le corps de la réponse", async () => {
    const emailMembre = `incident-member-${Date.now()}@test.nodaq`;
    emails.push(emailMembre);
    const membre = await createTestUser(emailMembre);
    await createTestMembership(membre.id, tenantId, "MEMBER");
    const session = await createTestSession(membre.id, tenantId);
    const cookieMembre = cookieHeader(session.id);

    // Un incident réel pour ce tenant, posé directement — peu importe lequel,
    // seule sa PRÉSENCE compte pour ce test.
    const facture = await creerFactureEmise();
    await adminPool.query(
      `INSERT INTO incidents_facturation (id, tenant_id, type, facture_id, charge_utile)
       VALUES (gen_random_uuid()::text, $1::uuid, 'AVOIR_COMPENSATION_ECHOUEE', $2, '{}'::jsonb)`,
      [tenantId, facture.id],
    );

    const owner = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookieOwner)
      .expect(200);
    expect(typeof owner.body.incidentsFacturationCount).toBe("number");
    expect(owner.body.incidentsFacturationCount).toBeGreaterThanOrEqual(1);

    const membreRes = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookieMembre)
      .expect(200);
    expect(membreRes.body.incidentsFacturationCount).toBeNull();
  });
});

describe("rien de sensible dans les journaux", () => {
  test("une sentinelle placée dans le motif n'apparaît pas dans la sortie d'erreur", async () => {
    const facture = await creerFactureEmise();
    const sentinelle = `SENTINELLE-${crypto.randomUUID()}`;

    const capture: string[] = [];
    const happer = (...args: unknown[]) => {
      capture.push(args.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    };
    const espions = [
      vi.spyOn(console, "log").mockImplementation(happer),
      vi.spyOn(console, "error").mockImplementation(happer),
      vi.spyOn(console, "warn").mockImplementation(happer),
      vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => {
        capture.push(String(s));
        return true;
      }) as typeof process.stdout.write),
      vi.spyOn(process.stderr, "write").mockImplementation(((s: string) => {
        capture.push(String(s));
        return true;
      }) as typeof process.stderr.write),
    ];

    try {
      armer([3, 4]);
      await request(app)
        .post("/api/avoirs")
        .set("Cookie", cookieOwner)
        .send({
          factureRefId: facture.id,
          montantHtCents: facture.amountCents,
          montantTvaCents: 0,
          motif: sentinelle,
        });
    } finally {
      for (const e of espions) e.mockRestore();
    }

    // Le motif VIT dans la ligne d'incident (protégée par RLS) — ce n'est PAS
    // un journal. Il ne doit en revanche jamais apparaître dans la sortie
    // d'erreur du serveur.
    const journaux = capture.join("\n");
    expect(journaux).not.toContain(sentinelle);

    // Et la ligne d'incident, elle, porte bien le motif — sinon ce test
    // prouverait juste qu'on n'écrit plus rien nulle part.
    const { rows } = await adminPool.query(
      `SELECT charge_utile FROM incidents_facturation WHERE facture_id = $1`,
      [facture.id],
    );
    expect((rows[0].charge_utile as Record<string, unknown>).motif).toBe(sentinelle);
  });
});
