/**
 * Commande vocale — équipe & planning (`declarer_absence`, `affecter_membre`).
 *
 * Même doctrine que `voix.test.ts`, appliquée aux deux nouveaux types :
 *   a. aller-retour complet, écriture réelle, rejeu sans effet ;
 *   b. les trois états de `resoudreMention` sur le membre (résolu, ambigu,
 *      introuvable) — zéro écriture hors du cas résolu ;
 *   c. date de fin antérieure à la date de début → rejeté, zéro écriture ;
 *   d. `affecter_membre` : la cible (affaire OU membre) a disparu entre la
 *      construction du plan et son exécution → 409, ZÉRO ligne orpheline —
 *      `affectations` n'a pas de FK, contrairement à `absences.membre_id` ;
 *   e. isolation tenant ;
 *   f. l'agent de chat propose aussi `declare_absence`, via un vrai aller-
 *      retour `list_team_members` → `declare_absence`.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, createTestTeamMember, completeMfaForRegisteredOwner } from "./helpers";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `voix-equipe-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
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

// ── a. Aller-retour complet ──────────────────────────────────────────────────

describe("a — declarer_absence, aller-retour complet", () => {
  test("interpréter → plan → exécuter → ligne réelle en base, rejeu sans effet", async () => {
    await createTestTeamMember(a.tenantId, "Sophie");

    const { body } = await interpreter(a, "voix-test-absence Sophie est malade demain").expect(200);
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0].champs.typeAbsence).toBe("Maladie");
    expect(body.operations[0].champs.dateDebut).toBe(body.operations[0].champs.dateFin);

    const premier = await executer(a, body.planId).expect(200);
    expect(premier.body.deja).toBe(false);

    const { rows } = await adminPool.query(
      `SELECT type, date_debut, date_fin FROM absences WHERE tenant_id = $1::uuid`,
      [a.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("Maladie");

    // Rejeu : pas de deuxième ligne.
    const second = await executer(a, body.planId).expect(200);
    expect(second.body.deja).toBe(true);
    const apres = await adminPool.query(
      `SELECT count(*)::int AS n FROM absences WHERE tenant_id = $1::uuid`, [a.tenantId],
    );
    expect(apres.rows[0].n).toBe(1);
  });
});

describe("a bis — affecter_membre, aller-retour complet", () => {
  test("interpréter → plan → exécuter → ligne réelle en base, 7h/jour par défaut", async () => {
    await createTestTeamMember(a.tenantId, "Sophie affectation");
    await affaire(a, "Dupont");

    const { body } = await interpreter(a, "voix-test-affecter Sophie sur Dupont du lundi au vendredi").expect(200);
    expect(body.operations).toHaveLength(1);

    await executer(a, body.planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT heures_par_jour, jours_ouvres_seulement FROM affectations WHERE tenant_id = $1::uuid`,
      [a.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].heures_par_jour)).toBe(7);
    expect(rows[0].jours_ouvres_seulement).toBe(true);
  });
});

// ── b. Les trois états de resoudreMention, sur le membre ───────────────────

describe("b — résolution du membre", () => {
  test("deux membres au nom proche → une question, zéro écriture", async () => {
    await createTestTeamMember(a.tenantId, "Sophie Marchand");
    await createTestTeamMember(a.tenantId, "Paul Marchand");

    const { body } = await interpreter(a, "voix-test-absence-ambigu Marchand en congés").expect(200);
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].candidats.length).toBeGreaterThanOrEqual(2);
    expect(body.operations).toHaveLength(0);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM absences WHERE tenant_id = $1::uuid AND type = 'Congés'`,
      [a.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  test("membre introuvable → nonCompris, zéro écriture", async () => {
    await affaire(a, "Dupont introuvable");
    const { body } = await interpreter(a, "voix-test-affecter-introuvable").expect(200);
    expect(body.operations).toHaveLength(0);
    expect(body.nonCompris.length).toBeGreaterThan(0);
  });
});

// ── c. Date de fin avant date de début ──────────────────────────────────────

describe("c — période incohérente", () => {
  test("date de fin antérieure à la date de début → rejeté", async () => {
    // Nom distinct des autres tests de ce fichier : un second membre nommé
    // exactement "Sophie" rendrait la mention AMBIGUË (deux correspondances
    // exactes) plutôt que résolue, et ce test ne prouverait plus rien sur les
    // dates.
    await createTestTeamMember(a.tenantId, "Sophie dates");
    const { body } = await interpreter(a, "voix-test-absence-dates-inversees").expect(200);
    expect(body.operations).toHaveLength(0);
    expect(body.nonCompris.length).toBeGreaterThan(0);
  });
});

// ── d. affectations n'a pas de FK — garde explicite à l'exécution ──────────

describe("d — affecter_membre : la cible a disparu entre la construction et l'exécution du plan", () => {
  test("affaire_id fantôme dans la charge utile → 409, ZÉRO ligne orpheline", async () => {
    const membre = await createTestTeamMember(a.tenantId, "Sophie fantome");
    const { body } = await interpreter(a, "voix-test-affecter Sophie sur Dupont du lundi au vendredi").expect(200);

    // On truque la charge utile comme le test « tout ou rien » de voix.test.ts
    // — c'est le seul moyen d'éprouver la vérification d'existence, puisque
    // `construirePlan` aurait lui-même refusé une affaire déjà inexistante.
    const affaireFantome = crypto.randomUUID(); // n'existe dans AUCUNE ligne d'affaires
    await adminPool.query(
      `UPDATE pending_actions SET payload = $1::jsonb WHERE id = $2`,
      [
        JSON.stringify({
          operations: [{
            type: "affecter_membre",
            libelle: "Affectation fantôme",
            champs: {
              membreId: membre.id,
              affaireId: affaireFantome,
              dateDebut: "2026-08-24",
              dateFin: "2026-08-28",
              heuresParJour: "7",
            },
            certitude: "exacte",
          }],
          questions: [],
          nonCompris: [],
        }),
        body.planId,
      ],
    );

    await executer(a, body.planId).expect(409);

    // Scopé sur l'affaire fantôme précisément : d'autres tests de ce fichier
    // écrivent de vraies affectations pour le même tenant, un compte global
    // ne prouverait rien de spécifique à CE plan.
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM affectations WHERE tenant_id = $1::uuid AND affaire_id = $2`,
      [a.tenantId, affaireFantome],
    );
    // Sans la vérification explicite d'existence ajoutée dans
    // executerOperation, cette assertion échouerait : une ligne orpheline
    // aurait été insérée sans erreur (pas de FK sur affectations.affaire_id).
    expect(rows[0].n).toBe(0);
  });
});

// ── e. Isolation ─────────────────────────────────────────────────────────────

describe("e — un plan équipe/planning appartient à son tenant", () => {
  test("le tenant B ne peut ni lire ni exécuter le plan de A", async () => {
    await createTestTeamMember(a.tenantId, "Sophie isolation");
    const { body } = await interpreter(a, "voix-test-absence Sophie isolation malade").expect(200);

    const reponse = await executer(b, body.planId);
    expect(reponse.status).toBe(404);
    expect(JSON.stringify(reponse.body)).not.toContain("Sophie");

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM absences WHERE tenant_id = $1::uuid`, [b.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});

// ── f. L'agent de chat propose aussi declare_absence ────────────────────────

describe("f — declare_absence via l'agent de chat", () => {
  test("list_team_members (réel) puis declare_absence (proposé) → un plan, puis une ligne", async () => {
    // Le simulateur choisit le PREMIER membre rendu par list_team_members
    // (ordonné par nom) — potentiellement l'un des membres créés par les
    // tests précédents de ce fichier, pas forcément celui-ci. Ce test prouve
    // la CHAÎNE (id réel obtenu par outil → proposition → exécution → ligne
    // en base), pas que ce membre précis a été choisi.
    await createTestTeamMember(a.tenantId, "Sophie chat agent");

    const avant = await adminPool.query(
      `SELECT count(*)::int AS n FROM absences WHERE tenant_id = $1::uuid`, [a.tenantId],
    );

    const { body } = await request(app)
      .post("/api/chat/messages")
      .set("Cookie", a.cookie)
      .send({ content: "agent-declare-absence Sophie chat agent est malade" })
      .expect(200);

    expect(body.planId, "l'agent doit avoir créé un plan").toBeTruthy();
    const apres = await adminPool.query(
      `SELECT count(*)::int AS n FROM absences WHERE tenant_id = $1::uuid`, [a.tenantId],
    );
    expect(apres.rows[0].n).toBe(avant.rows[0].n);

    await executer(a, body.planId).expect(200);
    const final = await adminPool.query(
      `SELECT a.membre_id FROM absences a
        JOIN team_members m ON m.id = a.membre_id
       WHERE a.tenant_id = $1::uuid
       ORDER BY a.created_at DESC LIMIT 1`,
      [a.tenantId],
    );
    // La jointure elle-même est la preuve : un `membreId` vide ou inventé —
    // exactement ce que produisait le bug de la double-proposition — n'aurait
    // satisfait ni la contrainte FK à l'écriture (donc pas de ligne du tout),
    // ni cette jointure.
    expect(final.rows).toHaveLength(1);
  });
});

// ── e. Pointer des heures à la voix (ticket 4.21, lot 1) ─────────────────────
//
// « Trois heures chez Delacroix aujourd'hui. » C'est la saisie qu'on repousse
// au vendredi et qu'on finit par faire de mémoire, donc mal.

describe("e — pointer_heures, aller-retour complet", () => {
  test("membre et date dictés → une ligne réelle, source « confirmé »", async () => {
    const t = await inscrire("pointage");
    await createTestTeamMember(t.tenantId, "Sophie");
    await affaire(t, "Dupont");

    const { body } = await interpreter(t, "voix-test-pointage").expect(200);
    expect(body.operations).toHaveLength(1);
    // Le nombre vient de la PHRASE, pas d'un calcul : la règle 3 interdit au
    // modèle de calculer un total, pas de transcrire ce qu'il entend.
    expect(body.operations[0].champs.heures).toBe("7.5");

    await executer(t, body.planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT heures::float AS heures, source, date FROM pointages WHERE tenant_id = $1::uuid`,
      [t.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].heures).toBe(7.5);
    // « confirmé » : ces heures ont été affirmées puis validées à l'écran.
    // « proposé » désignerait une heure que personne n'a dite.
    expect(rows[0].source).toBe("confirme");
  });

  test("sans nom dicté, c'est CELUI QUI PARLE — résolu par le serveur", async () => {
    const t = await inscrire("pointage-moi");
    await affaire(t, "Dupont");

    // Le membre d'équipe porte l'adresse du compte : c'est le seul lien
    // existant entre un utilisateur et un membre (team_members n'a pas de
    // colonne user_id), et le rapprochement se fait dessus.
    const { rows: session } = await adminPool.query(
      `SELECT u.email FROM users u
         JOIN memberships m ON m.user_id = u.id
        WHERE m.tenant_id = $1::uuid LIMIT 1`,
      [t.tenantId],
    );
    await adminPool.query(
      `INSERT INTO team_members (id, tenant_id, name, email) VALUES ($1, $2::uuid, 'Le patron', $3)`,
      [crypto.randomUUID(), t.tenantId, session[0].email],
    );

    const { body } = await interpreter(t, "voix-test-pointage-sans-nom").expect(200);
    expect(body.operations).toHaveLength(1);
    await executer(t, body.planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT p.heures::float AS heures, m.name FROM pointages p
         JOIN team_members m ON m.id = p.membre_id
        WHERE p.tenant_id = $1::uuid`,
      [t.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].heures).toBe(3);
    expect(rows[0].name).toBe("Le patron");
  });

  test("sans nom dicté ET sans membre correspondant → refus explicite, zéro ligne", async () => {
    const t = await inscrire("pointage-orphelin");
    await affaire(t, "Dupont");

    const { body } = await interpreter(t, "voix-test-pointage-sans-nom").expect(200);
    // Le plan se construit — c'est à l'EXÉCUTION que le rapprochement échoue.
    // Mieux vaut refuser que pointer les heures de quelqu'un d'autre parce
    // qu'une correspondance approximative a semblé plausible.
    const r = await executer(t, body.planId);
    expect(r.status).toBeGreaterThanOrEqual(400);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM pointages WHERE tenant_id = $1::uuid`,
      [t.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});

// ── f. Créer un client à la voix (ticket 4.21, lot 2) ────────────────────────

describe("f — creer_client, aller-retour complet", () => {
  test("« nouveau client … à Rouen » → une ligne réelle, type NON dicté", async () => {
    const t = await inscrire("client");

    const { body } = await interpreter(t, "voix-test-client").expect(200);
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0].libelle).toContain("Menuiserie Delacroix");

    await executer(t, body.planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT nom, ville, telephone, type FROM clients WHERE tenant_id = $1::uuid`,
      [t.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nom).toBe("Menuiserie Delacroix");
    expect(rows[0].ville).toBe("Rouen");
    // Le TYPE reste le défaut de la table : particulier et professionnel
    // n'obéissent pas aux mêmes règles de démarchage, et le déduire d'un nom
    // d'entreprise entendu serait une décision juridique prise par un modèle.
    expect(rows[0].type).toBe("PARTICULIER");
  });

  test("rejeu du même plan → aucun doublon de client", async () => {
    const t = await inscrire("client-rejeu");
    const { body } = await interpreter(t, "voix-test-client").expect(200);

    await executer(t, body.planId).expect(200);
    const second = await executer(t, body.planId).expect(200);
    expect(second.body.deja).toBe(true);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM clients WHERE tenant_id = $1::uuid`,
      [t.tenantId],
    );
    // Un client créé deux fois, c'est un dossier dédoublé — et une fusion
    // manuelle plus tard, si quelqu'un s'en aperçoit.
    expect(rows[0].n).toBe(1);
  });
});
