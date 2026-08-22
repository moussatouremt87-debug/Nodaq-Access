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

const executer = (
  l: Locataire,
  planId: string,
  corrections?: Record<number, Record<string, string>>,
) =>
  request(app)
    .post("/api/voix/executer")
    .set("Cookie", l.cookie)
    .send({ planId, ...(corrections ? { corrections } : {}) });

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

// ── g. Corriger avant de valider (ticket 4.21) ───────────────────────────────
//
// Un nom propre entendu par une machine devient facilement autre chose. L'écran
// montrait ce qui allait être écrit sans permettre de le rectifier : il fallait
// tout annuler et redicter, ce que personne ne fait deux fois.

describe("g — l'humain corrige le texte avant que ça s'écrive", () => {
  test("un nom mal entendu se corrige, et c'est la CORRECTION qui est écrite", async () => {
    const t = await inscrire("correction");

    const { body } = await interpreter(t, "voix-test-client").expect(200);
    expect(body.operations[0].champs.nom).toBe("Menuiserie Delacroix");

    await request(app)
      .post("/api/voix/executer")
      .set("Cookie", t.cookie)
      .send({
        planId: body.planId,
        corrections: { "0": { nom: "Menuiserie de la Croix", ville: "Le Havre" } },
      })
      .expect(200);

    const { rows } = await adminPool.query(
      `SELECT nom, ville FROM clients WHERE tenant_id = $1::uuid`,
      [t.tenantId],
    );
    expect(rows[0].nom).toBe("Menuiserie de la Croix");
    expect(rows[0].ville).toBe("Le Havre");
  });

  test("corriger un IDENTIFIANT est refusé — et rien ne s'écrit", async () => {
    // Le point de sécurité : un `affaireId` réécrit à la main ne serait plus
    // une correction de transcription, mais le choix d'une AUTRE cible que
    // celle que le serveur a résolue et montrée. La validation humaine
    // porterait alors sur un libellé qui ne décrit plus l'opération.
    const t = await inscrire("correction-forgee");
    await createTestTeamMember(t.tenantId, "Sophie");
    await affaire(t, "Dupont");

    const { body } = await interpreter(t, "voix-test-pointage").expect(200);

    const r = await request(app)
      .post("/api/voix/executer")
      .set("Cookie", t.cookie)
      .send({ planId: body.planId, corrections: { "0": { affaireId: "affaire-d-un-autre" } } })
      .expect(400);
    expect(r.body.error).toMatch(/non autoris/i);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM pointages WHERE tenant_id = $1::uuid`,
      [t.tenantId],
    );
    expect(rows[0].n).toBe(0);

    // Et le plan reste applicable : un refus n'a pas consommé la validation.
    await executer(t, body.planId).expect(200);
    const { rows: apres } = await adminPool.query(
      `SELECT count(*)::int AS n FROM pointages WHERE tenant_id = $1::uuid`,
      [t.tenantId],
    );
    expect(apres[0].n).toBe(1);
  });

  test("un nombre dicté se corrige aussi — c'est l'humain qui le pose", async () => {
    // La règle 3 interdit au MODÈLE de fixer un nombre, pas à l'utilisateur de
    // rectifier le sien.
    const t = await inscrire("correction-heures");
    await createTestTeamMember(t.tenantId, "Sophie");
    await affaire(t, "Dupont");

    const { body } = await interpreter(t, "voix-test-pointage").expect(200);
    await request(app)
      .post("/api/voix/executer")
      .set("Cookie", t.cookie)
      .send({ planId: body.planId, corrections: { "0": { heures: "8" } } })
      .expect(200);

    const { rows } = await adminPool.query(
      `SELECT heures::float AS heures FROM pointages WHERE tenant_id = $1::uuid`,
      [t.tenantId],
    );
    expect(rows[0].heures).toBe(8);
  });
});

// ── h. Enregistrer un règlement à la voix (ticket 4.21, lot 3) ───────────────

/** Une facture ÉMISE, prête à recevoir un règlement. */
async function factureEmise(l: Locataire, numero: string, client: string, montantCents: number): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents, statut, lines, issued_date, due_date)
     VALUES ($1, $2::uuid, $3, $4, $5, 'EMISE', '[]'::jsonb, CURRENT_DATE, CURRENT_DATE + 30)`,
    [id, l.tenantId, numero, client, montantCents],
  );
  return id;
}

describe("h — enregistrer_reglement, aller-retour complet", () => {
  test("le plan propose le SOLDE, calculé par le serveur", async () => {
    const t = await inscrire("reglement");
    const factureId = await factureEmise(t, "FACT-2026-0181", "Delacroix", 40000);

    const { body } = await interpreter(t, "voix-test-reglement").expect(200);
    expect(body.operations).toHaveLength(1);
    // Le chiffre vient du SERVEUR, jamais du modèle : aucun schéma
    // d'intention ne porte de champ monétaire, et une garde le vérifie.
    expect(body.operations[0].champs.montantCents).toBe("40000");
    expect(body.operations[0].libelle).toContain("solde restant");

    await executer(t, body.planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT montant_cents, sens FROM paiements WHERE facture_id = $1`, [factureId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].montant_cents).toBe(40000);
    expect(rows[0].sens).toBe("ENCAISSEMENT");

    // Le statut se DÉDUIT du journal — il n'a pas été écrit à la main.
    const { rows: f } = await adminPool.query(
      `SELECT statut FROM factures WHERE id = $1`, [factureId],
    );
    expect(f[0].statut).toBe("PAYEE");
  });

  test("règlement PARTIEL : l'utilisateur CORRIGE le solde proposé", async () => {
    // Le chemin voulu pour un partiel — et le seul possible : le modèle ne
    // peut pas produire de montant, donc c'est l'humain qui ramène le chiffre
    // à ce qu'il a reçu, de ses doigts, avant de valider.
    const t = await inscrire("reglement-partiel");
    const factureId = await factureEmise(t, "FACT-2026-0182", "Delacroix", 40000);

    const { body } = await interpreter(t, "voix-test-reglement-cheque").expect(200);
    expect(body.operations[0].champs.montantCents).toBe("40000");

    await request(app)
      .post("/api/voix/executer")
      .set("Cookie", t.cookie)
      .send({ planId: body.planId, corrections: { "0": { montantCents: "15000" } } })
      .expect(200);

    const { rows } = await adminPool.query(
      `SELECT montant_cents, moyen FROM paiements WHERE facture_id = $1`, [factureId],
    );
    expect(rows[0].montant_cents).toBe(15000);
    expect(rows[0].moyen).toBe("CHEQUE");

    const { rows: f } = await adminPool.query(
      `SELECT statut FROM factures WHERE id = $1`, [factureId],
    );
    // 150 € sur 400 : il reste dû, la facture n'est pas soldée.
    expect(f[0].statut).toBe("EMISE");
  });

  test("facture réglée entre le plan et sa validation → refus, aucun double encaissement", async () => {
    const t = await inscrire("reglement-course");
    const factureId = await factureEmise(t, "FACT-2026-0183", "Delacroix", 40000);

    const { body } = await interpreter(t, "voix-test-reglement").expect(200);

    // Quelqu'un solde la facture entre-temps — le plan attend jusqu'à une heure.
    await adminPool.query(`UPDATE factures SET statut = 'PAYEE' WHERE id = $1`, [factureId]);

    const r = await executer(t, body.planId);
    expect(r.status).toBe(409);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM paiements WHERE facture_id = $1`, [factureId],
    );
    expect(rows[0].n).toBe(0);
  });
});

// ── i. Lancer une relance à la voix (ticket 4.21, lot 3) ────────────────────

describe("i — lancer_relance : la voix PRÉPARE, elle ne déclenche pas", () => {
  test("les impayés joignables deviennent une campagne PROPOSÉE, à valider", async () => {
    const t = await inscrire("relance");
    const clientId = crypto.randomUUID();
    await adminPool.query(
      `INSERT INTO clients (id, tenant_id, nom, telephone) VALUES ($1, $2::uuid, 'Delacroix', '+33600000042')`,
      [clientId, t.tenantId],
    );
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, number, customer_name, client_id, amount_cents, statut, lines, issued_date, due_date)
       VALUES ($1, $2::uuid, 'FACT-2026-0200', 'Delacroix', $3, 40000, 'EMISE', '[]'::jsonb, CURRENT_DATE - 60, CURRENT_DATE - 30)`,
      [crypto.randomUUID(), t.tenantId, clientId],
    );

    const { body } = await interpreter(t, "voix-test-relance").expect(200);
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0].libelle).toContain("resteront à valider");

    await executer(t, body.planId).expect(200);

    // Une campagne existe, et une action l'attend dans la file — mais AUCUN
    // appel n'est planifié : la règle 4 veut qu'un humain approuve avant
    // qu'on compose, et la voix ne peut pas approuver à sa place.
    const { rows: campagnes } = await adminPool.query(
      `SELECT statut FROM campagnes_relance WHERE tenant_id = $1::uuid`, [t.tenantId],
    );
    expect(campagnes).toHaveLength(1);
    expect(campagnes[0].statut).toBe("PROPOSEE");

    const { rows: appels } = await adminPool.query(
      `SELECT count(*)::int AS n FROM appels_relance WHERE tenant_id = $1::uuid`, [t.tenantId],
    );
    expect(appels[0].n).toBe(0);
  });

  test("un impayé SANS téléphone est écarté et COMPTÉ, jamais ignoré en silence", async () => {
    const t = await inscrire("relance-sans-tel");
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents, statut, lines, issued_date, due_date)
       VALUES ($1, $2::uuid, 'FACT-2026-0201', 'Sans Téléphone', 40000, 'EMISE', '[]'::jsonb, CURRENT_DATE - 60, CURRENT_DATE - 30)`,
      [crypto.randomUUID(), t.tenantId],
    );

    const { body } = await interpreter(t, "voix-test-relance").expect(200);
    // Aucun joignable : on le DIT, plutôt que de rendre un plan vide qui
    // laisserait croire qu'il n'y a pas d'impayé.
    expect(body.operations).toHaveLength(0);
    expect(body.nonCompris.join(" ")).toContain("sans téléphone");
  });

  test("aucune facture en retard → on le dit", async () => {
    const t = await inscrire("relance-a-jour");
    const { body } = await interpreter(t, "voix-test-relance").expect(200);
    expect(body.operations).toHaveLength(0);
    expect(body.nonCompris.join(" ")).toContain("aucune facture en retard");
  });
});

