import { Router, type IRouter } from "express";
import { withTenant, affairesTable, facturesTable, prospectsTable, pendingActionsTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { toDateString, verticalPack, estRetardSignificatif, type Vertical } from "@nodaq/shared";
import { conditionFactureEnRetardSql } from "../lib/facturesEnRetard.js";

const router: IRouter = Router();

// Même clé et même défaut que routes/votre-metier.ts (US-A1.1)/cockpit.ts.
const VERTICAL_SETTING_KEY = "votre-metier.metier";
const DEFAULT_VERTICAL: Vertical = "industrie_btp";

router.get("/brief", async (req, res): Promise<void> => {
  const today = new Date();
  const todayStr = toDateString(today);
  const tenantId = req.tenantId!;

  const data = await withTenant(tenantId, async (tx) => {
    // Même définition que `factures.ts`/`cockpit.ts` (`facturesEnRetard.ts`) —
    // `settled = false` (champ legacy, "kept for backward compat" selon le
    // schéma) divergeait de `statut`, désormais autoritaire. Pas de `.limit`
    // ici : le tri par sévérité ci-dessous doit porter sur l'ensemble des
    // factures en retard, pas sur 5 lignes arbitraires déjà tronquées.
    const overdueFacturesToutes = await tx
      .select()
      .from(facturesTable)
      .where(conditionFactureEnRetardSql(todayStr));

    const [verticalRow] = await tx.select({ value: settingsTable.value }).from(settingsTable).where(
      sql`${settingsTable.key} = ${VERTICAL_SETTING_KEY}`,
    );
    const vertical = (verticalRow?.value as Vertical | undefined) ?? DEFAULT_VERTICAL;
    const delaiPaiementUsuelJours = verticalPack(vertical).delaiPaiementUsuelJours;

    // US-A3.1 : les factures en retard SIGNIFICATIF (au-delà du délai usuel
    // du secteur) en tête — le brief matin doit attirer l'œil sur ce qui
    // dépasse le cycle normal de l'artisan, pas sur toute échéance à peine
    // dépassée pour un profil B2B à délai standard.
    const overdueFactures = overdueFacturesToutes
      .map(f => ({ f, significatif: estRetardSignificatif(f.dueDate, todayStr, delaiPaiementUsuelJours) }))
      .sort((a, b) => (a.significatif === b.significatif ? 0 : a.significatif ? -1 : 1) || (a.f.dueDate < b.f.dueDate ? -1 : 1))
      .slice(0, 5);

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
      items: data.overdueFactures.map(({ f, significatif }) => ({
        label: `${f.customerName} — ${f.number}`,
        meta: fmt(f.amountCents),
        // US-A3.1 : urgent uniquement pour un retard qui dépasse le délai
        // usuel du secteur — pas toute facture simplement échue.
        urgent: significatif,
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
