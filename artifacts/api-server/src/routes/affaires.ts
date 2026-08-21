import { Router, type IRouter } from "express";
import { withTenant, affairesTable, activityTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { toDateString, hasFinancialAccess } from "@nodaq/shared";
import {
  CreateAffaireBody,
  UpdateAffaireBody,
  GetAffaireParams,
  UpdateAffaireParams,
  DeleteAffaireParams,
  ListAffairesQueryParams,
} from "@workspace/api-zod";
import { maskFinancialFields } from "../lib/maskFinancialFields.js";

const router: IRouter = Router();

// US-A4.4 : habilitations_requises est un JSON texte (même patron que
// team_members.schedule) — jamais un crash sur une valeur héritée invalide.
function parseHabilitationsRequises(raw: string): string[] {
  try {
    const val = JSON.parse(raw);
    return Array.isArray(val) ? val : [];
  } catch {
    return [];
  }
}

function avecHabilitationsParsees<T extends { habilitationsRequises: string }>(
  affaire: T,
): Omit<T, "habilitationsRequises"> & { habilitationsRequises: string[] } {
  return { ...affaire, habilitationsRequises: parseHabilitationsRequises(affaire.habilitationsRequises) };
}

// Les affaires mêlent des données de travail qu'un MEMBER doit voir
// (libellé, client, statut, dates) à des montants réservés à OWNER/
// ACCOUNTANT — masqués champ par champ, PAS bloqués en entier : voir
// routes/index.ts pour le raisonnement complet.

router.get("/affaires/stats", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const financier = hasFinancialAccess(req.session?.role);
  const { byStatus } = await withTenant(tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT
        status,
        count(*)::int as count,
        coalesce(sum(coalesce(quoted_amount_cents, montant_vendu_ht)), 0)::int as "totalCents"
      FROM affaires
      GROUP BY status
      ORDER BY status
    `);
    return { byStatus: rows.rows as Array<{ status: string; count: number; totalCents: number }> };
  });

  const totalPipelineValueCents = byStatus
    .filter(r => !["PERDUE", "ARCHIVEE"].includes(r.status))
    .reduce((acc, r) => acc + (r.totalCents ?? 0), 0);

  const byStatusMasque = byStatus.map((r) => maskFinancialFields(r, ["totalCents"], financier));
  res.json(maskFinancialFields(
    { byStatus: byStatusMasque, totalPipelineValueCents },
    ["totalPipelineValueCents"],
    financier,
  ));
});

router.get("/affaires", async (req, res): Promise<void> => {
  const parsed = ListAffairesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { statut, inclureArchivees } = parsed.data;

  const tenantId = req.tenantId!;
  const financier = hasFinancialAccess(req.session?.role);
  const { affaires } = await withTenant(tenantId, async (tx) => {
    let query = tx.select().from(affairesTable).$dynamic();
    if (statut) {
      query = query.where(eq(affairesTable.status, statut));
    } else if (!inclureArchivees) {
      query = query.where(sql`status != 'ARCHIVEE'`);
    }
    query = query.orderBy(desc(affairesTable.createdAt));
    return { affaires: await query };
  });

  const totalQuotedCents = affaires.reduce((acc, a) => acc + (a.quotedAmountCents ?? a.montantVenduHt ?? 0), 0);
  const affairesMasquees = affaires.map((a) =>
    maskFinancialFields(avecHabilitationsParsees(a), ["quotedAmountCents", "invoicedAmountCents", "marginCents", "montantVenduHt"], financier),
  );
  res.json(maskFinancialFields(
    { affaires: affairesMasquees, total: affaires.length, totalQuotedCents },
    ["totalQuotedCents"],
    financier,
  ));
});

router.post("/affaires", async (req, res): Promise<void> => {
  const parsed = CreateAffaireBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  const tenantId = req.tenantId!;
  const refNum = String(Date.now()).slice(-6);
  const rawStart = data.startDate as unknown as Date | string | undefined;
  const startDate = rawStart instanceof Date ? toDateString(rawStart) : (rawStart ?? null);

  const affaire = await withTenant(tenantId, async (tx) => {
    const [affaire] = await tx.insert(affairesTable).values({
      tenantId,
      label: data.label,
      clientName: data.clientName ?? null,
      status: data.status ?? "PROSPECT",
      quotedAmountCents: data.quotedAmountCents ?? null,
      notes: data.notes ?? null,
      startDate,
      reference: `AFF-${refNum}`,
      ...(data.habilitationsRequises ? { habilitationsRequises: JSON.stringify(data.habilitationsRequises) } : {}),
    }).returning();
    await tx.insert(activityTable).values({
      tenantId,
      type: "affaire_created",
      label: `Nouvelle affaire : ${affaire!.label}`,
      meta: affaire!.clientName ?? null,
    });
    return affaire;
  });

  res.status(201).json(avecHabilitationsParsees(affaire!));
});

router.get("/affaires/:id", async (req, res): Promise<void> => {
  const params = GetAffaireParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = req.tenantId!;
  const [affaire] = await withTenant(tenantId, async (tx) =>
    tx.select().from(affairesTable).where(eq(affairesTable.id, params.data.id))
  );
  if (!affaire) { res.status(404).json({ error: "Affaire not found" }); return; }
  res.json(maskFinancialFields(
    avecHabilitationsParsees(affaire),
    ["quotedAmountCents", "invoicedAmountCents", "marginCents", "montantVenduHt"],
    hasFinancialAccess(req.session?.role),
  ));
});

router.patch("/affaires/:id", async (req, res): Promise<void> => {
  const params = UpdateAffaireParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateAffaireBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.label !== undefined) updateData.label = data.label;
  if (data.clientName !== undefined) updateData.clientName = data.clientName;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.quotedAmountCents !== undefined) updateData.quotedAmountCents = data.quotedAmountCents;
  if (data.invoicedAmountCents !== undefined) updateData.invoicedAmountCents = data.invoicedAmountCents;
  if (data.marginCents !== undefined) updateData.marginCents = data.marginCents;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.startDate !== undefined) updateData.startDate = data.startDate;
  if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;
  if (data.montantVenduHt !== undefined) updateData.montantVenduHt = data.montantVenduHt;
  if (data.avancementPct !== undefined) updateData.avancementPct = data.avancementPct;
  if (data.dateFinPrevue !== undefined) {
    const rawFin = data.dateFinPrevue as unknown as Date | string | null;
    updateData.dateFinPrevue = rawFin instanceof Date ? toDateString(rawFin) : rawFin;
  }
  if (data.habilitationsRequises !== undefined) {
    updateData.habilitationsRequises = JSON.stringify(data.habilitationsRequises);
  }

  const tenantId = req.tenantId!;
  const [affaire] = await withTenant(tenantId, async (tx) =>
    tx.update(affairesTable).set(updateData).where(eq(affairesTable.id, params.data.id)).returning()
  );
  if (!affaire) { res.status(404).json({ error: "Affaire not found" }); return; }
  res.json(avecHabilitationsParsees(affaire));
});

router.delete("/affaires/:id", async (req, res): Promise<void> => {
  const params = DeleteAffaireParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = req.tenantId!;
  const [deleted] = await withTenant(tenantId, async (tx) =>
    tx.delete(affairesTable).where(eq(affairesTable.id, params.data.id)).returning()
  );
  if (!deleted) { res.status(404).json({ error: "Affaire not found" }); return; }
  res.sendStatus(204);
});

export default router;
