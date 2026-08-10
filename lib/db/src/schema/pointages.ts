import {
  pgTable,
  text,
  date,
  numeric,
  timestamp,
  uuid,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { teamMembersTable } from "./team_members";
import { affairesTable } from "./affaires";

/**
 * Hours worked, per member, per affaire, per day.
 *
 * `heures` is NUMERIC, not real: these hours become money once multiplied by a
 * charged cost, and binary floats do not add up exactly. Drizzle surfaces
 * numeric as a string — always parse it explicitly rather than relying on
 * coercion.
 *
 * The uniqueness constraint is what makes the weekly confirmation flow
 * idempotent: confirming the same week twice updates the lines instead of
 * duplicating them.
 */
export const pointagesTable = pgTable(
  "pointages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    membreId: text("membre_id")
      .notNull()
      .references(() => teamMembersTable.id, { onDelete: "cascade" }),
    affaireId: text("affaire_id")
      .notNull()
      .references(() => affairesTable.id, { onDelete: "cascade" }),
    /** ISO YYYY-MM-DD — a business date, always built with toDateString. */
    date: date("date").notNull(),
    /** Hours as a NUMERIC string, e.g. "7.50". Parse, never coerce blindly. */
    heures: numeric("heures", { precision: 5, scale: 2 }).notNull(),
    /** 'confirme' (weekly recap, main path) | 'saisi' (manual) | 'importe' */
    source: text("source").notNull().default("confirme"),
    commentaire: text("commentaire"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("pointages_unique_membre_affaire_jour").on(
      t.tenantId,
      t.membreId,
      t.affaireId,
      t.date,
    ),
    index("pointages_tenant_date_idx").on(t.tenantId, t.date),
    index("pointages_tenant_affaire_idx").on(t.tenantId, t.affaireId),
    index("pointages_tenant_membre_idx").on(t.tenantId, t.membreId, t.date),
  ],
);

export type Pointage = typeof pointagesTable.$inferSelect;

/** Allowed values of `source`, mirrored by the CHECK constraint in 007. */
export const POINTAGE_SOURCES = ["confirme", "saisi", "importe"] as const;
export type PointageSource = (typeof POINTAGE_SOURCES)[number];
