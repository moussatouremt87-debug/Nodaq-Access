/**
 * Membres & accès — qui peut se connecter à ce tenant, et avec quel rôle.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  PLUSIEURS OWNER À ÉGALITÉ SONT POSSIBLES (US-A5.1) — MAIS UNIQUEMENT    ║
 * ║  PAR INVITATION D'UN OWNER EXISTANT. LA PROMOTION D'UN MEMBRE DÉJÀ       ║
 * ║  PRÉSENT EN OWNER RESTE REFUSÉE (PATCH .../role). LE DERNIER OWNER       ║
 * ║  D'UN TENANT RESTE PROTÉGÉ (DELETE compte les OWNER restants).           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Avant 038 (US-A5.1), aucune invitation ne pouvait donner OWNER — décision
 * délibérée, encore documentée dans l'historique de 027_tenant_invites.sql.
 * Le cas qui a fait revenir dessus : une société d'exercice libéral à
 * plusieurs associés, où chacun doit porter la même autorité, sans
 * hiérarchie implicite entre eux. `/membres/inviter` reste réservée aux
 * OWNER (`ownerOnly`, voir routes/index.ts) : seul quelqu'un qui a déjà
 * l'autorité totale peut l'accorder à quelqu'un d'autre — inviter en OWNER
 * n'ouvre donc aucune élévation de privilège qu'un OWNER n'avait pas déjà.
 *
 * Distinct de `equipe.ts`/`teamMembersTable` : ceci concerne des COMPTES DE
 * CONNEXION (memberships), pas la planification/pointages du personnel de
 * chantier. Les deux tables ne se recouvrent pas.
 *
 * Deux routes de ce fichier (`GET /membres/inviter/:token` et sa suite
 * `/accepter`) sont PUBLIQUES, montées séparément dans `routes/index.ts` —
 * la personne invitée n'a par définition aucune session au moment où elle
 * clique le lien. Elles suivent le même patron que `public.ts` : jeton
 * condensé (SHA-256), policy RLS étroite pour la recherche, réponse
 * indifférenciée pour un jeton introuvable, limitation de débit.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  withTenant,
  tenantInvitesTable,
  membershipsTable,
  usersTable,
  tenantsTable,
} from "@workspace/db";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { findUserByEmail, createSession, touchLastLogin } from "../lib/authService.js";
import { sendDocument } from "../lib/canal-emission.js";
import { COOKIE_NAME, COOKIE_OPTS } from "./auth.js";
import {
  InviterMembreBody,
  ChangerRoleMembreParams,
  ChangerRoleMembreBody,
  RevoquerMembreParams,
  ApercuInvitationParams,
  AccepterInvitationParams,
  AccepterInvitationBody,
  ProgrammerEcheanceMembreBody,
} from "@workspace/api-zod";

const router: IRouter = Router();
export const membresPublicRouter: IRouter = Router();

// ── Membres (OWNER seulement) ───────────────────────────────────────────────

router.get("/membres", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  // memberships/users sont des tables INFRA sans RLS (un user peut porter
  // plusieurs memberships, dans plusieurs tenants) — interrogées directement,
  // filtrées à la main, jamais via withTenant. Même doctrine que
  // authService.ts.
  const membres = await db
    .select({
      id: membershipsTable.id,
      email: usersTable.email,
      nom: usersTable.nom,
      role: membershipsTable.role,
      libelle: membershipsTable.libelle,
      // US-A5.4 — l'écran doit pouvoir montrer l'échéance d'un tiers de
      // confiance, et signaler un accès déjà expiré.
      expiresAt: membershipsTable.expiresAt,
      createdAt: membershipsTable.createdAt,
    })
    .from(membershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, membershipsTable.userId))
    .where(eq(membershipsTable.tenantId, tenantId));

  // tenant_invites, elle, EST une table métier — RLS oblige withTenant.
  const invitationsEnAttente = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: tenantInvitesTable.id,
        email: tenantInvitesTable.email,
        role: tenantInvitesTable.role,
        libelle: tenantInvitesTable.libelle,
        expiresAt: tenantInvitesTable.expiresAt,
        accesExpireAt: tenantInvitesTable.accesExpireAt,
        createdAt: tenantInvitesTable.createdAt,
      })
      .from(tenantInvitesTable)
      .where(and(eq(tenantInvitesTable.tenantId, tenantId), isNull(tenantInvitesTable.acceptedAt))),
  );

  res.json({ membres, invitationsEnAttente });
});

router.post("/membres/inviter", async (req, res): Promise<void> => {
  const parsed = InviterMembreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;
  const email = parsed.data.email.toLowerCase().trim();
  // "MEMBER" | "ACCOUNTANT" | "OWNER" (US-A5.1) | "VIEWER" (US-A5.4) —
  // cette route est déjà ownerOnly (routes/index.ts) : seul un OWNER peut
  // accorder OWNER, et seul un OWNER peut ouvrir ses comptes à un tiers.
  const role = parsed.data.role;
  const libelle = parsed.data.libelle?.trim() || null;

  // Échéance d'accès : OBLIGATOIRE pour un tiers de confiance (US-A5.4 — un
  // accès ouvert à quelqu'un d'extérieur ne doit pas pouvoir rester ouvert par
  // oubli), FACULTATIVE pour les autres depuis US-A7.3.
  //
  // A5.4 la refusait hors VIEWER, et son commentaire disait pourquoi : « rien
  // dans le produit ne la propose ni ne la montre ». A7.3 est la story qui la
  // propose et la montre — la condition du refus a disparu, pas la prudence
  // qui l'avait motivé. Une fin de contrat saisonnier se connaît d'avance ;
  // la programmer vaut mieux qu'un geste manuel qu'on oublie.
  let accesExpireAt: Date | null = null;
  if (parsed.data.accesExpireAt) {
    accesExpireAt = new Date(parsed.data.accesExpireAt);
    if (Number.isNaN(accesExpireAt.getTime()) || accesExpireAt.getTime() <= Date.now()) {
      res.status(400).json({ error: "La date de fin d'accès doit être dans le futur." });
      return;
    }
  } else if (role === "VIEWER") {
    res.status(400).json({
      error: "Un accès en lecture seule doit porter une date de fin.",
    });
    return;
  }

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    const [dejaMembre] = await db
      .select({ id: membershipsTable.id })
      .from(membershipsTable)
      .where(and(eq(membershipsTable.userId, existingUser.id), eq(membershipsTable.tenantId, tenantId)));
    if (dejaMembre) {
      res.status(409).json({ error: "Cette personne est déjà membre de cet espace." });
      return;
    }
  }

  const token = randomBytes(32).toString("hex");
  const tokenSha256 = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [invite] = await withTenant(tenantId, (tx) =>
    tx
      .insert(tenantInvitesTable)
      .values({ tenantId, email, role, libelle, accesExpireAt, tokenSha256, invitedBy: req.session!.userId, expiresAt })
      .returning(),
  );

  const [tenant] = await db.select({ nom: tenantsTable.nom }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const tenantNom = tenant?.nom ?? "votre entreprise";
  const lien = `${process.env["PUBLIC_URL"] ?? "https://nodaq.fr"}/membres/accepter/${token}`;
  const roleLabel = role === "OWNER" ? "copropriétaire, à égalité de droits"
    : role === "ACCOUNTANT" ? "comptable"
    : role === "VIEWER" ? "en lecture seule, limité au dossier financier"
    : "membre";

  const corps = [
    `Bonjour,`,
    ``,
    `${req.session?.nom ?? "Un collègue"} vous invite à rejoindre l'espace « ${tenantNom} » sur NODAQ, avec un accès ${roleLabel}.`,
    ``,
    `Pour accepter l'invitation : ${lien}`,
    ``,
    `Ce lien expire dans 7 jours.`,
    // Deux horloges distinctes, donc deux phrases : la validité du lien, et
    // la durée de l'accès une fois accepté. Les confondre ferait croire au
    // tiers que son accès dure sept jours.
    ...(accesExpireAt
      ? [``, `L'accès qui vous est ouvert prend fin le ${accesExpireAt.toLocaleDateString("fr-FR")}.`]
      : []),
  ].join("\n");

  const envoi = await sendDocument({
    canal: "EMAIL",
    tenantId,
    to: email,
    subject: `Invitation à rejoindre ${tenantNom} sur NODAQ`,
    body: corps,
    documentType: "INVITATION",
    documentId: invite!.id,
  });

  res.status(201).json({
    id: invite!.id,
    email: invite!.email,
    role: invite!.role,
    libelle: invite!.libelle,
    accesExpireAt: invite!.accesExpireAt,
    expiresAt: invite!.expiresAt,
    createdAt: invite!.createdAt,
    envoye: envoi.success,
  });
});

router.patch("/membres/:id/role", async (req, res): Promise<void> => {
  const params = ChangerRoleMembreParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = ChangerRoleMembreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  const [cible] = await db
    .select()
    .from(membershipsTable)
    .where(and(eq(membershipsTable.id, params.data.id), eq(membershipsTable.tenantId, tenantId)));
  if (!cible) { res.status(404).json({ error: "Membre introuvable" }); return; }

  // US-A5.1 — garde à deux branches, plus le blocage inconditionnel
  // d'origine : un OWNER peut désormais exister au pluriel (par invitation,
  // voir /membres/inviter), mais SEULE cette voie en crée un. Promotion
  // (MEMBER/ACCOUNTANT → OWNER) et démotion (OWNER → autre chose) restent
  // toutes deux refusées ici ; seul un passage OWNER→OWNER (donc ne
  // touchant que `libelle`) est permis.
  if (parsed.data.role === "OWNER" && cible.role !== "OWNER") {
    res.status(403).json({ error: "La promotion au rôle propriétaire ne passe pas par cet écran — invitez un copropriétaire directement." });
    return;
  }
  if (cible.role === "OWNER" && parsed.data.role !== "OWNER") {
    res.status(403).json({ error: "Le rôle du propriétaire ne se change pas depuis cet écran." });
    return;
  }

  // US-A5.4 — même doctrine que pour OWNER, et pour une raison précise : un
  // accès en lecture seule ne vaut QUE porté par une échéance
  // (`memberships.expires_at`), et cet écran n'en demande aucune. Y basculer
  // un membre créerait un accès tiers permanent, exactement ce que la story
  // cherche à empêcher. L'invitation reste l'unique voie — elle, exige la
  // date. Le chemin inverse est refusé aussi : rendre l'écriture à un tiers
  // externe doit être un geste délibéré, pas un changement de liste
  // déroulante.
  if (parsed.data.role === "VIEWER" && cible.role !== "VIEWER") {
    res.status(403).json({ error: "Un accès en lecture seule s'accorde par invitation, avec une date de fin." });
    return;
  }
  if (cible.role === "VIEWER" && parsed.data.role !== "VIEWER") {
    res.status(403).json({ error: "Un accès en lecture seule ne se transforme pas en accès complet depuis cet écran." });
    return;
  }

  const updateData: { role: string; libelle?: string | null } = { role: parsed.data.role };
  if (parsed.data.libelle !== undefined) updateData.libelle = parsed.data.libelle?.trim() || null;

  const [updated] = await db
    .update(membershipsTable)
    .set(updateData)
    .where(eq(membershipsTable.id, params.data.id))
    .returning();
  const [user] = await db
    .select({ email: usersTable.email, nom: usersTable.nom })
    .from(usersTable)
    .where(eq(usersTable.id, updated!.userId));

  res.json({
    id: updated!.id,
    email: user?.email ?? "",
    nom: user?.nom ?? "",
    role: updated!.role,
    libelle: updated!.libelle,
    expiresAt: updated!.expiresAt,
    createdAt: updated!.createdAt,
  });
});

/**
 * US-A7.3 — programmer (ou retirer) la fin d'accès d'un membre.
 *
 * Distincte de `DELETE /membres/:id`, qui révoque SUR-LE-CHAMP. Ici la date est
 * connue à l'avance — une fin de contrat saisonnier — et s'applique toute
 * seule le moment venu : `requireMembership` relit l'adhésion à chaque requête
 * et refuse dès l'échéance passée (US-A5.4). Aucun travail périodique, aucun
 * geste manuel le jour J, donc aucun oubli possible.
 *
 * Route SÉPARÉE de `PATCH /membres/:id/role` volontairement : celle-là porte
 * les gardes des transitions de rôle, celle-ci porte les règles de la
 * planification. Les mêler rendrait les deux plus difficiles à relire.
 */
