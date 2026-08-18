/**
 * RLS test helpers.
 *
 * - adminPool  — connects with DATABASE_URL (postgres superuser).
 *                Superusers always bypass RLS, so insertions here
 *                are not filtered by tenant_isolation policies.
 * - signCookie — creates the signed `nodaq_sid` cookie value that
 *                matches what Express cookie-parser produces and
 *                verifies, so test requests can authenticate without
 *                going through the real register/login endpoints.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { genererSecretProvisoire, enregistrerSecretMfa } from "../lib/totp.js";
import { marquerSessionMfaVerifiee } from "../lib/authService.js";

// ── Admin pool (superuser — bypasses RLS for fixture setup/tear-down) ─────

export const adminPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// ── Cookie signing ────────────────────────────────────────────────────────
// Mirrors Express cookie-parser's signed-cookie format:
//   signed value  = sessionId + '.' + HMAC-SHA256(sessionId, secret).base64NoPad
//   cookie header = nodaq_sid=s%3A<url-encoded signed value>

export function signCookie(sessionId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be set in the test environment");
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(sessionId)
    .digest("base64")
    .replace(/=+$/, "");
  return `s%3A${encodeURIComponent(`${sessionId}.${hmac}`)}`;
}

/** Returns a Cookie header string for a given session UUID. */
export function cookieHeader(sessionId: string): string {
  return `nodaq_sid=${signCookie(sessionId)}`;
}

// ── Fixture creation helpers ──────────────────────────────────────────────

export interface TestTenant { id: string; nom: string }
export interface TestUser   { id: string; email: string; passwordHash: string }
export interface TestMember { id: string; name: string; tenantId: string }
export interface TestSession { id: string; userId: string; tenantId: string; expiresAt: Date }

export async function createTestTenant(nom = "Test Tenant"): Promise<TestTenant> {
  const { rows } = await adminPool.query<TestTenant>(
    "INSERT INTO tenants (id, nom) VALUES (gen_random_uuid(), $1) RETURNING id, nom",
    [nom + " " + Date.now()],
  );
  return rows[0]!;
}

export async function createTestUser(
  email: string,
  password = "testpassword1234",
): Promise<TestUser & { password: string }> {
  const passwordHash = await bcrypt.hash(password, 4); // low rounds for speed
  const { rows } = await adminPool.query<TestUser>(
    "INSERT INTO users (id, email, password_hash, nom) VALUES (gen_random_uuid(), $1, $2, $1) RETURNING id, email, password_hash",
    [email, passwordHash],
  );
  return { ...rows[0]!, password };
}

export async function createTestMembership(
  userId: string,
  tenantId: string,
  role: "OWNER" | "MEMBER" | "ACCOUNTANT" = "MEMBER",
): Promise<void> {
  await adminPool.query(
    "INSERT INTO memberships (id, user_id, tenant_id, role) VALUES (gen_random_uuid(), $1, $2, $3) ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = $3",
    [userId, tenantId, role],
  );
}

/**
 * `mfaVerified` (ticket 4.15) : `true` par défaut — la quasi-totalité des
 * tests de ce dépôt créent une session directement (sans passer par le vrai
 * flux /auth/login + /mfa/verify) en tenant pour acquis qu'elle est
 * pleinement authentifiée. Sans ce défaut, requireMfaVerified bloquerait
 * silencieusement toute session OWNER/ACCOUNTANT créée par tous les tests
 * existants qui ne testent PAS le MFA lui-même. Les tests dédiés au MFA
 * (mfa-auth.test.ts) passent `false` explicitement pour obtenir une session
 * réellement en attente.
 */
export async function createTestSession(
  userId: string,
  tenantId: string,
  expiresAt?: Date,
  mfaVerified = true,
): Promise<TestSession> {
  const exp = expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { rows } = await adminPool.query<TestSession>(
    `INSERT INTO sessions (id, user_id, tenant_id, expires_at, mfa_verified_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)
     RETURNING id, user_id AS "userId", tenant_id AS "tenantId", expires_at AS "expiresAt"`,
    [userId, tenantId, exp, mfaVerified ? new Date() : null],
  );
  return rows[0]!;
}

