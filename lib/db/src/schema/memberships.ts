import { pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const membershipsTable = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    /** OWNER | MEMBER | ACCOUNTANT | VIEWER — un tenant peut porter plusieurs
     *  OWNER à égalité (US-A5.1) ; le dernier OWNER reste protégé, voir
     *  routes/membres.ts. `VIEWER` = tiers de confiance en lecture seule
     *  (US-A5.4) : la lecture seule est appliquée par
     *  `middleware/lectureSeule.ts`, pas par une contrainte de base. */
    role: text("role").notNull().default("MEMBER"),
    /** Qualificatif libre affiché à côté du rôle (ex. "Conjoint
     *  collaborateur", "Associé fondateur") — le rôle seul détermine les
     *  droits, ce champ ne fait rien d'autre qu'afficher (US-A5.1). */
    libelle: text("libelle"),
    /** Échéance de l'accès (US-A5.4). `null` = permanent, ce que sont toutes
     *  les adhésions sauf celles d'un tiers de confiance. Contrôlée à chaque
     *  requête par `middleware/requireMembership.ts`. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("memberships_user_tenant_unique").on(t.userId, t.tenantId),
  ],
);

export type Membership = typeof membershipsTable.$inferSelect;
export type InsertMembership = typeof membershipsTable.$inferInsert;
