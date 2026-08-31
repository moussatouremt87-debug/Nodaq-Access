/**
 * Le panneau de valeur — ce qu'il affiche doit être VRAI.
 *
 * Un artisan qui attrape une exagération cesse de croire tous les autres
 * chiffres de l'écran, y compris les exacts. Ces tests portent donc moins sur
 * « le calcul rend un nombre » que sur « le nombre ne ment pas dans les cas
 * où il serait tentant de mentir ».
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import app from "../app";
import {
  adminPool, cleanupTenants, cleanupUsers,
  completeMfaForRegisteredOwner, serveurTest,
} from "./helpers";
import { valeurProduite, debutDuMois } from "../lib/valeur-produite";

const tenantIds: string[] = [];
const emails: string[] = [];
let tenantId = "";
let cookie = "";

/**
 * Une date à N jours d'aujourd'hui, à midi.
 *
 * Midi et non minuit : le repère reste à douze heures de chaque changement de
 * jour, dans n'importe quel fuseau (leçon du 30/08).
 */
function dansNJours(n: number): string {
  const a = new Date();
  const d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + n, 12, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Une date du mois courant, à midi — loin des deux minuits (leçon du 30/08). */
function ceMoisCi(jour: number): string {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), jour, 12, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function facture(opts: {
  statut: string; montantCents: number; dueDate: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, statut,
                           amount_cents, total_ht_cents, issued_date, due_date)
     VALUES ($1, $2::uuid, $3, 'Client', $4, $5, $5, $6, $7)`,
    [id, tenantId, `F-${crypto.randomBytes(3).toString("hex")}`, opts.statut,
     opts.montantCents, ceMoisCi(1), opts.dueDate],
  );
  return id;
}

/** Un appel de relance réellement démarré sur cette facture, à cette date. */
async function relance(factureId: string, quand: string): Promise<void> {
  const campagne = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO campagnes_relance (id, tenant_id, pending_action_id, mandat)
     VALUES ($1, $2::uuid, 'pa-valeur-test', '{}'::jsonb)`,
    [campagne, tenantId],
  );
  await adminPool.query(
    `INSERT INTO appels_relance (id, tenant_id, campagne_id, facture_id,
                                 empreinte_numero, statut, started_at)
     VALUES ($1, $2::uuid, $3, $4, 'valeur-test', 'TERMINE', $5::date + time '10:00')`,
    [crypto.randomUUID(), tenantId, campagne, factureId, quand],
  );
}

async function encaissement(factureId: string, quand: string, cents: number): Promise<void> {
  await adminPool.query(
    `INSERT INTO paiements (id, tenant_id, facture_id, date, montant_cents, sens)
     VALUES ($1, $2::uuid, $3, $4, $5, 'ENCAISSEMENT')`,
    [crypto.randomUUID(), tenantId, factureId, quand, cents],
  );
}

beforeAll(async () => {
  const email = `valeur-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Valeur SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"][0];
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("on ne s'attribue que ce qu'on peut prouver", () => {
  test("une facture relancée PUIS encaissée est comptée", async () => {
    const f = await facture({ statut: "PAYEE", montantCents: 120_000, dueDate: ceMoisCi(5) });
    await relance(f, ceMoisCi(6));
    await encaissement(f, ceMoisCi(8), 120_000);

    const v = await valeurProduite(tenantId);
    expect(v.relanceesPuisEncaissees.nombre).toBe(1);
    expect(v.relanceesPuisEncaissees.montantCents).toBe(120_000);
  });

  test("une facture payée AVANT la relance n'est pas comptée", async () => {
    /*
     * LE test de ce fichier. Sans la borne « le paiement suit la relance »,
     * une facture réglée le lundi et relancée par erreur le mardi gonflerait
     * le chiffre — on s'attribuerait un encaissement antérieur à l'action.
     * C'est exactement le genre d'exagération qui fait perdre la confiance
     * dans tout le reste du panneau.
     */
    const avant = (await valeurProduite(tenantId)).relanceesPuisEncaissees;
    const f = await facture({ statut: "PAYEE", montantCents: 90_000, dueDate: ceMoisCi(5) });
    await encaissement(f, ceMoisCi(3), 90_000);
    await relance(f, ceMoisCi(9));

    const apres = (await valeurProduite(tenantId)).relanceesPuisEncaissees;
    expect(apres.nombre).toBe(avant.nombre);
    expect(apres.montantCents).toBe(avant.montantCents);
  });

  test("trois relances sur la même facture font UN dossier", async () => {
    // Compter les tentatives gonflerait le nombre sans rien dire de plus —
    // même règle que le compteur d'usage vocal (4.43 §1).
    const avant = (await valeurProduite(tenantId)).relanceesPuisEncaissees.nombre;
    const f = await facture({ statut: "PAYEE", montantCents: 50_000, dueDate: ceMoisCi(4) });
    await relance(f, ceMoisCi(5));
    await relance(f, ceMoisCi(6));
    await relance(f, ceMoisCi(7));
    await encaissement(f, ceMoisCi(10), 50_000);

    expect((await valeurProduite(tenantId)).relanceesPuisEncaissees.nombre).toBe(avant + 1);
  });

  test("une facture jamais relancée n'entre pas dans le compte", async () => {
    const avant = (await valeurProduite(tenantId)).relanceesPuisEncaissees.montantCents;
    const f = await facture({ statut: "PAYEE", montantCents: 77_000, dueDate: ceMoisCi(4) });
    await encaissement(f, ceMoisCi(11), 77_000);
    expect((await valeurProduite(tenantId)).relanceesPuisEncaissees.montantCents).toBe(avant);
  });
});

describe("les montants sont ceux du dépôt, pas une seconde définition", () => {
  test("un BROUILLON n'est ni à venir, ni en retard", async () => {
    // « Un brouillon n'est dû par personne » — c'est déjà la règle du
    // diagnostic d'impayés et de `STATUTS_JAMAIS_EN_RETARD`.
    const avant = await valeurProduite(tenantId);
    await facture({ statut: "BROUILLON", montantCents: 999_000, dueDate: ceMoisCi(2) });
    const apres = await valeurProduite(tenantId);
    expect(apres.encaissementsAVenirCents).toBe(avant.encaissementsAVenirCents);
    expect(apres.impayes.montantCents).toBe(avant.impayes.montantCents);
  });

  test("les montants sont en TTC — ce qui tombe sur le compte", async () => {
    const avant = (await valeurProduite(tenantId)).encaissementsAVenirCents;
    /*
     * `amount_cents` EST le TTC (posé à totalHT + totalTVA à la facturation).
     *
     * L'échéance est calculée À PARTIR D'AUJOURD'HUI, pas fixée au 28 du mois :
     * la première version de ce test tombait en panne les trois derniers jours
     * de chaque mois, où le 28 est déjà passé et la facture bascule en retard.
     * Une fixture dont le sens dépend du jour où elle tourne ment onze mois
     * sur douze puis accuse le code.
     */
    await facture({ statut: "EMISE", montantCents: 240_000, dueDate: dansNJours(15) });
    expect((await valeurProduite(tenantId)).encaissementsAVenirCents).toBe(avant + 240_000);
  });

  test("les sommes sont des NOMBRES, pas des chaînes de bigint", async () => {
    /*
     * `sum()` sur un `integer` rend un bigint, que le pilote donne en chaîne :
     * « 4850 » + 100 vaudrait « 4850100 » à l'écran. Le Cockpit porte déjà la
     * même précaution ; ce test empêche de la perdre ici.
     */
    const v = await valeurProduite(tenantId);
    for (const [nom, valeur] of [
      ["à venir", v.encaissementsAVenirCents],
      ["impayés", v.impayes.montantCents],
      ["relancées", v.relanceesPuisEncaissees.montantCents],
      ["abonnement", v.abonnementCents],
    ] as const) {
      expect(typeof valeur, `${nom} n'est pas un nombre`).toBe("number");
    }
  });
});