/**
 * MFA (ticket 4.15) — complète le MFA pour la session la plus récente d'un
 * utilisateur inscrit via un VRAI appel HTTP à `/api/auth/register`.
 *
 * `/auth/register` crée toujours un OWNER, un rôle financier : la session
 * qu'il renvoie est désormais bloquée par `requireMfaVerified` tant que le
 * second facteur n'est pas prouvé — exactement comme en production. Cette
 * fonction appelle les MÊMES fonctions que la vraie route `/mfa/verify`
 * (`enregistrerSecretMfa`, `marquerSessionMfaVerifiee`) : ce n'est pas un
 * raccourci qui contourne le garde, seulement le geste d'enrôlement
 * interactif qu'un test n'a pas besoin de rejouer par HTTP. Même doctrine
 * que `createTestSession` ci-dessus, qui pose déjà `mfa_verified_at`
 * directement plutôt que de rejouer /auth/login + /mfa/verify.
 *
 * À appeler juste après un `POST /api/auth/register` réussi, avec le
 * `userId` de la réponse — le cookie déjà obtenu reste valide, seule la
 * session qu'il désigne passe de « MFA en attente » à « MFA prouvé ».
 */
export async function completeMfaForRegisteredOwner(userId: string): Promise<void> {
  const { secret } = genererSecretProvisoire(`fixture-${userId}@nodaq.test`);
  await enregistrerSecretMfa(userId, secret);

  const { rows } = await adminPool.query<{ id: string }>(
    `SELECT id FROM sessions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT 1`,
    [userId],
  );
  const sessionId = rows[0]?.id;
  if (!sessionId) {
    throw new Error(
      `completeMfaForRegisteredOwner: aucune session trouvée pour l'utilisateur ${userId} — ` +
        `à appeler juste après un POST /api/auth/register réussi.`,
    );
  }
  await marquerSessionMfaVerifiee(sessionId);
}

export async function createTestTeamMember(
  tenantId: string,
  name = "Test Member",
): Promise<TestMember> {
  const { rows } = await adminPool.query<TestMember>(
    `INSERT INTO team_members (id, name, tenant_id)
     VALUES (gen_random_uuid()::text, $1, $2)
     RETURNING id, name, tenant_id AS "tenantId"`,
    [name, tenantId],
  );
  return rows[0]!;
}

// ── Cleanup ───────────────────────────────────────────────────────────────
// Cleans everything owned by the given test tenants.
// Order matters — FK constraints cascade from business tables → infra tables.

// Order matters — pointages has FKs to team_members and affaires, so it must be
// deleted before them.
const BUSINESS_TABLES = [
  "pointages", "catalogue_alias", "catalogue_lignes", "envois_journal", "parametres_envoi", "objectifs_franchissements",
  "tenant_secrets",
  // Ordre : les enfants avant les parents (client_id référence clients).
  "paiements", "affectations",
  // contact_bases référence contacts_prospection : les enfants d'abord.
  "contact_bases", "oppositions", "contacts_prospection",
  // team_member_habilitations référence team_members (membre_id) : avant lui.
  "team_member_habilitations",
  "absences", "activity", "affaires", "analytics_tool_logs", "archived_pdfs", "chat_messages",
  // classeur_document_bytes référence classeur_documents (document_id) : avant elle.
  "classeur_document_bytes", "classeur_documents",
  "connectors", "contrats", "cr_entries", "devis", "echeances",
  "avoirs", "facture_sequences",
  // incidents_facturation référence factures (facture_id) : avant elle.
  "incidents_facturation", "factures",
  "appels_relance", "campagnes_relance", "pending_actions", "journal_decisions", "regles_relance", "prospects", "settings", "team_members",
  "clients", "tenant_invites",
  "pa_documents_recus", "pa_transmissions",
  // bank_accounts référence bank_connections (connection_id) : avant elle.
  "bank_accounts", "bank_connections",
  "charges_recurrentes",
];

