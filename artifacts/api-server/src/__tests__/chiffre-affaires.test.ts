/**
 * La définition du chiffre d'affaires — correctif CA.
 *
 * Ce que ces tests protègent, un par ligne :
 *   a. un BROUILLON portant une date d'émission n'entre PAS dans le CA ;
 *   b. une facture EMISE non encaissée y entre ;
 *   c. une facture totalement annulée par avoir : CA inchangé — ni comptée en
 *      trop, ni déduite deux fois. Valeur exacte, pas seulement le signe ;
 *   d. un avoir partiel diminue le CA du montant de l'avoir ;
 *   e. un avoir de l'exercice précédent ne touche pas le CA de l'exercice ;
 *   f. fuseau : un avoir émis le 31 décembre à 23 h à Paris compte sur
 *      l'exercice qui se termine.
 *
 * Le cas (c) est celui qui compte. Le réflexe « exclure les annulées ET
 * retrancher les avoirs » déduit deux fois et donne un CA NÉGATIF ici ;
 * l'ancien comportement, lui, donnait le montant plein. Les deux échouent sur
 * `toBe(0)`, ce qui est exactement ce qu'on veut d'une assertion.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { toDateString } from "@nodaq/shared";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

let cookie: string;
let tenantId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

const anneeCourante = new Date().getFullYear();
const aujourdhui = toDateString(new Date());
/** Une date sûrement dans l'exercice courant, quel que soit le jour du test. */
const debutExerciceCourant = `${anneeCourante}-01-01`;
const finExercicePrecedent = `${anneeCourante - 1}-12-31`;

type Statut = "BROUILLON" | "EMISE" | "PAYEE" | "ANNULEE_PAR_AVOIR";

async function facture(opts: {
  issuedDate: string;
  amountCents: number;
  statut?: Statut;
  settled?: boolean;
}): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents,
                           due_date, issued_date, statut, settled)
     VALUES ($1, $2::uuid, $3, 'Client Test', $4, $5, $5, $6, $7)`,
    [
      id,
      tenantId,
      `F-${Math.random().toString(36).slice(2, 10)}`,
      opts.amountCents,
      opts.issuedDate,
      opts.statut ?? "EMISE",
      opts.settled ?? false,
    ],
  );
  return id;
}

async function avoir(opts: {
  factureRefId: string;
  issuedDate: string;
  montantHtCents: number;
  montantTvaCents?: number;
}): Promise<void> {
  await adminPool.query(
    `INSERT INTO avoirs (id, tenant_id, numero, facture_ref_id, issued_date,
                         montant_ht_cents, montant_tva_cents, motif)
     VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, $4, $5, $6, 'test')`,
    [
      tenantId,
      `AV-${Math.random().toString(36).slice(2, 10)}`,
      opts.factureRefId,
      opts.issuedDate,
      opts.montantHtCents,
      opts.montantTvaCents ?? 0,
    ],
  );
}

/** Le CA de l'exercice, tel que le cockpit le sert au patron. */
async function caExercice(): Promise<number> {
  const { body } = await request(app)
    .get("/api/cockpit/kpis")
    .set("Cookie", cookie)
    .expect(200);
  return body.ytd.caYtdCents as number;
}

beforeAll(async () => {
  const email = `ca-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron CA", tenantNom: "Tenant CA" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);
}, 90_000);

beforeEach(async () => {
  await adminPool.query(`DELETE FROM avoirs WHERE tenant_id = $1::uuid`, [tenantId]);
  await adminPool.query(`DELETE FROM factures WHERE tenant_id = $1::uuid`, [tenantId]);
});

