import { pgTable, text, timestamp, json, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const connectorsTable = pgTable(
  "connectors",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    type: text("type").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    status: text("status").notNull().default("NON_CONNECTE"),
    config: json("config").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("connectors_tenant_type_uidx").on(t.tenantId, t.type),
  ],
);

export const insertConnectorSchema = createInsertSchema(connectorsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConnector = z.infer<typeof insertConnectorSchema>;
export type Connector = typeof connectorsTable.$inferSelect;
