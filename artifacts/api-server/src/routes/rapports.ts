import { Router, type IRouter } from "express";
import { withTenant, affairesTable, facturesTable, prospectsTable, avoirsTable } from "@workspace/db";
import { productionVendue } from "@nodaq/shared";
import { chargerReprise } from "../lib/reprise-ca.js";
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

  const { allAffaires, allFactures, allProspects, allAvoirs, reprise } = await withTenant(tenantId, async (tx) => {
    const allAffaires  = await tx.select().from(affairesTable);
    const allFactures  = await tx.select().from(facturesTable);
    const allProspects = await tx.select().from(prospectsTable);
    const allAvoirs    = await tx.select().from(avoirsTable);
    return { allAffaires, allFactures, allProspects, allAvoirs, reprise: await chargerReprise(tx) };
  });

  const moisAffaires  = allAffaires.filter(a => { const d = new Date(a.createdAt); return d >= monthStart && d < monthEnd; });
  const facturesMois  = allFactures.filter(f => { const d = new Date(f.issuedDate); return d >= monthStart && d < monthEnd; });
  /*
   * ── LE CA VIENT DE LA DÉFINITION CANONIQUE, PLUS D'UNE ADDITION LOCALE ────
   *
   * Cette ligne additionnait `amountCents` — le TTC — sur TOUTES les factures
   * du mois, brouillons compris, sans jamais déduire un avoir. Le 29/08/2026,
   * elle annonçait 22 976,80 € là où le chiffre d'affaires du mois valait
   * 20 888,00 € : la TVA collectée présentée comme un produit.
   *
   * `productionVendue` porte la règle entière — base HT avec repli sur les
   * lignes reprises, liste blanche de statuts, avoirs déduits en HT, reprise
   * rattachée au seul exercice qui la contient. Elle est pure et éprouvée.
   * Le compte de résultat s'en sert déjà ; les deux écrans diront désormais
   * la même chose, parce qu'ils font le même calcul.
   */
  const dernierJour = new Date(year, month, 0).getDate();
  const caMois = productionVendue(
    allFactures, allAvoirs, reprise,
    `${mois}-01`,
    `${mois}-${String(dernierJour).padStart(2, "0")}`,
  ).totalCents;
  const facturesEncaissees = facturesMois.filter(f => f.settled).length;
  const nouvellesAffaires  = moisAffaires.length;

  const nouveauxClients = allProspects.filter(p => {
    const d = new Date(p.updatedAt ?? p.createdAt);
    return d >= monthStart && d < monthEnd && p.stage === "GAGNE";
  }).length;

  // Une marge inconnue n'entre pas dans le total comme un zéro : elle serait
  // lue comme « ce chantier n'a rien rapporté ». On ne somme que le connu, on
  // rapporte au CA des seules affaires à marge connue, et on dit combien
  // manquent.
  const affairesMargeConnue = moisAffaires.filter((a) => a.marginCents !== null);
  const affairesMargeInconnue = moisAffaires.length - affairesMargeConnue.length;

  const totalRev    = moisAffaires.reduce((acc, a) => acc + (a.invoicedAmountCents ?? 0), 0);
  const totalMargin = affairesMargeConnue.length
    ? affairesMargeConnue.reduce((acc, a) => acc + (a.marginCents ?? 0), 0)
    : null;
  const revMargeConnue = affairesMargeConnue.reduce(
    (acc, a) => acc + (a.invoicedAmountCents ?? 0),
    0,
  );
  const tauxMarge =
    totalMargin !== null && revMargeConnue > 0
      ? Math.round((totalMargin / revMargeConnue) * 1000) / 10
      : null;

  const topAffaires = moisAffaires
    .filter(a => (a.invoicedAmountCents ?? 0) > 0)
    .sort((a, b) => (b.invoicedAmountCents ?? 0) - (a.invoicedAmountCents ?? 0))
    .slice(0, 5)
    .map(a => ({
      id: a.id, label: a.label, clientName: a.clientName, status: a.status,
      invoicedAmountCents: a.invoicedAmountCents,
      /** `null` = marge non mesurée. */
      marginCents: a.marginCents,
      marginPct: a.marginCents !== null && a.invoicedAmountCents && a.invoicedAmountCents > 0
        ? Math.round((a.marginCents / a.invoicedAmountCents) * 1000) / 10 : null,
    }));

  const clientMap = new Map<string, number>();
  facturesMois.forEach(f => clientMap.set(f.customerName, (clientMap.get(f.customerName) ?? 0) + f.amountCents));
  const topClients = Array.from(clientMap.entries())
    .map(([clientName, totalCents]) => ({ clientName, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 5);

  res.json({
    mois,
    summary: {
      caMois,
      nouvellesAffaires,
      nouveauxClients,
      facturesEncaissees,
      /** `null` = aucune marge mesurée ce mois-ci. */
      tauxMarge,
      /** Nombre d'affaires du mois dont la marge n'est pas mesurée. */
      affairesMargeInconnue,
    },
    topAffaires, topClients,
  });
});

export default router;
