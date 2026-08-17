/**
 * US-A5.2 — export consolidé pour un utilisateur multi-tenants (cabinet
 * comptable) : un seul CSV concaténant le compte de résultat PCG de chaque
 * client où il a un accès financier. Structure homogène garantie par
 * construction — même PCG partout (voir compte-resultat.ts) — donc aucune
 * agrégation nouvelle à inventer : on boucle et on concatène.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { withTenant, settingsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { hasFinancialAccess, verticalLabel, type Vertical } from "@nodaq/shared";
import { listUserMemberships } from "../lib/authService";
import { buildLineResults, computeTotals, buildCompteResultatCsvRows } from "./compte-resultat";

const router: IRouter = Router();

const PeriodQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const VERTICAL_SETTING_KEY = "votre-metier.metier";
const DEFAULT_VERTICAL: Vertical = "industrie_btp";

router.get("/cabinet/export", async (req, res): Promise<void> => {
  const parsed = PeriodQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { from, to } = parsed.data;

  const memberships = (await listUserMemberships(req.session!.userId))
    .filter(m => hasFinancialAccess(m.role));

  const blocks: string[] = [];
  for (const m of memberships) {
    const { secteurLabel, rows } = await withTenant(m.tenantId, async (tx) => {
      const [verticalRow] = await tx
        .select({ value: settingsTable.value })
        .from(settingsTable)
        .where(sql`${settingsTable.key} = ${VERTICAL_SETTING_KEY}`);
      const vertical = (verticalRow?.value as Vertical | undefined) ?? DEFAULT_VERTICAL;
      const secteurLabel = verticalLabel(vertical);

      const lines = await buildLineResults(tx, from, to);
      const totals = computeTotals(lines);
      const rows = buildCompteResultatCsvRows(lines, totals, from, to);
      return { secteurLabel, rows };
    });

    blocks.push(`"Client : ${m.tenantNom.replace(/"/g, '""')} (${secteurLabel})"`);
    blocks.push(...rows);
    blocks.push("");
  }

  const bom = "﻿";
  const csv = bom + blocks.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cabinet-export-${from.slice(0, 4)}.csv"`);
  res.send(csv);
});

export default router;
