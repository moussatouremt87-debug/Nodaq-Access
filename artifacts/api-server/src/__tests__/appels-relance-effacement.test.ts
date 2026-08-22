/**
 * Opposition et effacement des données vocales — ticket 4.18, US-7/US-8.
 *
 * Ce que ces tests protègent :
 *   a. US-7 — « ne me rappelez plus » est effectif IMMÉDIATEMENT et réutilise
 *      le registre d'oppositions existant, par empreinte salée ;
 *   b. US-8 — effacer un contact emporte ses appels, ses TRANSCRIPTIONS et
 *      ses promesses. C'est le « test d'effacement le prouve » de la story ;
 *   c. l'opposition SURVIT à l'effacement, et c'est délibéré : l'effacer
 *      rendrait la personne rappelable dès la campagne suivante — l'effacement
 *      se retournerait contre celui qui le demande ;
 *   d. le numéro n'est JAMAIS écrit en clair : seule son empreinte entre en
 *      base ;
 *   e. l'isolation tenant tient sur ces tables comme sur les autres.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { withTenant, appelsRelanceTable, campagnesRelanceTable } from "@workspace/db";
import { empreinte } from "../lib/prospection";
import {
  effacerDonneesVocales,
  estOpposeAuxAppels,
  numerosOpposes,
  poserOppositionAppel,
  resteDesTracesVocales,
  tentativesFaites,
} from "../lib/appels-relance";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];
let tenantId: string;
let autreTenantId: string;
let ownerCookie: string;

const NUMERO = "+33600000042";
const TRANSCRIPTION = "Le débiteur indique qu'il réglera le 15 septembre.";

async function creerCampagne(tid: string): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO campagnes_relance (id, tenant_id, pending_action_id, mandat, statut)
     VALUES ($1, $2, $3, '{}'::jsonb, 'VALIDEE')`,
    [id, tid, `pa-${id}`],
  );
  return id;
}

async function creerAppel(tid: string, campagneId: string, numero: string): Promise<string> {
  const emp = await empreinte(tid, "telephone", numero);
  const id = crypto.randomUUID();
  await withTenant(tid, (tx) =>
    tx.insert(appelsRelanceTable).values({
      id,
      tenantId: tid,
      campagneId,
      empreinteNumero: emp,
      tentative: 1,
      statut: "TERMINE",
      issue: "promise",
      transcription: TRANSCRIPTION,
      resume: "Promesse de règlement au 15 septembre.",
      promesseMontantCents: 120000,
      promesseDate: "2026-09-15",
    }),
  );
  return id;
}

beforeAll(async () => {
  const email = `appels-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Appels SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
  ownerCookie = reg.headers["set-cookie"][0];

  const email2 = `appels2-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email2);
  const reg2 = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email: email2, password: "test-pass-1234", nom: "Autre", tenantNom: "Autre SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg2.body.userId);
  autreTenantId = reg2.body.tenantId;
  tenantIds.push(autreTenantId);
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. US-7 : l'opposition ─────────────────────────────────────────────────

describe("a — US-7 : « ne me rappelez plus », effectif immédiatement", () => {
  test("un numéro non opposé ne l'est pas", async () => {
    expect(await estOpposeAuxAppels(tenantId, "+33611111111")).toBe(false);
  });

  test("poser l'opposition la rend effective aussitôt", async () => {
    await poserOppositionAppel(tenantId, NUMERO);
    expect(await estOpposeAuxAppels(tenantId, NUMERO)).toBe(true);
  });

  test("elle tient malgré une écriture différente du numéro", async () => {
    // La normalisation existe pour ça : « 06 00 00 00 42 » et « +33600000042 »
    // désignent la même personne. Sans elle, l'opposition tomberait au premier
    // réimport de fichier.
    expect(await estOpposeAuxAppels(tenantId, "+33 600 000 042")).toBe(true);
  });

  test("elle ne franchit pas la frontière du tenant", async () => {
    // Le sel est par tenant : une opposition posée chez l'un ne dit rien chez
    // l'autre, et l'empreinte n'est même pas comparable.
    expect(await estOpposeAuxAppels(autreTenantId, NUMERO)).toBe(false);
  });

  test("le tri en masse d'une campagne rend les mêmes verdicts", async () => {
    const opposes = await numerosOpposes(tenantId, [NUMERO, "+33611111111", "+33622222222"]);
    expect(opposes.has(NUMERO)).toBe(true);
    expect(opposes.size).toBe(1);
  });

  test("une liste vide ne fait aucune requête et rend un ensemble vide", async () => {
    expect((await numerosOpposes(tenantId, [])).size).toBe(0);
  });
});

// ── b. US-8 : l'effacement emporte les transcriptions ──────────────────────

describe("b — US-8 : effacer emporte appels, transcriptions et promesses", () => {
  test("la transcription existe avant, plus après", async () => {
    const campagneId = await creerCampagne(tenantId);
    const numero = "+33655555555";
    await creerAppel(tenantId, campagneId, numero);

    // Avant : la transcription est bien là — sinon le test d'effacement
    // prouverait la disparition de quelque chose qui n'a jamais existé.
    const avant = await adminPool.query(
      `SELECT transcription, promesse_montant_cents FROM appels_relance
       WHERE tenant_id = $1 AND transcription IS NOT NULL`,
      [tenantId],
    );
    expect(avant.rows.length).toBeGreaterThan(0);
    expect(avant.rows[0].transcription).toBe(TRANSCRIPTION);

    const bilan = await effacerDonneesVocales(tenantId, numero);
    expect(bilan.appelsEffaces).toBeGreaterThan(0);

    // Après : plus rien, ni ligne, ni transcription, ni promesse.
    expect(await resteDesTracesVocales(tenantId, numero)).toBe(false);
    const emp = await empreinte(tenantId, "telephone", numero);
    const apres = await adminPool.query(
      `SELECT count(*)::int AS n FROM appels_relance
       WHERE tenant_id = $1 AND empreinte_numero = $2`,
      [tenantId, emp],
    );
    expect(apres.rows[0].n).toBe(0);
  });

  test("effacer une personne n'efface pas les autres", async () => {
    const campagneId = await creerCampagne(tenantId);
    await creerAppel(tenantId, campagneId, "+33677777777");
    await creerAppel(tenantId, campagneId, "+33688888888");

    await effacerDonneesVocales(tenantId, "+33677777777");

    expect(await resteDesTracesVocales(tenantId, "+33677777777")).toBe(false);
    expect(await resteDesTracesVocales(tenantId, "+33688888888")).toBe(true);
  });

  test("effacer un numéro sans trace ne casse rien", async () => {
    const bilan = await effacerDonneesVocales(tenantId, "+33699999999");
    expect(bilan.appelsEffaces).toBe(0);
  });
});

// ── c. L'opposition survit à l'effacement ──────────────────────────────────

describe("c — l'opposition SURVIT à l'effacement, et c'est voulu", () => {
  test("après effacement, la personne reste non rappelable", async () => {
    const numero = "+33644444444";
    const campagneId = await creerCampagne(tenantId);
    await creerAppel(tenantId, campagneId, numero);
    await poserOppositionAppel(tenantId, numero);

    const bilan = await effacerDonneesVocales(tenantId, numero);

    expect(bilan.appelsEffaces).toBeGreaterThan(0);
    expect(bilan.oppositionConservee).toBe(true);
    // LE POINT : effacer l'opposition en même temps rendrait la personne
    // rappelable dès la campagne suivante — l'effacement se retournerait
    // contre celui qui le demande. L'empreinte salée ne porte d'ailleurs
    // aucune donnée en clair.
    expect(await estOpposeAuxAppels(tenantId, numero)).toBe(true);
  });
});

// ── d. Le numéro n'est jamais écrit en clair ───────────────────────────────

describe("d — seule l'empreinte entre en base", () => {
  test("aucune colonne ne contient le numéro en clair", async () => {
    const numero = "+33633333333";
    const campagneId = await creerCampagne(tenantId);
    await creerAppel(tenantId, campagneId, numero);

    // Balayage de la ligne entière : une colonne ajoutée demain qui
    // stockerait le numéro ferait échouer ce test, ce qui est le but.
    const { rows } = await adminPool.query(
      `SELECT to_jsonb(a) AS ligne FROM appels_relance a
       WHERE a.tenant_id = $1 AND a.empreinte_numero = $2`,
      [tenantId, await empreinte(tenantId, "telephone", numero)],
    );
    expect(rows.length).toBe(1);
    const brut = JSON.stringify(rows[0].ligne);
    expect(brut).not.toContain(numero);
    expect(brut).not.toContain("33633333333");
  });

  test("la table n'a AUCUNE colonne d'audio", async () => {
    // Le §6 tranche « transcription seule ». Une colonne absente tient mieux
    // qu'une consigne : ce test échoue le jour où quelqu'un en ajoute une.
    const { rows } = await adminPool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'appels_relance'`,
    );
    const colonnes = rows.map((r) => r.column_name as string).join(",");
    expect(colonnes).not.toMatch(/audio|enregistrement|recording|wav|mp3|opus/i);
  });
});

// ── e. Comptage des tentatives et isolation ────────────────────────────────

describe("e — tentatives comptées, et isolation tenant", () => {
  test("les tentatives se comptent par campagne et par numéro", async () => {
    const numero = "+33666666666";
    const campagneA = await creerCampagne(tenantId);
    const campagneB = await creerCampagne(tenantId);

    await creerAppel(tenantId, campagneA, numero);
    await creerAppel(tenantId, campagneA, numero);
    await creerAppel(tenantId, campagneB, numero);

    expect(await tentativesFaites(tenantId, campagneA, numero)).toBe(2);
    // Une campagne ne consomme pas le quota d'une autre : l'US-2 borne les
    // rappels d'UNE campagne, pas la vie entière du débiteur.
    expect(await tentativesFaites(tenantId, campagneB, numero)).toBe(1);
  });

  test("un tenant ne voit pas les appels d'un autre", async () => {
    const numero = "+33612341234";
    const campagne = await creerCampagne(tenantId);
    await creerAppel(tenantId, campagne, numero);

    expect(await resteDesTracesVocales(tenantId, numero)).toBe(true);
    expect(await resteDesTracesVocales(autreTenantId, numero)).toBe(false);
  });

  test("l'effacement d'un tenant ne touche pas l'autre", async () => {
    const numero = "+33612121212";
    const cA = await creerCampagne(tenantId);
    const cB = await creerCampagne(autreTenantId);
    await creerAppel(tenantId, cA, numero);
    await creerAppel(autreTenantId, cB, numero);

    await effacerDonneesVocales(tenantId, numero);

    expect(await resteDesTracesVocales(tenantId, numero)).toBe(false);
    expect(await resteDesTracesVocales(autreTenantId, numero)).toBe(true);
  });
});

// ── f. La campagne reste, l'appel part ─────────────────────────────────────

describe("f — l'effacement ne détruit pas la campagne", () => {
  test("effacer les appels laisse la campagne en place", async () => {
    const numero = "+33698989898";
    const campagneId = await creerCampagne(tenantId);
    await creerAppel(tenantId, campagneId, numero);

    await effacerDonneesVocales(tenantId, numero);

    // La campagne est une décision de gestion, pas une donnée personnelle :
    // elle survit, sans les appels nominatifs qu'elle a produits.
    const restantes = await withTenant(tenantId, (tx) =>
      tx.select({ id: campagnesRelanceTable.id }).from(campagnesRelanceTable),
    );
    expect(restantes.some((c) => c.id === campagneId)).toBe(true);
  });
});
