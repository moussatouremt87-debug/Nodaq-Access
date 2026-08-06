import { Router, type IRouter } from "express";
import { withTenant, affairesTable, facturesTable, prospectsTable, pendingActionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getDefaultTenantId } from "../lib/defaultTenant";

const router: IRouter = Router();

router.get("/brief", async (_req, res): Promise<void> => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0]!;
  const tenantId = await getDefaultTenantId();

  const data = await withTenant(tenantId, async (tx) => {
    const overdueFactures = await tx
      .select()
      .from(facturesTable)
      .where(sql`settled = false AND due_date < ${todayStr}`)
      .limit(5);

    const affairesEnCours = await tx
      .select()
      .from(affairesTable)
      .where(eq(affairesTable.status, "EN_COURS"))
      .limit(5);

    const newProspects = await tx
      .select()
      .from(prospectsTable)
      .where(sql`created_at >= now() - interval '7 days' AND stage NOT IN ('GAGNE', 'PERDU')`)
      .limit(5);

    const pendingActions = await tx
      .select()
      .from(pendingActionsTable)
      .where(eq(pendingActionsTable.status, "EN_ATTENTE"))
      .limit(5);

    return { overdueFactures, affairesEnCours, newProspects, pendingActions };
  });

  const hour = today.getHours();
  const greeting = hour < 12
    ? `Bonjour — voici votre point du ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(today)}.`
    : `Bonsoir — voici votre récapitulatif du ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(today)}.`;

  const fmt = (cents: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

  const sections = [];

  if (data.overdueFactures.length > 0) {
    sections.push({
      type: "overdue",
      title: `${data.overdueFactures.length} facture${data.overdueFactures.length > 1 ? "s" : ""} en retard`,
      items: data.overdueFactures.map(f => ({
        label: `${f.customerName} — ${f.number}`,
        meta: fmt(f.amountCents),
        urgent: true,
        link: "/factures",
      })),
    });
  }

  if (data.affairesEnCours.length > 0) {
    sections.push({
      type: "deadlines",
      title: "Affaires en cours",
      items: data.affairesEnCours.map(a => ({
        label: a.label,
        meta: a.clientName ?? null,
        urgent: false,
        link: `/affaires`,
      })),
    });
  }

  if (data.pendingActions.length > 0) {
    sections.push({
      type: "actions",
      title: `${data.pendingActions.length} action${data.pendingActions.length > 1 ? "s" : ""} à valider`,
      items: data.pendingActions.map(a => ({
        label: a.label,
        meta: a.amountCents ? fmt(a.amountCents) : null,
        urgent: true,
        link: "/",
      })),
    });
  }

  if (data.newProspects.length > 0) {
    sections.push({
      type: "prospects",
      title: "Prospects actifs",
      items: data.newProspects.map(p => ({
        label: p.name,
        meta: p.companyName ?? p.stage,
        urgent: false,
        link: "/prospects",
      })),
    });
  }

  if (sections.length === 0) {
    sections.push({
      type: "summary",
      title: "Tout est en ordre",
      items: [{ label: "Aucune action urgente aujourd'hui.", meta: null, urgent: false, link: null }],
    });
  }

  res.json({ date: todayStr, greeting, sections });
});

export default router;