router.patch("/membres/:id/echeance", async (req, res): Promise<void> => {
  const params = ChangerRoleMembreParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = ProgrammerEcheanceMembreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  const [cible] = await db
    .select()
    .from(membershipsTable)
    .where(and(eq(membershipsTable.id, params.data.id), eq(membershipsTable.tenantId, tenantId)));
  if (!cible) { res.status(404).json({ error: "Membre introuvable" }); return; }

  let echeance: Date | null = null;
  if (parsed.data.expiresAt) {
    echeance = new Date(parsed.data.expiresAt);
    if (Number.isNaN(echeance.getTime()) || echeance.getTime() <= Date.now()) {
      res.status(400).json({ error: "La date de fin d'accès doit être dans le futur." });
      return;
    }
  }

  // Un tiers de confiance porte TOUJOURS une fin d'accès (US-A5.4). Lui retirer
  // son échéance fabriquerait l'accès externe permanent que cette story-là
  // existait pour empêcher.
  if (!echeance && cible.role === "VIEWER") {
    res.status(403).json({
      error: "Un accès en lecture seule doit garder une date de fin. Révoquez-le si vous voulez le fermer.",
    });
    return;
  }

  // ── La garde qui n'est écrite dans aucun critère d'acceptation ───────────
  // `DELETE` refuse de révoquer le dernier propriétaire. Une révocation
  // PROGRAMMÉE est une révocation différée : sans le même comptage ici, elle
  // deviendrait la porte dérobée qui contourne l'autre — le tenant se
  // retrouverait un jour sans aucun accès propriétaire, à une date que plus
  // personne ne surveille.
  if (echeance && cible.role === "OWNER") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(membershipsTable)
      .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.role, "OWNER")));
    if (count <= 1) {
      res.status(403).json({
        error: "Le dernier propriétaire de cet espace ne peut pas voir son accès programmé pour se fermer.",
      });
      return;
    }
  }

  const [updated] = await db
    .update(membershipsTable)
    .set({ expiresAt: echeance })
    .where(eq(membershipsTable.id, params.data.id))
    .returning();
  const [user] = await db
    .select({ email: usersTable.email, nom: usersTable.nom })
    .from(usersTable)
    .where(eq(usersTable.id, updated!.userId));

  res.json({
    id: updated!.id,
    email: user?.email ?? "",
    nom: user?.nom ?? "",
    role: updated!.role,
    libelle: updated!.libelle,
    expiresAt: updated!.expiresAt,
    createdAt: updated!.createdAt,
  });
});

