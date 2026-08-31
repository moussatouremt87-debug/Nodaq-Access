import { pgTable, text, timestamp, uuid, integer, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

/**
 * Le brief du matin, une ligne par tenant et par jour — migration 072.
 *
 * La contrainte UNIQUE est la garde : le déclencheur est extérieur (un cron
 * qui appelle une route), donc il peut se répéter — reprise après incident,
 * double instance pendant un déploiement progressif, relance manuelle. Deux
 * exécutions concurrentes insèrent, une seule gagne, l'autre n'a rien à
 * envoyer. Aucune fenêtre de course à fermer.
 *
 * AUCUN CONTENU n'est stocké : le brief cite des noms de clients et des
 * montants, et la règle 6 interdit de journaliser un contenu de message. On
 * garde le FAIT de l'envoi, pas ce qu'il disait.
 */
export const briefsEnvoyesTable = pgTable(
  "briefs_envoyes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id),
    /** 'YYYY-MM-DD' en heure de Paris : un jour de calendrier, pas un instant. */
    jour: text("jour").notNull(),
    destinataire: text("destinataire").notNull(),
    /** Combien de sections le brief portait — de quoi mesurer sans rien lire. */
    sections: integer("sections").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("briefs_envoyes_unique").on(t.tenantId, t.jour)],
);
