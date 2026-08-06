import { pgTable, text, date, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { teamMembersTable } from "./team_members";

export const absencesTable = pgTable(
  "absences",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    membreId: text("membre_id").notNull().references(() => teamMembersTable.id),
    type: text("type").notNull().default("Congés"),
    dateDebut: date("date_debut").notNull(),
    dateFin: date("date_fin").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("absences_tenant_id_idx").on(t.tenantId),
    index("absences_membre_date_fin_idx").on(t.membreId, t.dateFin),
  ],
);

export type Absence = typeof absencesTable.$inferSelect;