// ── j. Facturer un devis à la voix (ticket 4.21) ────────────────────────────

describe("j — facturer_devis emprunte LE module, pas une seconde conversion", () => {
  /** Un devis accepté, créé par la vraie route pour que ses totaux soient justes. */
  async function devisAccepte(l: Locataire, montantCents: number): Promise<{ id: string; ttc: number }> {
    const { body } = await request(app)
      .post("/api/devis")
      .set("Cookie", l.cookie)
      .send({
        clientName: "Delacroix",
        lines: [{ description: "Pose", quantity: 1, unitPriceCents: montantCents }],
        tvaRate: 20,
      })
      .expect(201);
    await adminPool.query(`UPDATE devis SET status = 'ACCEPTE' WHERE id = $1`, [body.id]);
    return { id: body.id, ttc: body.totalTTCCents };
  }

  test("le plan annonce le montant du devis SIGNÉ, et crée un brouillon", async () => {
    const t = await inscrire("facturer");
    const d = await devisAccepte(t, 100000);

    const { body } = await interpreter(t, "voix-test-facturer").expect(200);
    expect(body.operations).toHaveLength(1);
    // Le montant vient du devis, calculé par le serveur — le modèle n'a
    // prononcé aucun chiffre, et son schéma ne pourrait pas en porter.
    expect(body.operations[0].libelle).toContain((d.ttc / 100).toFixed(2));
    expect(body.operations[0].libelle).toContain("brouillon");

    await executer(t, body.planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT statut, number, amount_cents FROM factures WHERE devis_id = $1`, [d.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].statut).toBe("BROUILLON");
    // Sans numéro : l'émission reste un geste à part, jamais dicté.
    expect(rows[0].number).toBe("");
    expect(Number(rows[0].amount_cents)).toBe(d.ttc);
  });

  test("un devis DÉJÀ facturé n'est plus proposé — et on dit pourquoi", async () => {
    const t = await inscrire("facturer-deja");
    const d = await devisAccepte(t, 100000);
    await request(app).post(`/api/devis/${d.id}/facturer`).set("Cookie", t.cookie).expect(201);

    const { body } = await interpreter(t, "voix-test-facturer").expect(200);
    expect(body.operations).toHaveLength(0);
    expect(body.nonCompris.join(" ")).toContain("non encore facturés");

    // Et toujours UNE seule facture : le contexte l'a écarté, et l'index
    // unique l'aurait refusé de toute façon.
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM factures WHERE devis_id = $1`, [d.id],
    );
    expect(rows[0].n).toBe(1);
  });
});

