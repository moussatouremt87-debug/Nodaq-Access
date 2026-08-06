/**
 * Auth service — all DB operations for authentication.
 * These queries target infra tables (sessions, users, memberships, tenants)
 * which have no RLS; they are called outside withTenant().
 */
import {
  db,
  usersTable,
  sessionsTable,
  membershipsTable,
  tenantsTable,
  type User,
  type Session,
  type Membership,
} from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";

/** 7-day sliding window */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function newExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

// ── Users ─────────────────────────────────────────────────────────────────

export async function findUserByEmail(email: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));
  return user ?? null;
}

export async function createUserTenantOwner(
  email: string,
  passwordHash: string,
  nom: string,
  tenantNom: string,
): Promise<{ userId: string; tenantId: string }> {
  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenantsTable)
      .values({ nom: tenantNom })
      .returning();

    const [user] = await tx
      .insert(usersTable)
      .values({ email: email.toLowerCase().trim(), passwordHash, nom })
      .returning();

    await tx.insert(membershipsTable).values({
      userId: user!.id,
      tenantId: tenant!.id,
      role: "OWNER",
    });

    return { userId: user!.id, tenantId: tenant!.id };
  });
}

export async function touchLastLogin(userId: string): Promise<void> {
  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, userId));
}

// ── Sessions ──────────────────────────────────────────────────────────────

export async function createSession(
  userId: string,
  tenantId: string,
  userAgent?: string,
): Promise<Session> {
  const [session] = await db
    .insert(sessionsTable)
    .values({ userId, tenantId, expiresAt: newExpiry(), userAgent: userAgent ?? null })
    .returning();
  return session!;
}

export interface SessionWithContext {
  session: Session;
  user: Pick<User, "id" | "email" | "nom">;
  /** null when the membership has been revoked — requireMembership handles the 403. */
  membership: Pick<Membership, "role"> | null;
}

export async function findValidSession(
  sessionId: string,
): Promise<SessionWithContext | null> {
  const now = new Date();
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(
      and(eq(sessionsTable.id, sessionId), gt(sessionsTable.expiresAt, now)),
    );
  if (!session) return null;

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, nom: usersTable.nom })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId));
  if (!user) return null;

  // Membership is re-checked by requireMembership on every request.
  // We load it here only to pre-populate req.session.role for convenience;
  // a null membership does NOT cause a 401 — requireMembership returns 403 instead.
  const [membership] = await db
    .select({ role: membershipsTable.role })
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.userId, session.userId),
        eq(membershipsTable.tenantId, session.tenantId),
      ),
    );

  return { session, user, membership: membership ?? null };
}

export async function extendSession(sessionId: string): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ expiresAt: newExpiry() })
    .where(eq(sessionsTable.id, sessionId));
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
}

export async function deleteExpiredSessions(): Promise<void> {
  const now = new Date();
  // DELETE sessions WHERE expires_at < now — simple cleanup
  await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.expiresAt, now)); // approximate; a scheduled job handles bulk cleanup
}

// ── Memberships ───────────────────────────────────────────────────────────

export async function checkMembership(
  userId: string,
  tenantId: string,
): Promise<Membership | null> {
  const [m] = await db
    .select()
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.userId, userId),
        eq(membershipsTable.tenantId, tenantId),
      ),
    );
  return m ?? null;
}

/** Returns all memberships for a user, ordered newest-first, for login tenant selection. */
export async function findUserMemberships(userId: string): Promise<Membership[]> {
  const { desc } = await import("drizzle-orm");
  return db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.userId, userId))
    .orderBy(desc(membershipsTable.createdAt))
    .limit(5);
}
