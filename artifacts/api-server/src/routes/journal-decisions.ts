/**
 * Journal des décisions — US-A6.4.
 *
 * Ce que l'assistant a proposé, ce que l'humain en a décidé, quand et par qui.
 * Destiné à être produit tel quel devant un contrôleur ou dans un litige.
 *
 * ── Pourquoi une UNION et non une simple lecture de table ────────────────
 * Une approbation et un rejet sont des ACTES : ils sont journalisés au moment
 * où ils ont lieu, dans la transaction de la décision. Une expiration n'en est
 * pas un — c'est l'ABSENCE de décision, constatée par le temps qui passe.
 * Rien ne tourne périodiquement dans ce produit pour la consigner, et inventer
 * un écrivain périodique pour cela reviendrait à fabriquer une décision que
 * personne n'a prise.
 *
 * Elle est donc DÉRIVÉE ici : une action encore en attente dont l'échéance est
 * passée ressort avec le statut distinct `EXPIREE` (AC3). Et
 * `purgerPlansExpires` la journalise avant de supprimer, pour que l'historique
 * survive au jour où cette purge sera câblée.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { withTenant, journalDecisionsTable, pendingActionsTable } from "@workspace/db";
import { and, desc, gte, isNull, lte, sql } from "drizzle-orm";
import { messageValidation } from "../lib/message-validation.js";

const router: IRouter = Router();

const PeriodQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export interface LigneJournal {
  actionId: string;
  actionType: string;
  actionLabel: string;
  actionPayload: unknown;
  decision: "APPROUVEE" | "REJETEE" | "EXPIREE";
  decideeLe: Date;
  decideeParEmail: string | null;
}

/**
 * Bornes d'un jour calendaire, en composantes LOCALES.
 *
 * `decidee_le` est un INSTANT (timestamptz) ; `from`/`to` sont des jours du
 * calendrier de l'utilisateur. Construire les bornes en UTC
 * (`new Date("2026-08-18T00:00:00Z")`) décalerait la fenêtre de l'écart horaire :
 * en France l'été, une décision prise à 00h30 le 19 tomberait dans le 18, et
 * les deux premières heures du 18 en sortiraient. C'est le piège que garde
 * `period-bounds-timezone-guard.test.ts` — mêmes composantes locales que
 * `analytics-periods.ts`.
 */
function debutDeJournee(jour: string): Date {
  const [a, m, j] = jour.split("-").map(Number);
  return new Date(a!, m! - 1, j!, 0, 0, 0, 0);
}

function finDeJournee(jour: string): Date {
  const [a, m, j] = jour.split("-").map(Number);
  return new Date(a!, m! - 1, j!, 23, 59, 59, 999);
}

/**
 * Les décisions journalisées et les expirations dérivées, sur une période.
 * `to` est INCLUSIF : un contrôleur qui demande « jusqu'au 31 » attend le 31.
 */
export async function lireJournal(
  tenantId: string,
  from?: string,
  to?: string,
): Promise<LigneJournal[]> {
  return withTenant(tenantId, async (tx) => {
    const bornes = [
      ...(from ? [gte(journalDecisionsTable.decideeLe, debutDeJournee(from))] : []),
      ...(to ? [lte(journalDecisionsTable.decideeLe, finDeJournee(to))] : []),
    ];

    const journalisees = await tx
      .select({
        actionId: journalDecisionsTable.actionId,
        actionType: journalDecisionsTable.actionType,
        actionLabel: journalDecisionsTable.actionLabel,
        actionPayload: journalDecisionsTable.actionPayload,
        decision: journalDecisionsTable.decision,
        decideeLe: journalDecisionsTable.decideeLe,
        decideeParEmail: journalDecisionsTable.decideeParEmail,
      })
      .from(journalDecisionsTable)
      .where(bornes.length > 0 ? and(...bornes) : undefined)
      .orderBy(desc(journalDecisionsTable.decideeLe));

    // Les expirations pas encore purgées : la ligne dort en attente avec une
    // échéance dépassée. Elles n'ont ni auteur ni date de décision — leur
    // « date » est celle de l'échéance.
    const bornesExpirees = [
      sql`${pendingActionsTable.status} = 'EN_ATTENTE'`,
      isNull(pendingActionsTable.executeLe),
      sql`${pendingActionsTable.expireLe} IS NOT NULL`,
      sql`${pendingActionsTable.expireLe} < NOW()`,
      ...(from ? [gte(pendingActionsTable.expireLe, debutDeJournee(from))] : []),
      ...(to ? [lte(pendingActionsTable.expireLe, finDeJournee(to))] : []),
    ];

    const expirees = await tx
      .select({
        actionId: pendingActionsTable.id,
        actionType: pendingActionsTable.type,
        actionLabel: pendingActionsTable.label,
        actionPayload: pendingActionsTable.payload,
        decideeLe: pendingActionsTable.expireLe,
      })
      .from(pendingActionsTable)
      .where(and(...bornesExpirees));

    const lignes: LigneJournal[] = [
      ...journalisees.map((l) => ({ ...l, decision: l.decision as LigneJournal["decision"] })),
      ...expirees.map((l) => ({
        actionId: l.actionId,
        actionType: l.actionType,
        actionLabel: l.actionLabel,
        actionPayload: l.actionPayload,
        decision: "EXPIREE" as const,
        decideeLe: l.decideeLe!,
        decideeParEmail: null,
      })),
    ];

    return lignes.sort((a, b) => b.decideeLe.getTime() - a.decideeLe.getTime());
  });
}

const LIBELLE_DECISION: Record<LigneJournal["decision"], string> = {
  APPROUVEE: "Approuvée",
  REJETEE: "Rejetée",
  EXPIREE: "Expirée sans décision",
};

router.get("/journal-decisions", async (req, res): Promise<void> => {
  const parsed = PeriodQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  res.json(await lireJournal(req.tenantId!, parsed.data.from, parsed.data.to));
});

/**
 * Export CSV — AC2 : « exploitable par un tiers sans dépendre de l'interface
 * NODAQ ». Un contrôleur l'ouvre dans un tableur, sans rien installer. Même
 * idiome que les exports existants : BOM, séparateur `;`, dates françaises.
 */
export function buildJournalCsvRows(lignes: readonly LigneJournal[]): string[] {
  const champ = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const dateFr = (d: Date) =>
    new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(d);

  const rows = [
    ["Date de décision", "Décision", "Auteur", "Type d'action", "Action proposée", "Contenu exact"]
      .map(champ).join(";"),
  ];
  for (const l of lignes) {
    rows.push([
      champ(dateFr(l.decideeLe)),
      champ(LIBELLE_DECISION[l.decision]),
      // Une expiration n'a pas d'auteur : le dire explicitement plutôt que de
      // laisser une case vide, qu'un lecteur prendrait pour une donnée perdue.
      champ(l.decideeParEmail ?? "— (aucune décision humaine)"),
      champ(l.actionType),
      champ(l.actionLabel),
      champ(l.actionPayload ? JSON.stringify(l.actionPayload) : ""),
    ].join(";"));
  }
  return rows;
}

router.get("/journal-decisions/export", async (req, res): Promise<void> => {
  const parsed = PeriodQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }

  const lignes = await lireJournal(req.tenantId!, parsed.data.from, parsed.data.to);
  const csv = "﻿" + buildJournalCsvRows(lignes).join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="journal-decisions.csv"`);
  res.send(csv);
});

export default router;
