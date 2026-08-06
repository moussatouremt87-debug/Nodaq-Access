import { db, teamMembersTable, connectorsTable, tenantsTable } from "./index.js";
import { eq } from "drizzle-orm";

const DAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN'];

async function seedPlatform() {
  // Resolve the Migration tenant — created by migrate-multitenant.cjs
  const tenants = await db.select().from(tenantsTable);
  if (tenants.length === 0) {
    console.error("No tenant found. Run migrate-multitenant.cjs first.");
    process.exit(1);
  }
  const tenantId = tenants[0].id;

  // Seed team members
  const existingMembers = await db.select().from(teamMembersTable);
  if (existingMembers.length === 0) {
    await db.insert(teamMembersTable).values([
      {
        tenantId,
        name: "Sophie Marchand",
        role: "Développeuse Full-Stack",
        email: "sophie@nodaq.fr",
        availability: "DISPONIBLE",
        schedule: JSON.stringify(DAYS.map(day => ({ day, affaireId: null }))),
      },
      {
        tenantId,
        name: "Thomas Dubois",
        role: "Designer UX/UI",
        email: "thomas@nodaq.fr",
        availability: "PARTIEL",
        schedule: JSON.stringify(DAYS.map(day => ({ day, affaireId: null }))),
      },
      {
        tenantId,
        name: "Amel Benali",
        role: "Chef de projet",
        email: "amel@nodaq.fr",
        availability: "DISPONIBLE",
        schedule: JSON.stringify(DAYS.map(day => ({ day, affaireId: null }))),
      },
    ]);
    console.log("✓ Seeded team members");
  }

  // Seed connectors
  const existingConnectors = await db.select().from(connectorsTable);
  if (existingConnectors.length === 0) {
    const CONNECTORS = [
      { type: "BANQUE",       label: "Banque",        description: "Synchronisation des transactions bancaires", status: "NON_CONNECTE" },
      { type: "PENNYLANE",    label: "Pennylane",     description: "Comptabilité et facturation synchronisées",  status: "NON_CONNECTE" },
      { type: "STRIPE",       label: "Stripe",        description: "Paiements en ligne et abonnements",           status: "NON_CONNECTE" },
      { type: "GOOGLE_DRIVE", label: "Google Drive",  description: "Stockage et partage de documents",           status: "NON_CONNECTE" },
      { type: "SLACK",        label: "Slack",         description: "Notifications et alertes d'équipe",          status: "NON_CONNECTE" },
      { type: "ZAPIER",       label: "Zapier",        description: "Automatisation de workflows",                status: "NON_CONNECTE" },
    ];
    for (const c of CONNECTORS) {
      await db.insert(connectorsTable).values({ tenantId, ...c, config: {} }).onConflictDoNothing();
    }
    console.log("✓ Seeded connectors");
  }

  console.log("Platform seeding complete.");
  process.exit(0);
}

seedPlatform().catch(console.error);
