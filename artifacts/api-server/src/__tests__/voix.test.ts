/**
 * Commande vocale — intention, plan, validation, exécution.
 *
 * Ce que ces tests protègent :
 *   a. le modèle ne peut pas écrire — sortie non conforme → plan vide ;
 *   b. une phrase illisible ne produit AUCUNE opération inventée ;
 *   c. une ambiguïté produit une question, zéro opération, zéro écriture ;
 *   d. transaction : une opération qui échoue en annule trois ;
 *   e. rejeu : deux exécutions du même plan → une seule écriture ;
 *   f. isolation : un plan de A n'est ni lisible ni exécutable par B — vérifié
 *      sur le CORPS, pas seulement sur le code ;
 *   g. l'agent n'écrit plus directement : zéro ligne en base, une
 *      `pending_action` ; après validation, la ligne apparaît.
 *   h. un « OK » en langage naturel, plan déjà en attente → jamais un
 *      second plan en doublon ; une fois le premier décidé, une nouvelle
 *      demande identique en pose bien un nouveau.
 *
 * Aucun test n'atteint le réseau : le modèle est intercepté par vitest.setup.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `voix-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

const interpreter = (l: Locataire, texte: string) =>
  request(app).post("/api/voix/interpreter").set("Cookie", l.cookie).send({ texte });

const executer = (l: Locataire, planId: string) =>
  request(app).post("/api/voix/executer").set("Cookie", l.cookie).send({ planId });

async function affaire(l: Locataire, label: string): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO affaires (id, tenant_id, label, status) VALUES ($1, $2::uuid, $3, 'EN_COURS')`,
    [id, l.tenantId, label],
  );
  return id;
}

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a & b. Le modèle ne peut pas écrire ─────────────────────────────────────

describe("a — une sortie de modèle non conforme est REJETÉE, pas nettoyée", () => {
  test("une intention porteuse d'un `id` produit un plan vide", async () => {
    const { body } = await interpreter(a, "voix-test-interdit crée une affaire").expect(200);
    // Nettoyer laisserait croire qu'on a compris ce qui a été proposé.
    expect(body.operations).toHaveLength(0);
    expect(body.nonCompris.length).toBeGreaterThan(0);

    const avant = await adminPool.query(
      `SELECT count(*)::int AS n FROM affaires WHERE tenant_id = $1::uuid`, [a.tenantId],
    );
    expect(avant.rows[0].n).toBe(0);
  });
});

describe("b — une phrase illisible n'invente rien", () => {
  test("plan vide, `nonCompris` renseigné, aucune opération", async () => {
    const { body } = await interpreter(a, "voix-test-illisible brrr").expect(200);
    expect(body.operations).toHaveLength(0);
    expect(body.nonCompris.length).toBeGreaterThan(0);
    expect(body.questions).toHaveLength(0);
  });
});

// ── c. Ambiguïté ────────────────────────────────────────────────────────────

describe("c — deux affaires du même nom", () => {
  test("une question, zéro opération, zéro écriture", async () => {
    await affaire(a, "Dupont rue des Lilas");
    await affaire(a, "Dupont chantier de Marly");

    const { body } = await interpreter(a, "voix-test-ambigu passe Dupont en cours").expect(200);

    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].candidats).toHaveLength(2);
    expect(body.operations).toHaveLength(0);

    // Une ambiguïté ne se tranche pas par un tirage au sort : aucun statut
    // n'a bougé.
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM affaires WHERE tenant_id = $1::uuid AND status <> 'EN_COURS'`,
      [a.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  test("UNE SEULE question à la fois", async () => {
    const { body } = await interpreter(a, "voix-test-ambigu deux fois").expect(200);
    expect(body.questions.length).toBeLessThanOrEqual(1);
  });
});

// ── d. Transaction ──────────────────────────────────────────────────────────

describe("d — tout ou rien", () => {
  test("un plan de trois opérations dont une échoue n'en écrit aucune", async () => {
    // Le simulateur produit : activité, changement de statut sur une affaire
    // FANTÔME, activité. La deuxième est écartée à la construction du plan
    // (introuvable) — on fabrique donc l'échec à l'exécution en truquant la
    // charge utile, ce qui est le seul moyen d'éprouver la transaction.
    const { body } = await interpreter(a, "voix-test-trois opérations").expect(200);
    const planId = body.planId as string;

    await adminPool.query(
      `UPDATE pending_actions SET payload = $1::jsonb WHERE id = $2`,
      [
        JSON.stringify({
          operations: [
            { type: "consigner_activite", libelle: "Première", champs: { libelle: "Première" }, certitude: "aucune_resolution" },
            { type: "maj_statut_affaire", libelle: "Cible disparue", champs: { affaireId: "inexistant", statut: "TERMINEE" }, certitude: "exacte" },
            { type: "consigner_activite", libelle: "Troisième", champs: { libelle: "Troisième" }, certitude: "aucune_resolution" },
          ],
          questions: [],
          nonCompris: [],
        }),
        planId,
      ],
    );

    await executer(a, planId).expect(409);

    // AUCUNE des trois n'est en base — pas même la première, qui aurait pu
    // passer. Un plan à moitié appliqué est le pire résultat.
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM activity WHERE tenant_id = $1::uuid AND label IN ('Première','Troisième')`,
      [a.tenantId],
    );
    expect(rows[0].n).toBe(0);

    // Et le plan n'est pas marqué appliqué : il reste jouable une fois la
    // cause corrigée.
    const plan = await adminPool.query(
      `SELECT execute_le FROM pending_actions WHERE id = $1`, [planId],
    );
    expect(plan.rows[0].execute_le).toBeNull();
  });
});

// ── e. Rejeu ────────────────────────────────────────────────────────────────

describe("e — rejouer un plan n'écrit pas deux fois", () => {
  test("deux exécutions → une seule écriture", async () => {
    const { body } = await interpreter(a, "voix-test-simple crée une affaire").expect(200);
    expect(body.operations).toHaveLength(1);

    const premier = await executer(a, body.planId).expect(200);
    expect(premier.body.deja).toBe(false);

    const second = await executer(a, body.planId).expect(200);
    expect(second.body.deja).toBe(true);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM affaires WHERE tenant_id = $1::uuid AND label = 'Carrelage Dupont'`,
      [a.tenantId],
    );
    expect(rows[0].n).toBe(1);
  });

  test("un plan expiré est refusé en 410", async () => {
    const { body } = await interpreter(a, "voix-test-simple encore").expect(200);
    await adminPool.query(
      `UPDATE pending_actions SET expire_le = NOW() - interval '1 minute' WHERE id = $1`,
      [body.planId],
    );
    await executer(a, body.planId).expect(410);
  });

  test("un plan inconnu → 404", async () => {
    await executer(a, crypto.randomUUID()).expect(404);
  });
});

// ── f. Isolation ────────────────────────────────────────────────────────────

describe("f — un plan appartient à son tenant", () => {
  test("le tenant B ne peut ni lire ni exécuter le plan de A", async () => {
    const { body } = await interpreter(a, "voix-test-simple pour A").expect(200);

    const reponse = await executer(b, body.planId);
    expect(reponse.status).toBe(404);
    // Le CORPS ne doit rien révéler du plan de A — ni son libellé, ni ses
    // opérations. Un 404 bavard renseigne autant qu'un 200.
    expect(JSON.stringify(reponse.body)).not.toContain("Carrelage Dupont");

    // Et rien n'a été écrit chez B.
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM affaires WHERE tenant_id = $1::uuid`, [b.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});

// ── Dates ───────────────────────────────────────────────────────────────────

describe("les dates dictées traversent la route sans décalage", () => {
  test("« le 27 août » devient une échéance au 27 août", async () => {
    const { body } = await interpreter(a, "voix-test-date acompte le 27 août").expect(200);
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0].champs.date).toMatch(/^\d{4}-08-27$/);
  });
});

// ── g. L'agent n'écrit plus directement ─────────────────────────────────────

describe("g — l'agent PROPOSE, il n'exécute pas", () => {
  test("demander une création → zéro ligne écrite, une pending_action", async () => {
    const avant = await adminPool.query(
      `SELECT count(*)::int AS n FROM prospects WHERE tenant_id = $1::uuid`, [a.tenantId],
    );

    const { body } = await request(app)
      .post("/api/chat/messages")
      .set("Cookie", a.cookie)
      .send({ content: "Crée un prospect Jean Dupont au 0612345678" })
      .expect(200);

    // Le champ dit ce qu'il est : proposé, pas effectué.
    expect(body).toHaveProperty("actions_proposees");
    expect(body).not.toHaveProperty("actions_performed");

    const apres = await adminPool.query(
      `SELECT count(*)::int AS n FROM prospects WHERE tenant_id = $1::uuid`, [a.tenantId],
    );
    // RIEN n'a été écrit : c'est tout l'objet de la correction.
    expect(apres.rows[0].n).toBe(avant.rows[0].n);

    expect(body.planId, "l'agent doit avoir créé un plan").toBeTruthy();
    const plan = await adminPool.query(
      `SELECT type, status FROM pending_actions WHERE id = $1`, [body.planId],
    );
    expect(plan.rows[0].type).toBe("PLAN_VOCAL");
    expect(plan.rows[0].status).toBe("EN_ATTENTE");

    // Après validation, la ligne apparaît.
    await executer(a, body.planId).expect(200);
    const final = await adminPool.query(
      `SELECT count(*)::int AS n FROM prospects WHERE tenant_id = $1::uuid AND name = 'Jean Dupont'`,
      [a.tenantId],
    );
    expect(final.rows[0].n).toBe(1);
  });

  test("les outils d'ÉCRITURE sont tous connus de la garde", async () => {
    // Si quelqu'un ajoute un outil d'écriture sans l'inscrire, il retombera
    // dans le `switch` — où plus aucun `case` d'écriture n'existe — et rendra
    // « Outil inconnu ». La garde ci-dessous le rappelle explicitement.
    const { OUTILS_ECRITURE } = await import("../lib/mistralAgent.js");
    for (const outil of ["create_affaire", "create_prospect", "create_echeance",
                         "create_classeur_entry", "log_activity",
                         "update_affaire_status", "update_prospect",
                         "declare_absence", "affect_member"]) {
      expect(OUTILS_ECRITURE as readonly string[]).toContain(outil);
    }
  });

  test("chaque outil d'écriture produit une opération de SON PROPRE type — pas un consigner_activite fourre-tout", async () => {
    // La garde ci-dessus ne vérifie que la présence dans la liste blanche :
    // elle serait verte même si `proposerEcriture` n'avait pas de `case` pour
    // un outil (il retomberait alors, silencieusement, sur le type générique
    // `consigner_activite`, avec un libellé qui ne dit rien de ce qui a été
    // demandé). Ce test attrape précisément ça.
    const { proposerEcriture } = await import("../lib/mistralAgent.js");
    const attendus: Record<string, string> = {
      create_affaire: "creer_affaire",
      update_affaire_status: "maj_statut_affaire",
      create_prospect: "creer_prospect",
      create_echeance: "creer_echeance",
      create_classeur_entry: "creer_entree_classeur",
      declare_absence: "declarer_absence",
      affect_member: "affecter_membre",
    };
    for (const [outil, typeAttendu] of Object.entries(attendus)) {
      expect(proposerEcriture(outil, {}).type, `outil ${outil}`).toBe(typeAttendu);
    }
  });
});

// ── h. Un « OK » ne double pas le plan ──────────────────────────────────────
//
// Le simulateur (ligne ~232) ne reconnaît qu'un seul nom — « jean dupont » —
// pour rendre l'appel d'outil `create_prospect` déterministe : c'est donc ce
// nom, et lui seul, qui doit servir de contenu dans ce bloc.

describe("h — dicter deux fois la même intention ne pose pas deux plans", () => {
  test("« OK » en langage naturel, plan déjà en attente → même plan, pas un doublon ; une fois décidé, la suivante en pose un nouveau", async () => {
    const contenu = "Crée un prospect Jean Dupont au 0612345678";

    const premier = await request(app)
      .post("/api/chat/messages")
      .set("Cookie", b.cookie)
      .send({ content: contenu })
      .expect(200);
    expect(premier.body.planId, "premier appel : un plan doit être créé").toBeTruthy();

    // Le modèle, relancé sur la même conversation, propose à nouveau
    // exactement la même opération — c'est le scénario réel d'un « OK » en
    // langage naturel : il n'a pas de mécanisme pour « approuver », donc il
    // redécrit ce qu'il a déjà proposé.
    const second = await request(app)
      .post("/api/chat/messages")
      .set("Cookie", b.cookie)
      .send({ content: contenu })
      .expect(200);
    expect(second.body.planId, "second appel : même plan renvoyé, pas un nouveau").toBe(premier.body.planId);

    const enAttente = await adminPool.query(
      `SELECT count(*)::int AS n FROM pending_actions
        WHERE id = $1 AND status = 'EN_ATTENTE' AND decided_at IS NULL`,
      [premier.body.planId],
    );
    expect(enAttente.rows[0].n, "toujours une seule pending_action EN_ATTENTE pour ce plan").toBe(1);

    // Une fois ce plan décidé, ce n'est plus « le même plan en attente » —
    // une nouvelle demande identique doit reposer un plan à part. La garde
    // contre les doublons ne doit empêcher que le vrai doublon, pas toute
    // création future.
    await executer(b, premier.body.planId).expect(200);
    const troisieme = await request(app)
      .post("/api/chat/messages")
      .set("Cookie", b.cookie)
      .send({ content: contenu })
      .expect(200);
    expect(troisieme.body.planId, "après décision, une nouvelle demande repose un plan").toBeTruthy();
    expect(troisieme.body.planId).not.toBe(premier.body.planId);
  });
});