router.delete("/membres/:id", async (req, res): Promise<void> => {
  const params = RevoquerMembreParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = req.tenantId!;

  const [cible] = await db
    .select()
    .from(membershipsTable)
    .where(and(eq(membershipsTable.id, params.data.id), eq(membershipsTable.tenantId, tenantId)));
  if (!cible) { res.status(404).json({ error: "Membre introuvable" }); return; }

  // US-A5.1 — le blocage inconditionnel devient un comptage : plusieurs
  // OWNER peuvent coexister à égalité (voir /membres/inviter), seul LE
  // DERNIER reste protégé. Comparer à 1, pas à 0 : on compte AVANT la
  // suppression de la cible.
  if (cible.role === "OWNER") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(membershipsTable)
      .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.role, "OWNER")));
    if (count <= 1) {
      res.status(403).json({ error: "Le dernier propriétaire de cet espace ne peut pas être révoqué." });
      return;
    }
  }

  await db.delete(membershipsTable).where(eq(membershipsTable.id, params.data.id));
  // Aucune invalidation de session à part : requireMembership revérifie
  // l'adhésion en base à CHAQUE requête (voir middleware/requireMembership.ts)
  // — la révocation prend effet à la prochaine requête de la personne visée.
  res.sendStatus(204);
});

export default router;

