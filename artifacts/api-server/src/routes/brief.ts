import { Router, type IRouter } from "express";
import { db, affairesTable, facturesTable, prospectsTable, pendingActionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/brief", async (_req, res): Promise<void> => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0]!;

  // Overdue invoices
  const overdueFactures = await db
    .select()
    .from(facturesTable)
    .where(sql`settled = false AND due_date < ${todayStr}`)
    .limit(5);

  // Affaires en cours
  const affairesEnCours = await db
    .select()
    .from(affairesTable)
    .where(eq(affairesTable.status, "EN_COURS"))
    .limit(5);

  // New prospects (last 7 days)
  const newProspects = await db
    .select()
    .from(prospectsTable)
    .where(sql`created_at >= now() - interval '7 days' AND stage NOT IN ('GAGNE', 'PERDU')`)
    .limit(5);

  // Pending actions
  const pendingActions = await db
    .select()
    .from(pendingActionsTable)
    .where(eq(pendingActionsTable.status, "EN_ATTENTE"))
    .limit(5);

  const hour = today.getHours();
  const greeting = hour < 12
    ? `Bonjour — voici votre point du ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(today)}.`
    : `Bonsoir — voici votre récapitulatif du ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(today)}.`;

  const fmt = (cents: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

  const sections = [];

  if (overdueFactures.length > 0) {
    sections.push({
      type: "overdue",
      title: `${overdueFactures.length} facture${overdueFactures.length > 1 ? "s" : ""} en retard`,
      items: overdueFactures.map(f => ({
        label: `${f.customerName} — ${f.number}`,
        meta: fmt(f.amountCents),
        urgent: true,
        link: "/factures",
      })),
    });
  }

  if (affairesEnCours.length > 0) {
    sections.push({
      type: "deadlines",
      title: "Affaires en cours",
      items: affairesEnCours.map(a => ({
        label: a.label,
        meta: a.clientName ?? null,
        urgent: false,
        link: `/affaires`,
      })),
    });
  }

  if (pendingActions.length > 0) {
    sections.push({
      type: "actions",
      title: `${pendingActions.length} action${pendingActions.length > 1 ? "s" : ""} à valider`,
      items: pendingActions.map(a => ({
        label: a.label,
        meta: a.amountCents ? fmt(a.amountCents) : null,
        urgent: true,
        link: "/",
      })),
    });
  }

  if (newProspects.length > 0) {
    sections.push({
      type: "prospects",
      title: "Prospects actifs",
      items: newProspects.map(p => ({
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
