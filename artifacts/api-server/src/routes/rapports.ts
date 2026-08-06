import { Router, type IRouter } from "express";
import { withTenant, affairesTable, facturesTable, prospectsTable } from "@workspace/db";
import { GetRapportMensuelQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/rapports/mensuel", async (req, res): Promise<void> => {
  const parsed = GetRapportMensuelQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const now = new Date();
  const mois = parsed.data.mois ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, month] = mois.split("-").map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 1);

  const tenantId = req.tenantId!;

  const { allAffaires, allFactures, allProspects } = await withTenant(tenantId, async (tx) => {
    const allAffaires  = await tx.select().from(affairesTable);
    const allFactures  = await tx.select().from(facturesTable);
    const allProspects = await tx.select().from(prospectsTable);
    return { allAffaires, allFactures, allProspects };
  });

  const moisAffaires  = allAffaires.filter(a => { const d = new Date(a.createdAt); return d >= monthStart && d < monthEnd; });
  const facturesMois  = allFactures.filter(f => { const d = new Date(f.issuedDate); return d >= monthStart && d < monthEnd; });
  const caMois        = facturesMois.reduce((acc, f) => acc + f.amountCents, 0);
  const facturesEncaissees = facturesMois.filter(f => f.settled).length;
  const nouvellesAffaires  = moisAffaires.length;

  const nouveauxClients = allProspects.filter(p => {
    const d = new Date(p.updatedAt ?? p.createdAt);
    return d >= monthStart && d < monthEnd && p.stage === "GAGNE";
  }).length;

  const totalRev    = moisAffaires.reduce((acc, a) => acc + (a.invoicedAmountCents ?? 0), 0);
  const totalMargin = moisAffaires.reduce((acc, a) => acc + (a.marginCents ?? 0), 0);
  const tauxMarge   = totalRev > 0 ? Math.round((totalMargin / totalRev) * 1000) / 10 : 0;

  const topAffaires = moisAffaires
    .filter(a => (a.invoicedAmountCents ?? 0) > 0)
    .sort((a, b) => (b.invoicedAmountCents ?? 0) - (a.invoicedAmountCents ?? 0))
    .slice(0, 5)
    .map(a => ({
      id: a.id, label: a.label, clientName: a.clientName, status: a.status,
      invoicedAmountCents: a.invoicedAmountCents, marginCents: a.marginCents,
      marginPct: a.invoicedAmountCents && a.invoicedAmountCents > 0
        ? Math.round(((a.marginCents ?? 0) / a.invoicedAmountCents) * 1000) / 10 : null,
    }));

  const clientMap = new Map<string, number>();
  facturesMois.forEach(f => clientMap.set(f.customerName, (clientMap.get(f.customerName) ?? 0) + f.amountCents));
  const topClients = Array.from(clientMap.entries())
    .map(([clientName, totalCents]) => ({ clientName, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 5);

  res.json({
    mois,
    summary: { caMois, nouvellesAffaires, nouveauxClients, facturesEncaissees, tauxMarge },
    topAffaires, topClients,
  });
});

export default router;