// ── Acceptation d'invitation (PUBLIC, sans authentification) ───────────────

/** LA réponse d'échec. Une seule, pour ne rien révéler par la différence. */
const INTROUVABLE = { error: "Lien invalide ou expiré." } as const;

const FENETRE_MS = 60_000;
const MAX_PAR_FENETRE = 20;
const compteurs = new Map<string, { debut: number; n: number }>();

function adresse(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** Même patron que public.ts — limitation de débit en mémoire, par IP. */
function limiterDebit(req: Request, res: Response, next: NextFunction): void {
  const ip = adresse(req);
  const maintenant = Date.now();
  const courant = compteurs.get(ip);

  if (!courant || maintenant - courant.debut > FENETRE_MS) {
    compteurs.set(ip, { debut: maintenant, n: 1 });
    if (compteurs.size > 10_000) {
      for (const [k, v] of compteurs) {
        if (maintenant - v.debut > FENETRE_MS) compteurs.delete(k);
      }
    }
    next();
    return;
  }

  if (courant.n >= MAX_PAR_FENETRE) {
    res.status(429).json({ error: "Trop de tentatives. Réessayez dans une minute." });
    return;
  }
  courant.n++;
  next();
}

function condensat(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Retrouve une invitation par son jeton, via la policy étroite
 * `tenant_invites_public_token_lookup` — même patron que `lookupByToken`
 * dans public.ts pour les devis. `set_config(..., true)` DANS la
 * transaction, jamais hors d'elle (le pooling ferait fuir le réglage d'une
 * requête à l'autre).
 */
async function lookupInviteByToken(token: string) {
  const sha = condensat(token);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.invite_token_sha256', ${sha}, true)`);
    const [row] = await tx.select().from(tenantInvitesTable).where(eq(tenantInvitesTable.tokenSha256, sha));
    return row ?? null;
  });
}

