/*
 * Facturer les échéances d'un contrat récurrent, de bout en bout — US-A2.3.
 *
 * ── Le critère qui porte tout le risque ───────────────────────────────────
 * Ce n'est pas « une facture est créée » — c'est « une SEULE facture est créée
 * par échéance ». Un abonnement mensuel facturé deux fois, c'est un client qui
 * paie deux fois et un artisan qui l'apprend par un appel furieux. Le doublon
 * est donc éprouvé sur le VRAI index unique, en rejouant la route.
 */
import { describe, test, expect, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `recur-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Recur ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

/**
 * La date de début d'un contrat, calculée SUR LA MÊME HORLOGE que la route.
 *
 * Surtout pas `CURRENT_DATE - interval` côté base : la base est en UTC et la
 * suite tourne aussi sous Pacific/Auckland (UTC+12). Les deux horloges
 * désignent alors deux jours différents pendant douze heures par jour, et un
 * contrat démarré « aujourd'hui » se retrouverait daté de demain — donc pas
 * encore dû. C'est exactement le défaut qui a fait rougir `main` le 20/08 :
 * vert à 11 h UTC, rouge à 12 h.
 */
function ilYaNMois(n: number): string {
  const d = new Date();
  const jour = d.getDate();
  d.setDate(1);                       // d'abord le 1er, sinon le 31 déborde
  d.setMonth(d.getMonth() - n);
  const dansLeMois = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(jour, dansLeMois));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Un contrat, posé en SQL brut pour maîtriser sa date de début.
 * Un contrat démarré « il y a trois mois » est dû quatre fois — l'échéance
 * d'ancrage comprise — quel que soit le jour où la CI tourne.
 */
async function contrat(
  tenantId: string,
  opts: { moisEnArriere: number; cadence?: string; montant?: number | null; status?: string },
): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO contrats (id, tenant_id, label, client_name, cadence, amount_cents, status, start_date)
     VALUES ($1, $2::uuid, 'Maintenance annuelle', 'Cabinet Martin', $3, $4, $5, $6)`,
    [id, tenantId, opts.cadence ?? "mensuel", opts.montant === undefined ? 50_000 : opts.montant,
     opts.status ?? "ACTIF", ilYaNMois(opts.moisEnArriere)],
  );
  return id;
}