// ── k. Lot 4 : la configuration, et le montant qui ne se dicte pas ──────────

describe("k — un montant que la voix ne porte pas est RÉCLAMÉ, jamais deviné", () => {
  test("catalogue : la désignation est dictée, le prix reste à saisir", async () => {
    const t = await inscrire("cat-voix");
    const { body } = await interpreter(t, "voix-test-catalogue").expect(200);

    expect(body.operations).toHaveLength(1);
    const op = body.operations[0];
    expect(op.champs.libelle).toBe("Pose de placo");
    expect(op.champs.unite).toBe("m2");
    // Le prix est vide, et l'écran doit le réclamer. Ni le modèle (règle 3)
    // ni le serveur (rien à calculer) n'ont le droit de le produire.
    expect(op.champs.prixUnitaireHtCents).toBeNull();
    expect(op.aCompleter).toEqual(["prixUnitaireHtCents"]);
    expect(op.libelle).toContain("prix à saisir");
  });

  test("valider SANS le prix ne crée rien — le refus est côté serveur", async () => {
    const t = await inscrire("cat-refus");
    const { body } = await interpreter(t, "voix-test-catalogue").expect(200);

    // Aucune correction : c'est le plan tel que la voix l'a produit. Le
    // bouton grisé de l'écran n'est qu'un confort ; un plan rejoué sans la
    // correction doit échouer, pas écrire un article à 0 €.
    await executer(t, body.planId).expect(422);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM catalogue_lignes WHERE tenant_id = $1`, [t.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  test("le prix saisi à l’écran écrit l’article, en CENTIMES", async () => {
    const t = await inscrire("cat-ok");
    const { body } = await interpreter(t, "voix-test-catalogue").expect(200);

    await executer(t, body.planId, { 0: { prixUnitaireHtCents: "4500" } }).expect(200);

    const { rows } = await adminPool.query(
      `SELECT libelle, unite, prix_unitaire_ht_cents FROM catalogue_lignes WHERE tenant_id = $1`,
      [t.tenantId],
    );
    expect(rows).toHaveLength(1);
    // 45 € s'écrit 4500. Accepter des euros ici diviserait tout par cent, en
    // silence, sur la seule source de prix des devis.
    expect(Number(rows[0].prix_unitaire_ht_cents)).toBe(4500);
    expect(rows[0].libelle).toBe("Pose de placo");
  });

  test.each([
    ["vide", ""],
    ["des espaces", "   "],
    ["des euros à virgule", "45,00"],
    ["un négatif", "-100"],
  ])("un prix %s est refusé, et rien n’est écrit", async (_nom, valeur) => {
    const t = await inscrire(`cat-mauvais-${_nom.replace(/[^a-z]/gi, "")}`);
    const { body } = await interpreter(t, "voix-test-catalogue").expect(200);

    await executer(t, body.planId, { 0: { prixUnitaireHtCents: valeur } }).expect(422);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM catalogue_lignes WHERE tenant_id = $1`, [t.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  test("charge récurrente : libellé et cadence dictés, montant réclamé", async () => {
    const t = await inscrire("charge-voix");
    const { body } = await interpreter(t, "voix-test-charge").expect(200);

    expect(body.operations[0].champs.cadence).toBe("mensuel");
    expect(body.operations[0].champs.categorie).toBe("ASSURANCE");
    expect(body.operations[0].aCompleter).toEqual(["montantCents"]);

    await executer(t, body.planId, { 0: { montantCents: "12000" } }).expect(200);

    const { rows } = await adminPool.query(
      `SELECT label, cadence, category, amount_cents FROM charges_recurrentes WHERE tenant_id = $1`,
      [t.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cadence).toBe("mensuel");
    expect(Number(rows[0].amount_cents)).toBe(12000);
  });

  test("contrat : le client dicté est rapproché d’une fiche existante", async () => {
    const t = await inscrire("contrat-voix");
    await request(app).post("/api/clients").set("Cookie", t.cookie)
      .send({ nom: "Menuiserie Delacroix" }).expect(201);

    const { body } = await interpreter(t, "voix-test-contrat").expect(200);
    // Le nom est écrit tel qu'il EXISTE, pas tel qu'il a été entendu : c'est
    // tout l'intérêt du rapprochement sur un champ de texte libre.
    expect(body.operations[0].champs.clientName).toBe("Menuiserie Delacroix");

    await executer(t, body.planId, { 0: { montantCents: "50000" } }).expect(200);

    const { rows } = await adminPool.query(
      `SELECT label, client_name, cadence, amount_cents FROM contrats WHERE tenant_id = $1`,
      [t.tenantId],
    );
    expect(rows[0].client_name).toBe("Menuiserie Delacroix");
    expect(Number(rows[0].amount_cents)).toBe(50000);
  });

  test("un client inconnu n’empêche pas le contrat — le nom dicté est gardé", async () => {
    const t = await inscrire("contrat-inconnu");
    const { body } = await interpreter(t, "voix-test-contrat").expect(200);
    // Refuser un contrat parce que la fiche client n'existe pas encore
    // imposerait un ordre de saisie que personne ne suit sur un chantier.
    expect(body.operations).toHaveLength(1);
    expect(body.operations[0].champs.clientName).toBe("Delacroix");
  });
});

// ── l. Le montant PRONONCÉ — la règle 3, resserrée sur ce qu'elle protège ───

describe("l — recopier un montant dit n'est pas le fixer", () => {
  test("« à 45 euros » remplit le prix, en centimes, et ne réclame plus rien", async () => {
    const t = await inscrire("cat-dicte");
    // La transcription porte réellement le nombre : c'est la condition.
    const { body } = await interpreter(t, "voix-test-cat-dicte à 45 euros du mètre").expect(200);

    const op = body.operations[0];
    expect(op.champs.prixUnitaireHtCents).toBe("4500");
    // Plus rien à saisir : le champ n'est plus réclamé.
    expect(op.aCompleter).toEqual([]);
    expect(op.libelle).toContain("45.00 €");

    // Et il s'applique sans correction — c'est tout l'intérêt.
    await executer(t, body.planId).expect(200);
    const { rows } = await adminPool.query(
      `SELECT prix_unitaire_ht_cents FROM catalogue_lignes WHERE tenant_id = $1`, [t.tenantId],
    );
    expect(Number(rows[0].prix_unitaire_ht_cents)).toBe(4500);
  });

  test("un montant que la phrase ne porte PAS est écarté, pas écrit", async () => {
    const t = await inscrire("cat-halluc");
    // Le modèle rend 999 € sur une phrase qui n'a jamais porté ce nombre.
    // Sans cette vérification, la relaxe de la règle 3 ouvrirait exactement le
    // trou qu'elle prétend ne pas ouvrir.
    const { body } = await interpreter(t, "voix-test-cat-halluc à 45 euros du mètre").expect(200);

    const op = body.operations[0];
    expect(op.champs.prixUnitaireHtCents).toBeNull();
    // Écarté, pas corrigé au jugé : on retombe sur le champ à saisir.
    expect(op.aCompleter).toEqual(["prixUnitaireHtCents"]);

    await executer(t, body.planId).expect(422);
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM catalogue_lignes WHERE tenant_id = $1`, [t.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });

  test("règlement : le montant dicté prime, le solde reste le repli", async () => {
    const t = await inscrire("regl-dicte");
    const f = await factureEmise(t, "FACT-2026-0181", "Delacroix", 120000);

    const { body } = await interpreter(t, "voix-test-reglement-dicte il m'a donné 500 euros").expect(200);
    const op = body.operations[0];
    // 500 € dictés sur une facture de 1 200 € : un règlement partiel, saisi
    // d'une phrase au lieu d'une correction à l'écran.
    expect(op.champs.montantCents).toBe("50000");
    expect(op.libelle).toContain("montant dicté");

    await executer(t, body.planId).expect(200);
    const { rows } = await adminPool.query(
      `SELECT montant_cents FROM paiements WHERE facture_id = $1`, [f],
    );
    expect(Number(rows[0].montant_cents)).toBe(50000);
  });

  test("sans montant dicté, le solde calculé par le serveur s’applique toujours", async () => {
    const t = await inscrire("regl-solde");
    await factureEmise(t, "FACT-2026-0181", "Delacroix", 120000);

    // Le chemin d'origine n'a pas bougé : c'est le repli, et il reste sûr.
    const { body } = await interpreter(t, "voix-test-reglement").expect(200);
    expect(body.operations[0].champs.montantCents).toBe("120000");
    expect(body.operations[0].libelle).toContain("solde restant");
  });
});

// ── m. Créer un devis / une facture depuis des lignes dictées ───────────────

describe("m — le devis dicté : le catalogue chiffre, jamais le modèle", () => {
  /** Une ligne de catalogue, par la vraie route. */
  async function catalogue(l: Locataire, libelle: string, prixCents: number): Promise<void> {
    await request(app).post("/api/catalogue").set("Cookie", l.cookie)
      .send({ libelle, unite: "m2", prixUnitaireHtCents: prixCents, tauxTva: 10 })
      .expect(201);
  }

  test("les lignes connues sont chiffrées, l’inconnue est annoncée", async () => {
    const t = await inscrire("devis-dicte");
    await catalogue(t, "Pose de placo", 8900);

    const { body } = await interpreter(t, "voix-test-devis").expect(200);
    const op = body.operations[0];

    // 90 × 89,00 € = 8 010,00 € — un calcul du SERVEUR, depuis le catalogue.
    expect(op.libelle).toContain("8010.00 €");
    expect(op.libelle).toContain("1 ligne(s) chiffrée(s)");
    // La ligne inconnue n'est pas passée sous silence : l'annoncer est ce qui
    // évite d'envoyer un devis moins cher que la réalité.
    expect(op.libelle).toContain("1 ligne(s) sans prix");
    // Et surtout : aucun prix n'a transité par le modèle.
    expect(JSON.stringify(op.champs)).not.toContain("8900");
  });

  test("valider crée un devis BROUILLON avec ses lignes", async () => {
    const t = await inscrire("devis-dicte-ok");
    await catalogue(t, "Pose de placo", 8900);

    const { body } = await interpreter(t, "voix-test-devis").expect(200);
    await executer(t, body.planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT reference, status, client_name, lines, total_ht_cents FROM devis WHERE tenant_id = $1`,
      [t.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("BROUILLON");
    expect(rows[0].reference).toMatch(/^DEV-\d{4}-\d{4}$/);
    expect(rows[0].lines).toHaveLength(2);
    expect(Number(rows[0].total_ht_cents)).toBe(90 * 8900);
    // La ligne inconnue entre à 0 : c'est un brouillon, il reste à finir, et
    // il ne part chez personne en l'état.
    expect(rows[0].lines[1].unitPriceCents).toBe(0);
  });

  test("un prix corrigé au catalogue APRÈS le plan est celui qui s’écrit", async () => {
    const t = await inscrire("devis-prix-bouge");
    await catalogue(t, "Pose de placo", 8900);

    const { body } = await interpreter(t, "voix-test-devis").expect(200);
    // Le tarif change entre la proposition et la validation — un plan attend
    // jusqu'à une heure. C'est le catalogue du moment qui fait foi.
    await adminPool.query(
      `UPDATE catalogue_lignes SET prix_unitaire_ht_cents = 9500 WHERE tenant_id = $1`, [t.tenantId],
    );

    await executer(t, body.planId).expect(200);
    const { rows } = await adminPool.query(
      `SELECT total_ht_cents FROM devis WHERE tenant_id = $1`, [t.tenantId],
    );
    expect(Number(rows[0].total_ht_cents)).toBe(90 * 9500);
  });

  test("une facture dictée reste un BROUILLON, sans numéro", async () => {
    const t = await inscrire("facture-dictee");
    await catalogue(t, "Pose de placo", 8900);

    const { body } = await interpreter(t, "voix-test-facture-lignes").expect(200);
    await executer(t, body.planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT statut, number, amount_cents FROM factures WHERE tenant_id = $1`, [t.tenantId],
    );
    expect(rows[0].statut).toBe("BROUILLON");
    // L'émission scelle un document immuable et consomme un numéro : elle ne
    // se dicte pas.
    expect(rows[0].number).toBe("");
    // 10 × 89 € HT + 10 % de TVA = 979,00 €
    expect(Number(rows[0].amount_cents)).toBe(97900);
  });
});
