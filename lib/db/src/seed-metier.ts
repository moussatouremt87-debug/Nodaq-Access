import { db, withTenant, devisTable, classeurTable, echeancesTable, tenantsTable } from "./index.js";

async function seedMetier() {
  // Resolve the Migration tenant — created by migrate-multitenant.cjs
  // tenants is an infra table with no RLS policy, so db (without GUC) is fine here.
  const tenants = await db.select().from(tenantsTable);
  if (tenants.length === 0) {
    console.error("No tenant found. Run migrate-multitenant.cjs first.");
    process.exit(1);
  }
  const tenantId = tenants[0].id;

  // All business-table reads and inserts must go through withTenant so that
  // set_config('app.current_tenant_id', tenantId, true) is set for the
  // transaction — required by the FORCE ROW LEVEL SECURITY policies.
  await withTenant(tenantId, async (tx) => {
    // Seed devis
    const existingDevis = await tx.select().from(devisTable);
    if (existingDevis.length === 0) {
      await tx.insert(devisTable).values([
        {
          tenantId,
          reference: "DEV-2026-0001",
          clientName: "Atelier Dupont",
          status: "ACCEPTE",
          lines: [
            { id: crypto.randomUUID(), description: "Développement site e-commerce", quantity: 1, unitPriceCents: 450000 },
            { id: crypto.randomUUID(), description: "Intégration paiement Stripe", quantity: 1, unitPriceCents: 80000 },
          ],
          totalHTCents: 530000,
          totalTTCCents: 636000,
          tvaRate: 20,
          remise: 0,
          validUntil: "2026-09-30",
          notes: "Devis accepté suite au rendez-vous du 15 juillet.",
        },
        {
          tenantId,
          reference: "DEV-2026-0002",
          clientName: "Cabinet Martin & Associés",
          status: "ENVOYE",
          lines: [
            { id: crypto.randomUUID(), description: "Audit SI et conseil", quantity: 3, unitPriceCents: 120000 },
            { id: crypto.randomUUID(), description: "Rédaction cahier des charges", quantity: 1, unitPriceCents: 60000 },
          ],
          totalHTCents: 420000,
          totalTTCCents: 504000,
          tvaRate: 20,
          remise: 0,
          validUntil: "2026-08-31",
        },
        {
          tenantId,
          reference: "DEV-2026-0003",
          clientName: "Boulangerie Chez Paul",
          status: "BROUILLON",
          lines: [
            { id: crypto.randomUUID(), description: "Application mobile de commande", quantity: 1, unitPriceCents: 850000 },
          ],
          totalHTCents: 807500,
          totalTTCCents: 969000,
          tvaRate: 20,
          remise: 5,
          notes: "En attente des spécifications définitives.",
        },
        {
          tenantId,
          reference: "DEV-2026-0004",
          clientName: "Groupe Lemaire",
          status: "REFUSE",
          lines: [
            { id: crypto.randomUUID(), description: "Formation React avancé (2 jours)", quantity: 2, unitPriceCents: 250000 },
          ],
          totalHTCents: 500000,
          totalTTCCents: 600000,
          tvaRate: 20,
          remise: 0,
          validUntil: "2026-07-15",
          notes: "Budget insuffisant côté client.",
        },
      ]);
      console.log("✓ Seeded devis");
    }

    // Seed classeur
    const existingDocs = await tx.select().from(classeurTable);
    if (existingDocs.length === 0) {
      await tx.insert(classeurTable).values([
        { tenantId, name: "Facture F-2026-001 - Atelier Dupont.pdf", category: "FACTURES", size: 145230, mimeType: "application/pdf" },
        { tenantId, name: "Contrat prestation - Cabinet Martin.pdf", category: "CONTRATS", size: 287450, mimeType: "application/pdf" },
        { tenantId, name: "Devis DEV-2026-0001 signé.pdf", category: "DEVIS", size: 98760, mimeType: "application/pdf" },
        { tenantId, name: "Kbis NODAQ 2026.pdf", category: "DIVERS", size: 234100, mimeType: "application/pdf" },
        { tenantId, name: "Contrat SaaS annuel - Groupe Lemaire.pdf", category: "CONTRATS", size: 312000, mimeType: "application/pdf" },
        { tenantId, name: "Facture fournisseur OVH - Juin 2026.pdf", category: "FACTURES", size: 52000, mimeType: "application/pdf" },
      ]);
      console.log("✓ Seeded classeur");
    }

    // Seed echeances
    const existingEch = await tx.select().from(echeancesTable);
    if (existingEch.length === 0) {
      const today = new Date();
      const d = (offset: number) => {
        const dt = new Date(today);
        dt.setDate(dt.getDate() + offset);
        return dt.toISOString().slice(0, 10);
      };

      await tx.insert(echeancesTable).values([
        { tenantId, type: "TVA", label: "Déclaration TVA CA3 — Juillet 2026", dueDate: d(8), estimatedCents: 234000, status: "A_VENIR" },
        { tenantId, type: "URSSAF", label: "Cotisations sociales URSSAF — T3 2026", dueDate: d(22), estimatedCents: 189000, status: "A_VENIR" },
        { tenantId, type: "IS", label: "Acompte IS — 3ème trimestre 2026", dueDate: d(45), estimatedCents: 420000, status: "A_VENIR" },
        { tenantId, type: "CFE", label: "Cotisation Foncière des Entreprises 2026", dueDate: d(150), estimatedCents: 86000, status: "A_VENIR" },
        {
          tenantId, type: "TVA", label: "Déclaration TVA CA3 — Juin 2026", dueDate: d(-10),
          estimatedCents: 198000, paidCents: 198000, status: "PAYEE",
          paidAt: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000),
        },
        {
          tenantId, type: "URSSAF", label: "Cotisations sociales URSSAF — T2 2026", dueDate: d(-45),
          estimatedCents: 175000, paidCents: 175000, status: "PAYEE",
          paidAt: new Date(today.getTime() - 40 * 24 * 60 * 60 * 1000),
        },
      ]);
      console.log("✓ Seeded echeances");
    }
  });

  console.log("Seeding complete.");
  process.exit(0);
}

seedMetier().catch(console.error);
