import { pgTable, text, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const classeurTable = pgTable("classeur_documents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  category: text("category").notNull().default("DIVERS"),
  size: real("size"), // bytes
  mimeType: text("mime_type"),
  notes: text("notes"),
  affaireId: text("affaire_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClasseurSchema = createInsertSchema(classeurTable).omit({ id: true, createdAt: true });
export type InsertClasseurDocument = z.infer<typeof insertClasseurSchema>;
export type ClasseurDocument = typeof classeurTable.$inferSelect;
