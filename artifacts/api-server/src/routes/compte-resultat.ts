import { Router, type IRouter } from "express";
import { withTenant, DrizzleTx, crEntriesTable, facturesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();

// ── PCG line definitions ──────────────────────────────────────────────────

type PcgSection =
  | "PRODUITS_EXPLOITATION"
  | "CHARGES_EXPLOITATION"
  | "PRODUITS_FINANCIERS"
  | "CHARGES_FINANCIERES"
  | "PRODUITS_EXCEPTIONNELS"
  | "CHARGES_EXCEPTIONNELS"
  | "DEDUCTIONS_RESULTAT"; // participation + IS — handled separately, never included in section sums

type PcgLine = {
  lineCode: string;
  label: string;
  section: PcgSection;
  isAutoComputed?: boolean;
  helpText?: string;
};

const PCG_LINES: PcgLine[] = [
  // Produits d'exploitation
  { lineCode: "PRODUCTION_VENDUE_SERVICES", label: "Production vendue – services (70)", section: "PRODUITS_EXPLOITATION", isAutoComputed: true },
  { lineCode: "PRODUCTION_VENDUE_BIENS",    label: "Production vendue – biens (701–708)", section: "PRODUITS_EXPLOITATION" },
  { lineCode: "PRODUCTION_STOCKEE",         label: "Production stockée (71)", section: "PRODUITS_EXPLOITATION" },
  { lineCode: "PRODUCTION_IMMOBILISEE",     label: "Production immobilisée (72)", section: "PRODUITS_EXPLOITATION" },
  { lineCode: "SUBVENTIONS",                label: "Subventions d'exploitation (74)", section: "PRODUITS_EXPLOITATION" },
  { lineCode: "REPRISES_PROVISIONS",        label: "Reprises / transferts de charges (78-79)", section: "PRODUITS_EXPLOITATION" },
  { lineCode: "AUTRES_PRODUITS",            label: "Autres produits de gestion courante (75)", section: "PRODUITS_EXPLOITATION" },
  // Charges d'exploitation
  { lineCode: "ACHATS_MARCHANDISES",        label: "Achats de marchandises (60)", section: "CHARGES_EXPLOITATION" },
  { lineCode: "ACHATS_MATIERES",            label: "Achats de matières premières (601-602)", section: "CHARGES_EXPLOITATION" },
  { lineCode: "AUTRES_ACHATS",              label: "Autres achats et charges externes (61-62)", section: "CHARGES_EXPLOITATION" },
  { lineCode: "IMPOTS_TAXES",               label: "Impôts et taxes (63)", section: "CHARGES_EXPLOITATION" },
  { lineCode: "SALAIRES",                   label: "Salaires et traitements (641)", section: "CHARGES_EXPLOITATION" },
  { lineCode: "CHARGES_SOCIALES",           label: "Charges sociales (645)", section: "CHARGES_EXPLOITATION" },
  { lineCode: "DOTATIONS_EXPLOIT",          label: "Dotations aux amortissements et provisions (68)", section: "CHARGES_EXPLOITATION" },
  { lineCode: "AUTRES_CHARGES",             label: "Autres charges de gestion courante (65)", section: "CHARGES_EXPLOITATION" },
  // Produits financiers
  { lineCode: "PRODUITS_PARTICIPATION",     label: "Produits de participations (761)", section: "PRODUITS_FINANCIERS" },
  { lineCode: "PRODUITS_VALEURS_MOBILIERES",label: "Produits de valeurs mobilières (762)", section: "PRODUITS_FINANCIERS" },
  { lineCode: "INTERETS_RECUS",             label: "Intérêts et produits assimilés (764)", section: "PRODUITS_FINANCIERS" },
  { lineCode: "PRODUITS_FIN_DIVERS",        label: "Produits financiers divers (768)", section: "PRODUITS_FINANCIERS" },
  // Charges financières
  { lineCode: "DOTATIONS_FINANCIERES",      label: "Dotations financières aux amortissements (686)", section: "CHARGES_FINANCIERES" },
  { lineCode: "INTERETS_EMPRUNTS",          label: "Intérêts et charges assimilées (661)", section: "CHARGES_FINANCIERES" },
  { lineCode: "CHARGES_FIN_DIVERSES",       label: "Charges financières diverses (668)", section: "CHARGES_FINANCIERES" },
  // Produits exceptionnels
  { lineCode: "PRODUITS_EXCEPT_GESTION",    label: "Produits exceptionnels sur opérations de gestion (771)", section: "PRODUITS_EXCEPTIONNELS" },
  { lineCode: "PRODUITS_EXCEPT_CAPITAL",    label: "Produits exceptionnels sur opérations en capital (775)", section: "PRODUITS_EXCEPTIONNELS" },
  { lineCode: "REPRISES_EXCEPT",            label: "Reprises sur provisions exceptionnelles (787)", section: "PRODUITS_EXCEPTIONNELS" },
  // Charges exceptionnelles
  { lineCode: "CHARGES_EXCEPT_GESTION",     label: "Charges exceptionnelles sur opérations de gestion (671)", section: "CHARGES_EXCEPTIONNELS" },
  { lineCode: "CHARGES_EXCEPT_CAPITAL",     label: "Charges exceptionnelles sur opérations en capital (675)", section: "CHARGES_EXCEPTIONNELS" },
  { lineCode: "DOTATIONS_EXCEPT",           label: "Dotations exceptionnelles aux amortissements (687)", section: "CHARGES_EXCEPTIONNELS" },
  // Déductions du résultat — listed separately below exceptional items; NEVER included in section sums
  { lineCode: "PARTICIPATION_SALARIES",     label: "Participation des salariés aux résultats (691)", section: "DEDUCTIONS_RESULTAT" },
  { lineCode: "IMPOTS_BENEFICES",           label: "Impôts sur les bénéfices (695)", section: "DEDUCTIONS_RESULTAT" },
];

const PeriodQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const fmtEURFr = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

function periodKey(from: string, to: string) { return `${from}:${to}`; }

// ── Helpers ───────────────────────────────────────────────────────────────

async function loadEquipeHint(tx: DrizzleTx): Promise<number> {
  try {
    const tauxResult    = await tx.execute(sql`SELECT value FROM settings WHERE key = 'equipe.coutJourCharge'`);
    const membersResult = await tx.execute(sql`SELECT COUNT(*) AS cnt FROM team_members WHERE availability != 'ABSENT'`);
    const coutJour   = (tauxResult.rows[0] as any)?.value ? Number((tauxResult.rows[0] as any).value) : 250;
    const activeCount = (membersResult.rows[0] as any)?.cnt ? Number((membersResult.rows[0] as any).cnt) : 0;
    if (activeCount === 0 || coutJour === 0) return 0;
    return Math.round(coutJour * activeCount * 218 * 100);
  } catch {
    return 0;
  }
}

export type LineResult = PcgLine & {
  autoAmountCents: number;
  manualAmountCents: number | null;
};

export async function buildLineResults(tx: DrizzleTx, from: string, to: string): Promise<LineResult[]> {
  const pKey = periodKey(from, to);

  const factures = await tx.select().from(facturesTable);
  const caFactures = factures
    .filter(f => f.issuedDate >= from && f.issuedDate <= to)
    .reduce((acc, f) => acc + f.amountCents, 0);

  const entries = await tx.select().from(crEntriesTable);
  const entryMap = new Map(entries.filter(e => e.periodKey === pKey).map(e => [e.lineCode, e.amountCents]));

  const salaireHint = await loadEquipeHint(tx);

  return PCG_LINES.map(line => {
    let autoAmountCents = 0;
    if (line.lineCode === "PRODUCTION_VENDUE_SERVICES") autoAmountCents = Math.round(caFactures);
    const manualAmountCents = entryMap.has(line.lineCode) ? (entryMap.get(line.lineCode) ?? 0) : null;
    return {
      ...line,
      autoAmountCents,
      manualAmountCents,
      ...(line.lineCode === "SALAIRES" && manualAmountCents === null
        ? { autoHint: `Estimation Équipe : ${fmtEURFr(salaireHint)} (${Math.round(salaireHint / 100).toLocaleString("fr-FR")} €)` }
        : {}),
    };
  });
}

export function computeTotals(lines: LineResult[]) {
  const val  = (line: LineResult) => line.manualAmountCents !== null ? line.manualAmountCents : line.autoAmountCents;
  // DEDUCTIONS_RESULTAT is intentionally excluded — those lines are read individually below.
  const sum  = (section: Exclude<PcgSection, "DEDUCTIONS_RESULTAT">) =>
    lines.filter(l => l.section === section).reduce((a, l) => a + val(l), 0);

  const totalProduitsExploit    = sum("PRODUITS_EXPLOITATION");
  const totalChargesExploit     = sum("CHARGES_EXPLOITATION");
  const resultatExploit         = totalProduitsExploit - totalChargesExploit;
  const totalProduitsFinanciers = sum("PRODUITS_FINANCIERS");
  const totalChargesFinancieres = sum("CHARGES_FINANCIERES");
  const resultatFinancier       = totalProduitsFinanciers - totalChargesFinancieres;
  const resultatCourant         = resultatExploit + resultatFinancier;
  const totalProduitsExcept     = sum("PRODUITS_EXCEPTIONNELS");
  const totalChargesExcept      = sum("CHARGES_EXCEPTIONNELS");
  const resultatExceptionnel    = totalProduitsExcept - totalChargesExcept;
  // Participation and IS are deducted once — they are NOT in any section sum above.
  const participation = val(lines.find(l => l.lineCode === "PARTICIPATION_SALARIES")!);
  const impots        = val(lines.find(l => l.lineCode === "IMPOTS_BENEFICES")!);
  const resultatExercice = resultatCourant + resultatExceptionnel - participation - impots;
  return {
    totalProduitsExploit, totalChargesExploit, resultatExploit,
    totalProduitsFinanciers, totalChargesFinancieres, resultatFinancier,
    resultatCourant, totalProduitsExcept, totalChargesExcept,
    resultatExceptionnel, participation, impots, resultatExercice,
  };
}

export type Totals = ReturnType<typeof computeTotals>;

/**
 * Construit les lignes CSV du compte de résultat PCG pour UNE période —
 * réutilisée telle quelle par l'export mono-tenant (ci-dessous) et par
 * l'export consolidé cabinet (US-A5.2, routes/cabinet.ts) : même structure
 * PCG partout, aucune logique dupliquée entre les deux.
 */
export function buildCompteResultatCsvRows(
  lines: LineResult[],
  totals: Totals,
  from: string,
  to: string,
): string[] {
  const fmtCents = (c: number) => (c / 100).toFixed(2).replace(".", ",");
  const val = (l: LineResult) => l.manualAmountCents !== null ? l.manualAmountCents : l.autoAmountCents;

  const rows: string[] = [];
  const row = (label: string, amount?: number) =>
    rows.push(`"${label.replace(/"/g, '""')}";${amount !== undefined ? `"${fmtCents(amount)} €"` : ""}`);

  row(`Compte de Résultat PCG — ${from} au ${to}`);
  row("Désignation", undefined);
  rows[rows.length - 1] += `;"Montant (€)"`;

  const sectionHeader = (title: string) => { rows.push(""); row(title); };
  const linesBySection = (section: PcgSection) => lines.filter(l => l.section === section);

  sectionHeader("I — PRODUITS D'EXPLOITATION");
  for (const l of linesBySection("PRODUITS_EXPLOITATION")) row(l.label, val(l));
  row("TOTAL I — Produits d'exploitation", totals.totalProduitsExploit);
  sectionHeader("II — CHARGES D'EXPLOITATION");
  for (const l of linesBySection("CHARGES_EXPLOITATION")) row(l.label, val(l));
  row("TOTAL II — Charges d'exploitation", totals.totalChargesExploit);
  rows.push("");
  row("RÉSULTAT D'EXPLOITATION (I − II)", totals.resultatExploit);
  sectionHeader("IV — PRODUITS FINANCIERS");
  for (const l of linesBySection("PRODUITS_FINANCIERS")) row(l.label, val(l));
  row("TOTAL IV — Produits financiers", totals.totalProduitsFinanciers);
  sectionHeader("V — CHARGES FINANCIÈRES");
  for (const l of linesBySection("CHARGES_FINANCIERES")) row(l.label, val(l));
  row("TOTAL V — Charges financières", totals.totalChargesFinancieres);
  rows.push("");
  row("RÉSULTAT FINANCIER (IV − V)", totals.resultatFinancier);
  row("RÉSULTAT COURANT AVANT IMPÔTS (I−II + IV−V)", totals.resultatCourant);
  sectionHeader("VII — PRODUITS EXCEPTIONNELS");
  for (const l of linesBySection("PRODUITS_EXCEPTIONNELS")) row(l.label, val(l));
  row("TOTAL VII — Produits exceptionnels", totals.totalProduitsExcept);
  sectionHeader("VIII — CHARGES EXCEPTIONNELLES");
  for (const l of linesBySection("CHARGES_EXCEPTIONNELS")) row(l.label, val(l));
  row("TOTAL VIII — Charges exceptionnelles", totals.totalChargesExcept);
  rows.push("");
  row("RÉSULTAT EXCEPTIONNEL (VII − VIII)", totals.resultatExceptionnel);
  rows.push("");
  row("Participation des salariés aux résultats", val(lines.find(l => l.lineCode === "PARTICIPATION_SALARIES")!));
  row("Impôts sur les bénéfices",                val(lines.find(l => l.lineCode === "IMPOTS_BENEFICES")!));
  rows.push("");
  row(`RÉSULTAT DE L'EXERCICE (${totals.resultatExercice >= 0 ? "BÉNÉFICE" : "PERTE"})`, totals.resultatExercice);

  return rows;
}

// ── GET /compte-resultat ──────────────────────────────────────────────────

router.get("/compte-resultat", async (req, res): Promise<void> => {
  const parsed = PeriodQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { from, to } = parsed.data;
  const tenantId = req.tenantId!;

  const { lines, totals } = await withTenant(tenantId, async (tx) => {
    const lines = await buildLineResults(tx, from, to);
    return { lines, totals: computeTotals(lines) };
  });

  res.json({ from, to, periodKey: periodKey(from, to), lines, totals });
});

// ── PATCH /compte-resultat/lignes ─────────────────────────────────────────

const PatchLignesBody = z.object({
  periodKey: z.string().min(1),
  lines: z.array(z.object({
    lineCode:    z.string().min(1),
    amountCents: z.number().int(),
  })),
});

router.patch("/compte-resultat/lignes", requireAuth, async (req, res): Promise<void> => {
  const parsed = PatchLignesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { periodKey: pKey, lines } = parsed.data;

  for (const { lineCode } of lines) {
    const pcgLine = PCG_LINES.find(l => l.lineCode === lineCode);
    if (!pcgLine) { res.status(400).json({ error: `Unknown lineCode: ${lineCode}` }); return; }
    if (pcgLine.isAutoComputed) {
      res.status(400).json({ error: `lineCode ${lineCode} is auto-computed and cannot be overridden` }); return;
    }
  }

  const tenantId = req.tenantId!;

  await withTenant(tenantId, async (tx) => {
    for (const { lineCode, amountCents } of lines) {
      const existing = await tx.select().from(crEntriesTable)
        .where(and(eq(crEntriesTable.periodKey, pKey), eq(crEntriesTable.lineCode, lineCode)));

      if (existing.length > 0) {
        await tx.update(crEntriesTable)
          .set({ amountCents, updatedAt: new Date() })
          .where(and(eq(crEntriesTable.periodKey, pKey), eq(crEntriesTable.lineCode, lineCode)));
      } else {
        await tx.insert(crEntriesTable).values({ tenantId, periodKey: pKey, lineCode, amountCents });
      }
    }
  });

  res.json({ ok: true, saved: lines.length });
});

// ── GET /compte-resultat/export/pdf ──────────────────────────────────────

router.get("/compte-resultat/export/pdf", async (req, res): Promise<void> => {
  const parsed = PeriodQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { from, to } = parsed.data;
  const tenantId = req.tenantId!;

  // Fetch data inside transaction, then generate PDF outside
  const { lines, totals } = await withTenant(tenantId, async (tx) => {
    const lines = await buildLineResults(tx, from, to);
    return { lines, totals: computeTotals(lines) };
  });

  const fmtDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
  const periodLabel = `Exercice du ${fmtDate(from)} au ${fmtDate(to)}`;
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, info: { Title: `Compte de Résultat — ${periodLabel}` } });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="compte-resultat-${from.slice(0, 4)}.pdf"`);
  doc.pipe(res);

  doc.fontSize(20).font("Helvetica-Bold").fillColor("#0a0a0a").text("NODAQ", 50, 50);
  doc.fontSize(10).font("Helvetica").fillColor("#555").text("Compte de Résultat — PCG", 50, 76);
  doc.fontSize(10).font("Helvetica").fillColor("#555").text(periodLabel, 50, 90);
  const genDate = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  doc.fontSize(8).fillColor("#999").text(`Généré le ${genDate}`, 50, 90, { align: "right", width: 495 });
  doc.moveTo(50, 108).lineTo(545, 108).strokeColor("#e0e0e0").lineWidth(1).stroke();

  const COL_LABEL = 50; const COL_AMOUNT = 400; const COL_WIDTH_LABEL = 340; const ROW_H = 16;
  let y = 120;
  const checkPage = () => { if (y > 760) { doc.addPage(); y = 50; } };

  const drawSectionHeader = (title: string, bg: string) => {
    checkPage();
    doc.rect(50, y, 495, ROW_H + 2).fillColor(bg).fill();
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#fff").text(title, COL_LABEL + 4, y + 4, { width: COL_WIDTH_LABEL });
    y += ROW_H + 4;
  };

  const drawLine = (label: string, amountCents: number, isZero: boolean, indent = 0) => {
    checkPage();
    if (y % 2 === 0) doc.rect(50, y - 1, 495, ROW_H).fillColor("#fafafa").fill();
    doc.fontSize(7.5).font("Helvetica").fillColor(isZero ? "#ccc" : "#222")
      .text(label, COL_LABEL + 4 + indent, y + 3, { width: COL_WIDTH_LABEL - indent, ellipsis: true });
    if (!isZero) doc.fontSize(7.5).font("Helvetica").fillColor("#111")
      .text(fmtEURFr(amountCents), COL_AMOUNT, y + 3, { width: 140, align: "right" });
    y += ROW_H;
  };

  const drawSubtotal = (label: string, amountCents: number) => {
    checkPage();
    doc.rect(50, y, 495, ROW_H + 2).fillColor("#f0f0f0").fill();
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#ccc").lineWidth(0.5).stroke();
    doc.fontSize(8).font("Helvetica-Bold").fillColor("#111").text(label, COL_LABEL + 4, y + 4, { width: COL_WIDTH_LABEL });
    doc.fontSize(8).font("Helvetica-Bold").fillColor(amountCents >= 0 ? "#111" : "#c0392b")
      .text(fmtEURFr(amountCents), COL_AMOUNT, y + 4, { width: 140, align: "right" });
    y += ROW_H + 4;
  };

  const drawResult = (label: string, amountCents: number) => {
    checkPage();
    doc.rect(50, y, 495, ROW_H + 6).fillColor(amountCents >= 0 ? "#e8f5e9" : "#fce4ec").fill();
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#bdbdbd").lineWidth(1).stroke();
    doc.fontSize(9).font("Helvetica-Bold").fillColor(amountCents >= 0 ? "#1b5e20" : "#b71c1c")
      .text(label, COL_LABEL + 4, y + 5, { width: COL_WIDTH_LABEL });
    doc.fontSize(9).font("Helvetica-Bold").fillColor(amountCents >= 0 ? "#1b5e20" : "#b71c1c")
      .text(fmtEURFr(amountCents), COL_AMOUNT, y + 5, { width: 140, align: "right" });
    y += ROW_H + 8;
  };

  const val = (l: LineResult) => l.manualAmountCents !== null ? l.manualAmountCents : l.autoAmountCents;
  const linesBySection = (section: PcgSection) => lines.filter(l => l.section === section);

  drawSectionHeader("I — PRODUITS D'EXPLOITATION", "#1a237e");
  for (const l of linesBySection("PRODUITS_EXPLOITATION")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total I — Produits d'exploitation", totals.totalProduitsExploit);
  drawSectionHeader("II — CHARGES D'EXPLOITATION", "#4a148c");
  for (const l of linesBySection("CHARGES_EXPLOITATION")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total II — Charges d'exploitation", totals.totalChargesExploit);
  drawResult("RÉSULTAT D'EXPLOITATION (I − II)", totals.resultatExploit);
  drawSectionHeader("IV — PRODUITS FINANCIERS", "#006064");
  for (const l of linesBySection("PRODUITS_FINANCIERS")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total IV — Produits financiers", totals.totalProduitsFinanciers);
  drawSectionHeader("V — CHARGES FINANCIÈRES", "#004d40");
  for (const l of linesBySection("CHARGES_FINANCIERES")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total V — Charges financières", totals.totalChargesFinancieres);
  drawResult("RÉSULTAT FINANCIER (IV − V)", totals.resultatFinancier);
  drawResult("RÉSULTAT COURANT AVANT IMPÔTS (I−II + IV−V)", totals.resultatCourant);
  drawSectionHeader("VII — PRODUITS EXCEPTIONNELS", "#bf360c");
  for (const l of linesBySection("PRODUITS_EXCEPTIONNELS")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total VII — Produits exceptionnels", totals.totalProduitsExcept);
  drawSectionHeader("VIII — CHARGES EXCEPTIONNELLES", "#7f0000");
  for (const l of linesBySection("CHARGES_EXCEPTIONNELS")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total VIII — Charges exceptionnelles", totals.totalChargesExcept);
  drawResult("RÉSULTAT EXCEPTIONNEL (VII − VIII)", totals.resultatExceptionnel);
  y += 4;
  const participation = lines.find(l => l.lineCode === "PARTICIPATION_SALARIES")!;
  const impots        = lines.find(l => l.lineCode === "IMPOTS_BENEFICES")!;
  drawLine(participation.label, val(participation), val(participation) === 0);
  drawLine(impots.label,        val(impots),        val(impots) === 0);
  y += 8;
  drawResult(
    `RÉSULTAT DE L'EXERCICE — ${totals.resultatExercice >= 0 ? "BÉNÉFICE" : "PERTE"}`,
    totals.resultatExercice,
  );

  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fillColor("#bbb").text(`Page ${i + 1} / ${pageCount}`, 50, 820, { align: "center", width: 495 });
  }
  doc.end();
});

// ── GET /compte-resultat/export/csv ──────────────────────────────────────

router.get("/compte-resultat/export/csv", async (req, res): Promise<void> => {
  const parsed = PeriodQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { from, to } = parsed.data;
  const tenantId = req.tenantId!;

  const { lines, totals } = await withTenant(tenantId, async (tx) => {
    const lines = await buildLineResults(tx, from, to);
    return { lines, totals: computeTotals(lines) };
  });

  const rows = buildCompteResultatCsvRows(lines, totals, from, to);

  const bom = "\uFEFF";
  const csv = bom + rows.join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="compte-resultat-${from.slice(0, 4)}.csv"`);
  res.send(csv);
});

export default router;