const facturer = (c: string, corps: Record<string, unknown> = {}) =>
  request(serveurTest(app)).post("/api/contrats/facturer-echeances").set("Cookie", c).send(corps);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("les échéances dues deviennent des factures", () => {
  test("un contrat mensuel démarré il y a 3 mois rattrape ses 4 échéances", async () => {
    // Le rattrapage est le cœur de la story : personne ne clique le 1er de
    // chaque mois. Quatre et non trois — l'échéance du jour d'ancrage est
    // due dès ce jour-là, `planOccurrences` inclut le jour J.
    const t = await inscrire("rattrapage");
    const c = await contrat(t.tenantId, { moisEnArriere: 3 });

    const { body } = await facturer(t.cookie, { contratId: c }).expect(201);
    expect(body.creees).toBe(4);
    expect(body.factures).toHaveLength(4);
  });

  test("chaque facture porte SON échéance, et elles sont distinctes", async () => {
    const t = await inscrire("distinctes");
    const c = await contrat(t.tenantId, { moisEnArriere: 2 });
    await facturer(t.cookie, { contratId: c }).expect(201);

    const { rows } = await adminPool.query(
      "SELECT echeance_le FROM factures WHERE contrat_id = $1 ORDER BY echeance_le", [c],
    );
    const dates = rows.map((r) => String(r.echeance_le));
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toHaveLength(3);
  });

  test("un rattrapage ne fabrique AUCUNE facture en retard", async () => {
    // Le défaut le plus insidieux du lot, et il n'était pas dans le calcul :
    // dater les factures de leur échéance passée les faisait toutes compter
    // « en retard » (`facturesEnRetard.ts` n'exclut pas les brouillons, et
    // une assertion explicite le dit). L'artisan aurait vu quatre factures
    // en retard que son client n'a jamais reçues.
    //
    // Même raison de fond que la chronologie : le numéro est attribué
    // aujourd'hui, la facture doit donc être datée d'aujourd'hui.
    const t = await inscrire("retard");
    const c = await contrat(t.tenantId, { moisEnArriere: 4 });
    await facturer(t.cookie, { contratId: c }).expect(201);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM factures
       -- due_date est du TEXT (AAAA-MM-JJ) : comparaison chaine a chaine,
       -- comme partout ailleurs dans ce depot. Un cast en date passerait ici
       -- et masquerait la vraie forme de la colonne.
       WHERE contrat_id = $1 AND due_date < to_char(CURRENT_DATE, 'YYYY-MM-DD')`, [c],
    );
    expect(rows[0].n).toBe(0);
  });

  test("la période facturée reste lisible sur la LIGNE", async () => {
    // Puisque la date de facture ne la porte plus, le libellé doit la dire —
    // sinon cinq factures identiques du même jour ne se distinguent plus.
    const t = await inscrire("periode");
    const c = await contrat(t.tenantId, { moisEnArriere: 2 });
    const { body } = await facturer(t.cookie, { contratId: c }).expect(201);

    const libelles = body.factures.map(
      (f: { lines: { description: string }[] }) => f.lines[0]!.description,
    );
    expect(new Set(libelles).size).toBe(3);
    // `\w` ne couvre PAS les lettres accentuées en JavaScript : « août » ne
    // matcherait pas. Le même piège que `\b` dans `evalAgent.ts`, vérifié
    // plutôt que supposé.
    for (const l of libelles) expect(l).toMatch(/ — \S+ 20\d\d$/);
  });

  test("la facture est un BROUILLON sans numéro — générer n'est pas envoyer", async () => {
    // Le point d'attention de la story, tenu par construction : un brouillon
    // n'est pas parti, ne consomme aucun numéro, et se corrige.
    const t = await inscrire("brouillon");
    const c = await contrat(t.tenantId, { moisEnArriere: 1 });

    const { body } = await facturer(t.cookie, { contratId: c }).expect(201);
    for (const f of body.factures) {
      expect(f.statut).toBe("BROUILLON");
      expect(f.number).toBe("");
    }
  });

  test("le montant du contrat devient la ligne, TVA comprise", async () => {
    const t = await inscrire("montant");
    const c = await contrat(t.tenantId, { moisEnArriere: 0, montant: 50_000 });

    const { body } = await facturer(t.cookie, { contratId: c }).expect(201);
    const f = body.factures[0];
    expect(f.totalHTCents).toBe(50_000);
    expect(f.totalTVACents).toBe(10_000);
    expect(f.amountCents).toBe(60_000);
    expect(f.lines[0].description).toContain("Maintenance annuelle");
  });

  test("elle entre au Classeur comme toute facture", async () => {
    const t = await inscrire("classeur");
    const c = await contrat(t.tenantId, { moisEnArriere: 0 });
    const { body } = await facturer(t.cookie, { contratId: c }).expect(201);

    const { rows } = await adminPool.query(
      "SELECT source_id FROM classeur_documents WHERE tenant_id = $1 AND source_type = 'FACTURE'",
      [t.tenantId],
    );
    expect(rows.map((r) => r.source_id)).toContain(body.factures[0].id);
  });
});

describe("une échéance ne se facture qu'UNE fois", () => {
  test("rejouer la route ne crée rien de plus", async () => {
    // Sans cette garantie, un utilisateur qui clique deux fois double la
    // facturation de son client. C'est le défaut le plus coûteux du lot.
    const t = await inscrire("idempotent");
    const c = await contrat(t.tenantId, { moisEnArriere: 2 });

    const premier = await facturer(t.cookie, { contratId: c }).expect(201);
    expect(premier.body.creees).toBe(3);

    const second = await facturer(t.cookie, { contratId: c }).expect(201);
    expect(second.body.creees).toBe(0);

    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM factures WHERE contrat_id = $1", [c],
    );
    expect(rows[0].n).toBe(3);
  });

  test("l'INDEX refuse le doublon, pas seulement le code", async () => {
    // La garantie doit tenir même si deux requêtes lisent « pas encore
    // facturé » en même temps. On court-circuite donc la route et on écrit
    // directement : c'est PostgreSQL qui doit dire non.
    const t = await inscrire("index");
    const c = await contrat(t.tenantId, { moisEnArriere: 0 });
    await facturer(t.cookie, { contratId: c }).expect(201);

    const { rows } = await adminPool.query(
      "SELECT echeance_le FROM factures WHERE contrat_id = $1 LIMIT 1", [c],
    );
    await expect(adminPool.query(
      `INSERT INTO factures (id, tenant_id, customer_name, number, issued_date, due_date,
                             amount_cents, statut, contrat_id, echeance_le)
       VALUES ($1, $2::uuid, 'X', '', CURRENT_DATE, CURRENT_DATE, 1, 'BROUILLON', $3, $4)`,
      [crypto.randomUUID(), t.tenantId, c, rows[0].echeance_le],
    )).rejects.toThrow(/factures_contrat_echeance_idx|duplicate key/);
  });
});

describe("la résiliation arrête la génération", () => {
  test("un contrat TERMINE ne produit plus rien", async () => {
    // Troisième critère : « une résiliation retire la prochaine occurrence
    // sans action manuelle supplémentaire ». Il n'y a rien à retirer —
    // l'état du contrat EST le planning.
    const t = await inscrire("termine");
    const c = await contrat(t.tenantId, { moisEnArriere: 3, status: "TERMINE" });

    const { body } = await facturer(t.cookie, { contratId: c }).expect(201);
    expect(body.creees).toBe(0);
    expect(body.ecartes).toHaveLength(0);   // ce n'est pas un défaut à signaler
  });

  test("résilier APRÈS coup ne détruit pas les factures déjà émises", async () => {
    // Elles sont dues. Les faire disparaître serait une perte de créance.
    const t = await inscrire("apres");
    const c = await contrat(t.tenantId, { moisEnArriere: 2 });
    await facturer(t.cookie, { contratId: c }).expect(201);

    await adminPool.query("UPDATE contrats SET status = 'TERMINE' WHERE id = $1", [c]);
    const { body } = await facturer(t.cookie, { contratId: c }).expect(201);
    expect(body.creees).toBe(0);

    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM factures WHERE contrat_id = $1", [c],
    );
    expect(rows[0].n).toBe(3);
  });

  test("un contrat SUSPENDU ne produit rien non plus", async () => {
    const t = await inscrire("suspendu");
    const c = await contrat(t.tenantId, { moisEnArriere: 3, status: "SUSPENDU" });
    const { body } = await facturer(t.cookie, { contratId: c }).expect(201);
    expect(body.creees).toBe(0);
  });
});

describe("ce qui ne peut pas être facturé est NOMMÉ", () => {
  test("un contrat sans montant ressort dans les écarts", async () => {
    // Le silence ferait croire à un abonnement suivi qui ne l'est pas — et
    // personne ne le découvrirait avant le trou de trésorerie.
    const t = await inscrire("sansmontant");
    const c = await contrat(t.tenantId, { moisEnArriere: 2, montant: null });

    const { body } = await facturer(t.cookie, { contratId: c }).expect(201);
    expect(body.creees).toBe(0);
    expect(body.ecartes).toHaveLength(1);
    expect(body.ecartes[0].motif).toMatch(/montant/);
  });

  test("un contrat introuvable donne 404, pas un succès vide", async () => {
    const t = await inscrire("introuvable");
    await facturer(t.cookie, { contratId: crypto.randomUUID() }).expect(404);
  });
});

describe("sans contratId, tous les contrats actifs sont traités", () => {
  test("deux contrats, deux séries de factures", async () => {
    const t = await inscrire("lot");
    const a = await contrat(t.tenantId, { moisEnArriere: 1 });
    const b = await contrat(t.tenantId, { moisEnArriere: 0, cadence: "annuel" });

    const { body } = await facturer(t.cookie).expect(201);
    expect(body.creees).toBe(3);   // 2 pour le mensuel, 1 pour l'annuel

    const compte = async (id: string) => (await adminPool.query(
      "SELECT count(*)::int AS n FROM factures WHERE contrat_id = $1", [id],
    )).rows[0].n;
    expect(await compte(a)).toBe(2);
    expect(await compte(b)).toBe(1);
  });
});

describe("l'isolation", () => {
  test("les contrats d'un tenant ne sont pas facturés par un autre", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    const c = await contrat(a.tenantId, { moisEnArriere: 2 });

    // B demande explicitement le contrat de A : il doit être introuvable.
    await facturer(b.cookie, { contratId: c }).expect(404);

    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM factures WHERE contrat_id = $1", [c],
    );
    expect(rows[0].n).toBe(0);
  });
});