afterAll(async () => {
  for (const t of ["avoirs", "factures", "settings", "affaires", "objectifs_franchissements"]) {
    await adminPool.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  }
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a. Le brouillon ──────────────────────────────────────────────────────────

describe("a — un brouillon n'est pas du chiffre d'affaires", () => {
  test("une facture BROUILLON datée dans l'exercice n'entre pas dans le CA", async () => {
    // `factures.ts` renseigne `issued_date` dès la CRÉATION (ligne ~225), alors
    // que `statut` vaut BROUILLON. Sans liste blanche, un devis facturé jamais
    // émis gonflait la jauge sur laquelle le patron décide d'embaucher.
    await facture({ issuedDate: aujourdhui, amountCents: 1_000_000, statut: "BROUILLON" });
    expect(await caExercice()).toBe(0);
  });

  test("un statut inconnu n'entre pas non plus — liste blanche, pas exclusion", async () => {
    // Une exclusion de BROUILLON laisserait passer tout statut ajouté plus
    // tard, silencieusement. Ici il faut l'ajouter à la main.
    await facture({
      issuedDate: aujourdhui,
      amountCents: 500_000,
      statut: "STATUT_FUTUR" as Statut,
    });
    expect(await caExercice()).toBe(0);
  });
});

// ── b. L'émise non encaissée ─────────────────────────────────────────────────

describe("b — le CA est ce qui est facturé, pas ce qui est encaissé", () => {
  test("une facture EMISE non encaissée entre dans le CA", async () => {
    await facture({ issuedDate: aujourdhui, amountCents: 1_000_000, settled: false });
    expect(await caExercice()).toBe(1_000_000);
  });

  test("PAYEE y entre aussi, pour le même montant", async () => {
    await facture({ issuedDate: aujourdhui, amountCents: 300_000, statut: "PAYEE", settled: true });
    expect(await caExercice()).toBe(300_000);
  });
});

// ── c. L'annulation totale — le piège du double comptage ─────────────────────

describe("c — facture totalement annulée par avoir", () => {
  test("CA inchangé : ni comptée en trop, ni déduite deux fois", async () => {
    // 10 000 € émis, puis annulés en totalité. `avoirs.ts` bascule la facture
    // en ANNULEE_PAR_AVOIR (ligne 176) mais laisse `amount_cents` INCHANGÉ.
    //
    //   comportement d'avant (aucun filtre, aucun avoir déduit) → 1 000 000
    //   réflexe erroné (exclure ET soustraire)                  → −1 000 000
    //   règle correcte (inclure ET soustraire)                  →         0
    const f = await facture({
      issuedDate: aujourdhui,
      amountCents: 1_000_000,
      statut: "ANNULEE_PAR_AVOIR",
    });
    await avoir({
      factureRefId: f,
      issuedDate: aujourdhui,
      montantHtCents: 800_000,
      montantTvaCents: 200_000,
    });
    expect(await caExercice()).toBe(0);
  });

  test("une autre facture émise à côté n'est pas emportée", async () => {
    const f = await facture({
      issuedDate: aujourdhui,
      amountCents: 1_000_000,
      statut: "ANNULEE_PAR_AVOIR",
    });
    await avoir({ factureRefId: f, issuedDate: aujourdhui, montantHtCents: 1_000_000 });
    await facture({ issuedDate: aujourdhui, amountCents: 250_000 });
    expect(await caExercice()).toBe(250_000);
  });
});

// ── d. L'avoir partiel ───────────────────────────────────────────────────────

describe("d — avoir partiel", () => {
  test("2 000 € d'avoir sur 10 000 € de facture → CA = 8 000 €", async () => {
    // La facture reste EMISE, `amount_cents` n'est pas retouché : c'est
    // l'avoir, et lui seul, qui porte la correction.
    const f = await facture({ issuedDate: aujourdhui, amountCents: 1_000_000 });
    await avoir({
      factureRefId: f,
      issuedDate: aujourdhui,
      montantHtCents: 160_000,
      montantTvaCents: 40_000,
    });
    expect(await caExercice()).toBe(800_000);
  });

  test("la TVA de l'avoir est déduite, pas seulement le HT", async () => {
    const f = await facture({ issuedDate: aujourdhui, amountCents: 1_000_000 });
    await avoir({
      factureRefId: f,
      issuedDate: aujourdhui,
      montantHtCents: 100_000,
      montantTvaCents: 20_000,
    });
    // 1 000 000 − (100 000 + 20 000). Oublier la TVA donnerait 900 000.
    expect(await caExercice()).toBe(880_000);
  });
});

// ── e. La borne d'exercice ───────────────────────────────────────────────────

describe("e — un avoir de l'exercice précédent ne touche pas l'exercice courant", () => {
  test("l'avoir est daté du 31 décembre dernier, la facture d'aujourd'hui", async () => {
    const f = await facture({ issuedDate: aujourdhui, amountCents: 1_000_000 });
    await avoir({ factureRefId: f, issuedDate: finExercicePrecedent, montantHtCents: 400_000 });
    expect(await caExercice()).toBe(1_000_000);
  });

  test("le même avoir daté du 1er janvier, LUI, diminue bien le CA", async () => {
    // Contrôle de la borne : sans lui, le test précédent passerait au vert
    // même si les avoirs n'étaient jamais déduits nulle part.
    const f = await facture({ issuedDate: aujourdhui, amountCents: 1_000_000 });
    await avoir({ factureRefId: f, issuedDate: debutExerciceCourant, montantHtCents: 400_000 });
    expect(await caExercice()).toBe(600_000);
  });
});

// ── f. Le fuseau ─────────────────────────────────────────────────────────────

describe("f — 31 décembre 23 h à Paris compte sur l'exercice qui se termine", () => {
  test("la date métier persistée suit les composantes LOCALES", () => {
    // C'est la valeur que `avoirs.ts` calcule ligne 113 et persiste désormais.
    // Un `toISOString().slice(0, 10)` rendrait « 2025-12-31 » ici mais
    // « 2026-01-01 » pour un serveur à l'ouest de Greenwich.
    const veilleDeNouvelAn = new Date(anneeCourante - 1, 11, 31, 23, 0, 0);
    expect(toDateString(veilleDeNouvelAn)).toBe(finExercicePrecedent);
  });

  test("le rétro-remplissage de la migration 012 convertit en Europe/Paris", async () => {
    // 22 h UTC = 23 h à Paris le 31 décembre. Un `created_at::date` brut
    // dépendrait du fuseau du SERVEUR PostgreSQL ; `AT TIME ZONE 'Europe/Paris'`
    // n'en dépend pas, et c'est ce que fait la migration.
    const instant = `${anneeCourante - 1}-12-31T22:00:00Z`;
    const { rows } = await adminPool.query<{ jour: string }>(
      `SELECT to_char(($1::timestamptz AT TIME ZONE 'Europe/Paris')::date, 'YYYY-MM-DD') AS jour`,
      [instant],
    );
    expect(rows[0]!.jour).toBe(finExercicePrecedent);
  });

  test("bout en bout : cet avoir ne diminue pas le CA de l'exercice suivant", async () => {
    const f = await facture({ issuedDate: aujourdhui, amountCents: 1_000_000 });
    await avoir({
      factureRefId: f,
      issuedDate: toDateString(new Date(anneeCourante - 1, 11, 31, 23, 0, 0)),
      montantHtCents: 300_000,
    });
    expect(await caExercice()).toBe(1_000_000);
  });
});

// ── Le bloc objectifs suit la même définition ────────────────────────────────

describe("les objectifs du cockpit lisent le MÊME chiffre d'affaires", () => {
  test("l'écart restant bouge quand un avoir est émis", async () => {
    // Un exercice précédent complet, pour que l'objectif « dépasser l'exercice
    // précédent » soit servi : il exige douze mois d'historique.
    await facture({ issuedDate: `${anneeCourante - 1}-01-15`, amountCents: 2_000_000 });
    const f = await facture({ issuedDate: aujourdhui, amountCents: 1_000_000 });

    const lire = async (): Promise<{ ecartCents: number; caExerciceCents: number }> => {
      const { body } = await request(app)
        .get("/api/cockpit/objectifs")
        .set("Cookie", cookie)
        .expect(200);
      const o = body.objectifs.find(
        (x: { id: string }) => x.id === "exercice_precedent",
      );
      expect(o, "l'objectif « exercice précédent » doit être servi").toBeDefined();
      return o;
    };

    const avant = await lire();
    expect(avant.caExerciceCents).toBe(1_000_000);
    expect(avant.ecartCents).toBe(1_000_000);

    await avoir({ factureRefId: f, issuedDate: aujourdhui, montantHtCents: 250_000 });

    const apres = await lire();
    // Le CA de l'exercice recule de l'avoir, donc l'écart restant s'agrandit
    // d'autant. Un bloc objectifs resté sur l'ancienne définition ne bougerait
    // pas d'un centime.
    expect(apres.caExerciceCents).toBe(750_000);
    expect(apres.ecartCents).toBe(1_250_000);
  });

  test("un brouillon ne rapproche pas le patron de son objectif", async () => {
    await facture({ issuedDate: `${anneeCourante - 1}-01-15`, amountCents: 2_000_000 });
    await facture({ issuedDate: aujourdhui, amountCents: 900_000, statut: "BROUILLON" });

    const { body } = await request(app)
      .get("/api/cockpit/objectifs")
      .set("Cookie", cookie)
      .expect(200);
    const o = body.objectifs.find((x: { id: string }) => x.id === "exercice_precedent");
    expect(o).toBeDefined();
    expect(o.caExerciceCents).toBe(0);
    expect(o.ecartCents).toBe(2_000_000);
  });
});