export async function cleanupTenants(...tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const ids = tenantIds;
  const params = ids.map((_, i) => `$${i + 1}`).join(", ");
  for (const table of BUSINESS_TABLES) {
    await adminPool.query(`DELETE FROM ${table} WHERE tenant_id::text = ANY(ARRAY[${params}])`, ids);
  }
  await adminPool.query(`DELETE FROM sessions   WHERE tenant_id::text = ANY(ARRAY[${params}])`, ids);
  await adminPool.query(`DELETE FROM memberships WHERE tenant_id::text = ANY(ARRAY[${params}])`, ids);
  await adminPool.query(`DELETE FROM tenants     WHERE id::text = ANY(ARRAY[${params}])`, ids);
}

export async function cleanupUsers(...emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  const params = emails.map((_, i) => `$${i + 1}`).join(", ");
  await adminPool.query(`DELETE FROM users WHERE email = ANY(ARRAY[${params}])`, emails);
}

// ── Minimal SQL inserts for all 15 business tables ────────────────────────
// Returns a SQL string and parameters to insert one test row for a given tenantId.
// All values are intentionally minimal — only NOT-NULL-without-default columns are set.

export function tableInsertSql(table: string, tenantId: string, memberAId?: string): [string, unknown[]] {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const map: Record<string, [string, unknown[]]> = {
    activity:             [`INSERT INTO activity (id, label, type, tenant_id) VALUES ($1, 'rls-test', 'NOTE', $2)`, [id, tenantId]],
    affaires:             [`INSERT INTO affaires (id, label, tenant_id) VALUES ($1, 'rls-test', $2)`, [id, tenantId]],
    analytics_tool_logs:  [`INSERT INTO analytics_tool_logs (tenant_id, indicateur_id, status) VALUES ($1, 'ca_facture', 'ok')`, [tenantId]],
    chat_messages:      [`INSERT INTO chat_messages (id, content, conversation_id, role, tenant_id) VALUES ($1, 'rls-test', 'conv-rls', 'user', $2)`, [id, tenantId]],
    classeur_documents: [`INSERT INTO classeur_documents (id, name, tenant_id) VALUES ($1, 'rls-test', $2)`, [id, tenantId]],
    // classeur_document_bytes : document_id référence classeur_documents(id).
    // Le fixture crée SA PROPRE ligne classeur_documents plutôt que d'en
    // chercher une — même patron que catalogue_alias.
    classeur_document_bytes: [`WITH d AS (
        INSERT INTO classeur_documents (id, tenant_id, name)
        VALUES ('cd-' || $1, $2::uuid, 'rls-test-doc')
        ON CONFLICT DO NOTHING RETURNING id
      )
      INSERT INTO classeur_document_bytes (id, tenant_id, document_id, bytes, sha256, byte_size)
      SELECT $1, $2::uuid, d.id, $3, 'rls-test-sha256-placeholder', 8 FROM d
      ON CONFLICT DO NOTHING`, [id, tenantId, Buffer.from("rls-test")]],
    connectors:         [`INSERT INTO connectors (id, label, type, tenant_id) VALUES ($1, 'rls-test', 'STRIPE_TEST', $2)`, [id, tenantId]],
    contrats:           [`INSERT INTO contrats (id, label, tenant_id) VALUES ($1, 'rls-test', $2)`, [id, tenantId]],
    // cr_entries: id is a TEXT PK generated by the app (Drizzle $defaultFn) — must be supplied in raw SQL
    cr_entries:         [`INSERT INTO cr_entries (id, line_code, period_key, tenant_id) VALUES ($1, 'RLS_TEST', '2020-01-01:2020-12-31', $2) ON CONFLICT DO NOTHING`, [id, tenantId]],
    devis:              [`INSERT INTO devis (id, client_name, reference, tenant_id) VALUES ($1, 'RLS Client', 'RLS-001', $2)`, [id, tenantId]],
    echeances:          [`INSERT INTO echeances (id, label, type, due_date, tenant_id) VALUES ($1, 'rls-test', 'LOYER', $2, $3)`, [id, now, tenantId]],
    factures:           [`INSERT INTO factures (id, number, customer_name, amount_cents, due_date, issued_date, tenant_id) VALUES ($1, 'RLS-F-001', 'RLS Client', 1000, $2, $2, $3)`, [id, now, tenantId]],
    pending_actions:    [`INSERT INTO pending_actions (id, label, type, tenant_id) VALUES ($1, 'rls-test', 'SIGNATURE', $2)`, [id, tenantId]],
    // journal_decisions est APPEND-ONLY : le nettoyage par DELETE de
    // `cleanupTenants` tourne sous adminPool (superutilisateur), qui n'est pas
    // concerné par le REVOKE posé sur app_user.
    journal_decisions:  [`INSERT INTO journal_decisions (id, tenant_id, action_id, action_type, action_label, decision) VALUES ($1, $2, 'act-rls-test', 'PLAN_VOCAL', 'rls-test', 'APPROUVEE')`, [id, tenantId]],
    // regles_relance est APPEND-ONLY comme journal_decisions : même remarque
    // sur le nettoyage, qui tourne sous adminPool.
    regles_relance:     [`INSERT INTO regles_relance (id, tenant_id, version) VALUES ($1, $2, 1)`, [id, tenantId]],
    campagnes_relance:  [`INSERT INTO campagnes_relance (id, tenant_id, pending_action_id, mandat) VALUES ($1, $2, 'pa-rls-test', '{}'::jsonb)`, [id, tenantId]],
    // appels_relance référence campagnes_relance : la fixture crée sa propre
    // campagne dans la même instruction, sinon elle n'insérerait rien pour un
    // tenant qui n'en a pas — et l'isolation « verrait » zéro ligne des deux
    // côtés, donc passerait sans rien prouver.
    appels_relance:     [`WITH c AS (
                            INSERT INTO campagnes_relance (id, tenant_id, pending_action_id, mandat)
                            VALUES (gen_random_uuid()::text, $2, 'pa-rls-appel', '{}'::jsonb)
                            RETURNING id
                          )
                          INSERT INTO appels_relance (id, tenant_id, campagne_id, empreinte_numero)
                          SELECT $1, $2, c.id, 'rls-empreinte' FROM c`, [id, tenantId]],
    prospects:          [`INSERT INTO prospects (id, name, tenant_id) VALUES ($1, 'RLS Prospect', $2)`, [id, tenantId]],
    settings:           [`INSERT INTO settings (key, value, tenant_id) VALUES ('rls_test_key', 'v', $1) ON CONFLICT DO NOTHING`, [tenantId]],
    team_members:       [`INSERT INTO team_members (id, name, tenant_id) VALUES ($1, 'RLS Member', $2)`, [id, tenantId]],
    absences:           memberAId
      ? [`INSERT INTO absences (id, membre_id, date_debut, date_fin, tenant_id) VALUES ($1, $2, $3, $3, $4) ON CONFLICT DO NOTHING`, [id, memberAId, now, tenantId]]
      : [`SELECT 1`, []], // skip if no member provided
    team_member_habilitations: memberAId
      ? [`INSERT INTO team_member_habilitations (id, membre_id, type, libelle, tenant_id) VALUES ($1, $2, 'rls_test', 'RLS Habilitation', $3) ON CONFLICT DO NOTHING`, [id, memberAId, tenantId]]
      : [`SELECT 1`, []], // skip if no member provided
    // archived_pdfs: id is TEXT PK, bytes is BYTEA — both must be supplied explicitly.
    archived_pdfs:    [`INSERT INTO archived_pdfs (id, tenant_id, document_type, document_id, bytes, sha256, byte_size) VALUES ($1, $2::uuid, 'FACTURE', $3, $4, $5, $6) ON CONFLICT DO NOTHING`, [id, tenantId, crypto.randomUUID(), Buffer.from("rls-test-pdf"), "rls-test-sha256-placeholder", 12]],
    // avoirs: id is a TEXT PK with no default — must be supplied in raw SQL.
    // facture_ref_id carries no FK, so an arbitrary id is fine here.
    // tenant_secrets : PK composite (tenant_id, cle), pas d'id. La valeur est
    // un chiffré factice — cette insertion éprouve la RLS, pas le chiffrement.
    // catalogue_alias : clé étrangère vers catalogue_lignes. Le fixture crée
    // SA PROPRE ligne plutôt que d'en chercher une — la liste est ordonnée
    // pour la SUPPRESSION (enfants d'abord), donc l'alias est inséré avant le
    // catalogue et n'aurait rien à référencer.
    catalogue_alias:  [`WITH l AS (
        INSERT INTO catalogue_lignes (id, tenant_id, libelle, prix_unitaire_ht_cents)
        VALUES ('cl-' || $1, $2::uuid, 'RLS Catalogue', 1000)
        ON CONFLICT DO NOTHING RETURNING id
      )
      INSERT INTO catalogue_alias (id, tenant_id, alias_normalise, libelle_dicte, catalogue_ligne_id)
      SELECT $1, $2::uuid, 'rls-alias-' || $1, 'rls', l.id FROM l
      ON CONFLICT DO NOTHING`, [id, tenantId]],
    contacts_prospection: [`INSERT INTO contacts_prospection (id, tenant_id, nom, type) VALUES ($1, $2::uuid, 'RLS Contact', 'PRO') ON CONFLICT DO NOTHING`, [id, tenantId]],
    // contact_bases : append-only, exige un contact existant.
    contact_bases:    [`INSERT INTO contact_bases (id, tenant_id, contact_id, contact_type, base, source, obtenue_le) SELECT $1, $2::uuid, c.id, 'PRO', 'INTERET_LEGITIME_PRO', 'rls-test', CURRENT_DATE FROM contacts_prospection c WHERE c.tenant_id = $2::uuid LIMIT 1 ON CONFLICT DO NOTHING`, [id, tenantId]],
    oppositions:      [`INSERT INTO oppositions (id, tenant_id, empreinte, nature) VALUES ($1, $2::uuid, 'rls-empreinte-' || $1, 'email') ON CONFLICT DO NOTHING`, [id, tenantId]],
    clients:          [`INSERT INTO clients (id, tenant_id, nom) VALUES ($1, $2::uuid, 'RLS Client') ON CONFLICT DO NOTHING`, [id, tenantId]],
    // paiements : append-only, montant > 0, date métier.
    paiements:        [`INSERT INTO paiements (id, tenant_id, date, montant_cents) VALUES ($1, $2::uuid, CURRENT_DATE, 1000) ON CONFLICT DO NOTHING`, [id, tenantId]],
    affectations:     [`INSERT INTO affectations (id, tenant_id, affaire_id, membre_id, date_debut, date_fin, heures_par_jour) VALUES ($1, $2::uuid, $3, $3, CURRENT_DATE, CURRENT_DATE, 7) ON CONFLICT DO NOTHING`, [id, tenantId, crypto.randomUUID()]],
    tenant_secrets:   [`INSERT INTO tenant_secrets (tenant_id, cle, valeur_chiffree) VALUES ($2::uuid, 'rls.test.' || $1, 'v1:1:aaaa:bbbb:cccc') ON CONFLICT DO NOTHING`, [id, tenantId]],
    avoirs:           [`INSERT INTO avoirs (id, tenant_id, numero, facture_ref_id, issued_date, montant_ht_cents, motif) VALUES ($1, $2::uuid, 'RLS-AV-001', $3, CURRENT_DATE, 1000, 'rls-test') ON CONFLICT DO NOTHING`, [id, tenantId, crypto.randomUUID()]],
    // incidents_facturation : facture_id référence factures(id) — une vraie
    // facture est créée par le même CTE, plutôt que d'inventer un id qui
    // violerait la FK. Numéro distinct de celui de l'entrée `factures`
    // ci-dessus pour ne pas se heurter à l'index unique partiel de 024.
    incidents_facturation: [`WITH f AS (
        INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents, due_date, issued_date)
        VALUES ($3, $2::uuid, 'RLS-INC-' || $1, 'RLS Client', 1000, CURRENT_DATE, CURRENT_DATE)
        ON CONFLICT DO NOTHING RETURNING id
      )
      INSERT INTO incidents_facturation (id, tenant_id, type, facture_id, charge_utile)
      SELECT $1, $2::uuid, 'AVOIR_COMPENSATION_ECHOUEE', f.id, '{}'::jsonb FROM f
      ON CONFLICT DO NOTHING`, [id, tenantId, crypto.randomUUID()]],
    // facture_sequences: composite PK (tenant_id, year) — NO id column.
    // One row per tenant per year, so both test tenants can hold year 2020.
    facture_sequences: [`INSERT INTO facture_sequences (tenant_id, year) VALUES ($1::uuid, 2020) ON CONFLICT DO NOTHING`, [tenantId]],
    // objectifs_franchissements : append-only, unicité (tenant, objectif, exercice).
    objectifs_franchissements: [`INSERT INTO objectifs_franchissements (id, tenant_id, objectif, exercice, montant_cents) VALUES ($1, $2::uuid, 'seuil_rentabilite', 2020, 1000) ON CONFLICT DO NOTHING`, [id, tenantId]],
    // parametres_envoi : un seul par tenant (contrainte d'unicité).
    parametres_envoi: [`INSERT INTO parametres_envoi (id, tenant_id, mode, domaine) VALUES ($1, $2::uuid, 'repli_nodaq', 'rls-test.example') ON CONFLICT DO NOTHING`, [id, tenantId]],
    // envois_journal : append-only, aucune donnée de contenu.
    envois_journal: [`INSERT INTO envois_journal (id, tenant_id, destinataire, document_type, mode, statut) VALUES ($1, $2::uuid, 'rls-test@example.test', 'DEVIS', 'repli_nodaq', 'envoye') ON CONFLICT DO NOTHING`, [id, tenantId]],
    // pa_documents_recus: id is TEXT PK, bytes is BYTEA — both supplied explicitly.
    pa_documents_recus: [`INSERT INTO pa_documents_recus (id, tenant_id, bytes, sha256, byte_size, source) VALUES ($1, $2::uuid, $3, 'rls-test-sha256-placeholder', 8, 'manuel') ON CONFLICT DO NOTHING`, [id, tenantId, Buffer.from("rls-test")]],
    pa_transmissions: [`INSERT INTO pa_transmissions (id, tenant_id, document_type, document_id, statut) VALUES ($1, $2::uuid, 'FACTURE', $3, 'prete') ON CONFLICT DO NOTHING`, [id, tenantId, crypto.randomUUID()]],
    bank_connections: [`INSERT INTO bank_connections (id, tenant_id, bridge_user_uuid) VALUES ($1, $2::uuid, 'rls-test-bridge-uuid') ON CONFLICT DO NOTHING`, [id, tenantId]],
    // bank_accounts : connection_id référence bank_connections, qui porte
    // UNIQUE(tenant_id) — un seul au plus par tenant. Contrairement au
    // patron catalogue_alias (clé étrangère sans contrainte d'unicité sur
    // le parent), un DO NOTHING simple laisserait ce CTE vide — donc zéro
    // ligne bank_accounts insérée — si la fixture bank_connections a déjà
    // créé la ligne pour ce même tenant plus tôt dans la boucle
    // d'isolation. DO UPDATE (no-op sur updated_at) garantit que la CTE
    // renvoie toujours un id, que la ligne soit neuve ou déjà là.
    bank_accounts: [`WITH c AS (
        INSERT INTO bank_connections (id, tenant_id, bridge_user_uuid)
        VALUES ('bc-' || $1, $2::uuid, 'rls-test-bridge-uuid')
        ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW() RETURNING id
      )
      INSERT INTO bank_accounts (id, tenant_id, connection_id, label, balance_cents)
      SELECT $1, $2::uuid, c.id, 'RLS Compte', 1000 FROM c
      ON CONFLICT DO NOTHING`, [id, tenantId]],
    charges_recurrentes: [`INSERT INTO charges_recurrentes (id, tenant_id, label, category, cadence, start_date, amount_cents) VALUES ($1, $2::uuid, 'rls-test', 'AUTRE', 'mensuel', $3, 10000)`, [id, tenantId, now]],
    // tenant_invites : invited_by référence users(id), pas team_members(id)
    // (memberAId porte le mauvais id). Les tenants de ce fixture RLS n'ont
    // pas forcément de membership existant (tenantA/tenantB, notamment) : la
    // ligne crée SON PROPRE user jetable plutôt que d'en chercher un — même
    // patron que catalogue_alias plus haut, qui crée sa propre ligne
    // catalogue_lignes.
    tenant_invites: [`WITH u AS (
        INSERT INTO users (id, email, password_hash, nom)
        VALUES (gen_random_uuid(), 'rls-invite-' || $1 || '@test.nodaq', 'x', 'RLS Inviter')
        RETURNING id
      )
      INSERT INTO tenant_invites (id, tenant_id, email, role, token_sha256, invited_by, expires_at)
      SELECT $1, $2::uuid, 'rls-test@example.test', 'MEMBER', 'rls-test-hash-' || $1, u.id, now() + interval '7 days' FROM u
      ON CONFLICT DO NOTHING`, [id, tenantId]],
    // catalogue_lignes: prix en centimes, mots_cles est un text[].
    catalogue_lignes: [`INSERT INTO catalogue_lignes (id, tenant_id, libelle, unite, prix_unitaire_ht_cents, mots_cles) VALUES ($1, $2::uuid, 'Cloison BA13 rls-test', 'm2', 4500, ARRAY['placo','ba13']) ON CONFLICT DO NOTHING`, [id, tenantId]],
    // pointages: needs BOTH a member and an affaire (real FKs). The affaire is
    // created in the same statement via a CTE, so the helper keeps its
    // (table, tenantId, memberAId) signature.
    pointages: memberAId
      ? [
          `WITH nouvelle_affaire AS (
             INSERT INTO affaires (id, label, tenant_id) VALUES ($1, 'rls-test-pointage', $2::uuid)
             RETURNING id
           )
           INSERT INTO pointages (id, tenant_id, membre_id, affaire_id, date, heures)
           SELECT $3, $2::uuid, $4, nouvelle_affaire.id, DATE '2020-01-06', 7.00
           FROM nouvelle_affaire
           ON CONFLICT DO NOTHING`,
          [crypto.randomUUID(), tenantId, id, memberAId],
        ]
      : [`SELECT 1`, []], // skip if no member provided
  };

  return map[table] ?? [`SELECT 1`, []];
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
 *
 * Extrait ici (ex-copies indépendantes dans `pdf-devis.test.ts` et
 * `vendeur-cle-onboarding.test.ts`) — un seul décodeur pour tout appelant qui
 * doit vérifier ce qu'un PDF émis affiche RÉELLEMENT, pas ce que le buffer
 * brut contient (toujours compressé, une recherche naïve ne prouve rien).
 */
export function texteBrut(pdf: Buffer): string {
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
    // Après « endstream », et pas `fin + 1` : le mot « endstream » CONTIENT
    // « stream ». Reprendre la recherche un octet après son début la faisait
    // re-tomber dedans, puis encadrer le flux suivant à partir d'un mauvais
    // décalage — l'inflate échouait, le `catch` l'avalait, et seul le PREMIER
    // flux du document était réellement lu. Un PDF de deux pages ne rendait
    // donc que la première, en silence : une assertion `not.toContain` sur la
    // page 2 passait sans rien vérifier.
    i = fin + "endstream".length;
  }

  const decodeHex = (hex: string): string => {
    const propre = hex.replace(/\s+/g, "");
    if (propre.length === 0 || propre.length % 2 !== 0) return "";
    return Buffer.from(propre, "hex").toString("latin1");
  };

  return flux
    .join("\n")
    .replace(/\[([^\]]*)\]\s*TJ/g, (_tout, contenu: string) =>
      [...contenu.matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((m) => decodeHex(m[1]!)).join(""),
    );
}