membresPublicRouter.get("/membres/inviter/:token", limiterDebit, async (req, res): Promise<void> => {
  const { token } = req.params;
  if (typeof token !== "string" || token.length === 0) { res.status(404).json(INTROUVABLE); return; }

  const params = ApercuInvitationParams.safeParse({ token });
  if (!params.success) { res.status(404).json(INTROUVABLE); return; }

  const invite = await lookupInviteByToken(token);
  if (!invite) { res.status(404).json(INTROUVABLE); return; }

  const [tenant] = await db.select({ nom: tenantsTable.nom }).from(tenantsTable).where(eq(tenantsTable.id, invite.tenantId));
  const compteExistant = Boolean(await findUserByEmail(invite.email));

  res.json({
    tenantNom: tenant?.nom ?? "",
    roleOffert: invite.role,
    // US-A5.4 — montrée AVANT l'acceptation : le tiers doit savoir jusqu'à
    // quand court l'accès qu'il accepte.
    accesExpireAt: invite.accesExpireAt,
    email: invite.email,
    compteExistant,
    expire: invite.expiresAt < new Date(),
    dejaAcceptee: invite.acceptedAt !== null,
  });
});

membresPublicRouter.post("/membres/inviter/:token/accepter", limiterDebit, async (req, res): Promise<void> => {
  const { token } = req.params;
  if (typeof token !== "string" || token.length === 0) { res.status(404).json(INTROUVABLE); return; }

  const params = AccepterInvitationParams.safeParse({ token });
  if (!params.success) { res.status(404).json(INTROUVABLE); return; }
  const parsed = AccepterInvitationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const invite = await lookupInviteByToken(token);
  if (!invite) { res.status(404).json(INTROUVABLE); return; }
  if (invite.acceptedAt) { res.status(409).json({ error: "Cette invitation a déjà été acceptée." }); return; }
  if (invite.expiresAt < new Date()) { res.status(410).json({ error: "Cette invitation a expiré." }); return; }

  const existingUser = await findUserByEmail(invite.email);
  let userId: string;
  if (existingUser) {
    const valid = await verifyPassword(parsed.data.password, existingUser.passwordHash);
    if (!valid) { res.status(401).json({ error: "Mot de passe incorrect." }); return; }
    userId = existingUser.id;
  } else {
    if (!parsed.data.nom) { res.status(400).json({ error: "Le nom est obligatoire pour créer un compte." }); return; }
    const passwordHash = await hashPassword(parsed.data.password);
    const [newUser] = await db
      .insert(usersTable)
      .values({ email: invite.email, passwordHash, nom: parsed.data.nom })
      .returning();
    userId = newUser!.id;
  }

  // Une seule transaction pour les deux écritures : marquer l'invitation
  // acceptée ET créer l'adhésion. tenant_invites est une table métier (RLS,
  // via withTenant) ; memberships est une table infra sans RLS — les deux
  // peuvent partager la même transaction, withTenant n'ouvre qu'un
  // db.transaction() classique dont `tx` reste utilisable pour n'importe
  // quelle table.
  const accepte = await withTenant(invite.tenantId, async (tx) => {
    const [updatedInvite] = await tx
      .update(tenantInvitesTable)
      .set({ acceptedAt: new Date() })
      .where(and(eq(tenantInvitesTable.id, invite.id), isNull(tenantInvitesTable.acceptedAt)))
      .returning();
    if (!updatedInvite) return null;
    await tx
      .insert(membershipsTable)
      .values({
        userId,
        tenantId: invite.tenantId,
        role: invite.role,
        libelle: invite.libelle,
        // US-A5.4 — l'échéance passe de l'invitation à l'adhésion ici, dans
        // la transaction qui existe déjà. `null` pour tous les autres rôles.
        expiresAt: invite.accesExpireAt,
      })
      .onConflictDoNothing();
    return updatedInvite;
  });

  if (!accepte) {
    res.status(409).json({ error: "Cette invitation vient d'être acceptée par une autre session." });
    return;
  }

  const session = await createSession(userId, invite.tenantId, req.headers["user-agent"]);
  await touchLastLogin(userId);
  res.cookie(COOKIE_NAME, session.id, COOKIE_OPTS);
  res.json({ userId, tenantId: invite.tenantId, role: invite.role });
});