describe("le panneau est réservé à qui a le droit de voir l'argent", () => {
  test("le propriétaire y a accès", async () => {
    const r = await request(serveurTest(app))
      .get("/api/cockpit/valeur").set("Cookie", cookie).expect(200);
    expect(r.body.periode.debut).toBe(debutDuMois());
  });

  test("un salarié reçoit un REFUS, pas un panneau vide", async () => {
    /*
     * Rendre des zéros laisserait croire qu'il n'y a rien, alors qu'il y a
     * « vous n'y avez pas accès ». Même distinction que le `null` plutôt que
     * `0` sur les incidents de facturation.
     */
    const email = `valeur-salarie-${Date.now()}@test.nodaq`;
    emails.push(email);
    const { rows: u } = await adminPool.query(
      `INSERT INTO users (id, email, password_hash, nom)
       VALUES (gen_random_uuid(), $1, 'x', 'Salarié') RETURNING id`, [email]);
    await adminPool.query(
      `INSERT INTO memberships (id, user_id, tenant_id, role)
       VALUES (gen_random_uuid(), $1, $2::uuid, 'MEMBER')`, [u[0].id, tenantId]);
    const { rows: s } = await adminPool.query(
      `INSERT INTO sessions (id, user_id, tenant_id, expires_at, mfa_verified_at)
       VALUES (gen_random_uuid(), $1, $2::uuid, now() + interval '1 day', now())
       RETURNING id`, [u[0].id, tenantId]);

    const { cookieHeader } = await import("./helpers");
    const r = await request(serveurTest(app))
      .get("/api/cockpit/valeur").set("Cookie", cookieHeader(s[0].id));
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/réservé/i);
  });
});

describe("aucun chiffre n'est estimé", () => {
  test("le module ne prétend PAS mesurer un temps gagné", () => {
    /*
     * « 7 h 42 économisées » ne se dérive d'aucune table : il faudrait poser
     * « une relance = X minutes », c'est-à-dire l'inventer. Un chiffre
     * fabriqué posé à côté de montants réels les contamine tous.
     *
     * Cette garde existe parce que la tentation reviendra : c'est le chiffre
     * le plus flatteur du panneau, et le seul qui ne coûte rien à écrire.
     */
    const src = readFileSync(join(__dirname, "..", "lib", "valeur-produite.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const interdit of ["heuresGagnees", "tempsEconomise", "minutesParRelance", "MINUTES_"]) {
      expect(src, `« ${interdit} » : un temps gagné ne se dérive d'aucune donnée`)
        .not.toContain(interdit);
    }
  });

  test("un compte offert affiche 0, pas le tarif public", async () => {
    // La dérogation de remise est une DONNÉE par tenant : les places offertes
    // ne doivent pas se voir facturer à l'écran ce qu'elles ne paient pas.
    await adminPool.query(
      `UPDATE subscriptions SET derogation_remise_cents = 999999 WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    expect((await valeurProduite(tenantId)).abonnementCents).toBe(0);
    await adminPool.query(
      `UPDATE subscriptions SET derogation_remise_cents = NULL WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
  });
});
