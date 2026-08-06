import { Router, type IRouter } from "express";
import { db, pool, facturesTable, crEntriesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
// pdfkit is externalized in esbuild so its AFM fonts resolve from node_modules
import PDFDocument from "pdfkit";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();

// ── PCG structure ─────────────────────────────────────────────────────────

type PcgSection =
  | "PRODUITS_EXPLOITATION"
  | "CHARGES_EXPLOITATION"
  | "PRODUITS_FINANCIERS"
  | "CHARGES_FINANCIERES"
  | "PRODUITS_EXCEPTIONNELS"
  | "CHARGES_EXCEPTIONNELS"
  | "AUTRES";

type PcgLine = {
  lineCode: string;
  label: string;
  section: PcgSection;
  isAutoComputed?: boolean;
  autoHint?: string;
};

export const PCG_LINES: PcgLine[] = [
  // I — Produits d'exploitation
  { lineCode: "VENTES_MARCHANDISES",        label: "Ventes de marchandises",                                                       section: "PRODUITS_EXPLOITATION" },
  { lineCode: "PRODUCTION_VENDUE_BIENS",    label: "Production vendue (biens)",                                                    section: "PRODUITS_EXPLOITATION" },
  { lineCode: "PRODUCTION_VENDUE_SERVICES", label: "Production vendue (services)",                                                 section: "PRODUITS_EXPLOITATION", isAutoComputed: true, autoHint: "Montant total des factures émises sur la période" },
  { lineCode: "PRODUCTION_STOCKEE",         label: "Production stockée (ou déstockage)",                                           section: "PRODUITS_EXPLOITATION" },
  { lineCode: "PRODUCTION_IMMOBILISEE",     label: "Production immobilisée",                                                       section: "PRODUITS_EXPLOITATION" },
  { lineCode: "SUBVENTIONS_EXPLOITATION",   label: "Subventions d'exploitation",                                                   section: "PRODUITS_EXPLOITATION" },
  { lineCode: "REPRISES_AMORT_EXPLOIT",     label: "Reprises sur amortissements, dépréciations et provisions",                    section: "PRODUITS_EXPLOITATION" },
  { lineCode: "AUTRES_PRODUITS_EXPLOIT",    label: "Autres produits d'exploitation",                                               section: "PRODUITS_EXPLOITATION" },
  // II — Charges d'exploitation
  { lineCode: "ACHATS_MARCHANDISES",         label: "Achats de marchandises",                                                      section: "CHARGES_EXPLOITATION" },
  { lineCode: "VAR_STOCKS_MARCHANDISES",     label: "Variation de stocks (marchandises)",                                          section: "CHARGES_EXPLOITATION" },
  { lineCode: "ACHATS_MATIERES_PREMIERES",   label: "Achats de matières premières et autres approvisionnements",                   section: "CHARGES_EXPLOITATION" },
  { lineCode: "VAR_STOCKS_MATIERES",         label: "Variation de stocks (matières premières et approvisionnements)",              section: "CHARGES_EXPLOITATION" },
  { lineCode: "AUTRES_ACHATS_CHARGES_EXT",   label: "Autres achats et charges externes",                                          section: "CHARGES_EXPLOITATION" },
  { lineCode: "IMPOTS_TAXES",                label: "Impôts, taxes et versements assimilés",                                       section: "CHARGES_EXPLOITATION" },
  { lineCode: "SALAIRES",                    label: "Salaires et traitements",                                                     section: "CHARGES_EXPLOITATION" },
  { lineCode: "CHARGES_SOCIALES",            label: "Charges sociales",                                                            section: "CHARGES_EXPLOITATION" },
  { lineCode: "DOTATIONS_AMORT_EXPLOIT",     label: "Dotations aux amortissements, dépréciations et provisions d'exploitation",   section: "CHARGES_EXPLOITATION" },
  { lineCode: "AUTRES_CHARGES_EXPLOIT",      label: "Autres charges d'exploitation",                                               section: "CHARGES_EXPLOITATION" },
  // IV — Produits financiers
  { lineCode: "PROD_FIN_PARTICIPATIONS",   label: "Produits financiers de participations",                                         section: "PRODUITS_FINANCIERS" },
  { lineCode: "PROD_AUTRES_VM_CREANCES",   label: "Produits des autres valeurs mobilières et créances immobilisées",              section: "PRODUITS_FINANCIERS" },
  { lineCode: "AUTRES_INTERETS_PROD",      label: "Autres intérêts et produits assimilés",                                        section: "PRODUITS_FINANCIERS" },
  { lineCode: "REPRISES_DEP_PROV_FIN",     label: "Reprises sur dépréciations et provisions financières",                        section: "PRODUITS_FINANCIERS" },
  { lineCode: "DIFF_CHANGE_POS",           label: "Différences positives de change",                                              section: "PRODUITS_FINANCIERS" },
  { lineCode: "PROD_CESSIONS_VMP",         label: "Produits nets sur cessions de valeurs mobilières de placement",               section: "PRODUITS_FINANCIERS" },
  // V — Charges financières
  { lineCode: "DOT_AMORT_DEP_PROV_FIN",   label: "Dotations aux amortissements, dépréciations et provisions financières",       section: "CHARGES_FINANCIERES" },
  { lineCode: "INTERETS_CHARGES",          label: "Intérêts et charges assimilées",                                               section: "CHARGES_FINANCIERES" },
  { lineCode: "DIFF_CHANGE_NEG",           label: "Différences négatives de change",                                              section: "CHARGES_FINANCIERES" },
  { lineCode: "CHG_CESSIONS_VMP",          label: "Charges nettes sur cessions de valeurs mobilières de placement",              section: "CHARGES_FINANCIERES" },
  // VII — Produits exceptionnels
  { lineCode: "PROD_EXCEPT_GESTION",       label: "Sur opérations de gestion (produits exceptionnels)",                          section: "PRODUITS_EXCEPTIONNELS" },
  { lineCode: "PROD_EXCEPT_CAPITAL",       label: "Sur opérations en capital",                                                    section: "PRODUITS_EXCEPTIONNELS" },
  { lineCode: "REPRISES_DEP_PROV_EXCEPT",  label: "Reprises sur dépréciations et provisions exceptionnelles",                   section: "PRODUITS_EXCEPTIONNELS" },
  // VIII — Charges exceptionnelles
  { lineCode: "CHG_EXCEPT_GESTION",        label: "Sur opérations de gestion (charges exceptionnelles)",                         section: "CHARGES_EXCEPTIONNELS" },
  { lineCode: "CHG_EXCEPT_CAPITAL",        label: "Sur opérations en capital",                                                    section: "CHARGES_EXCEPTIONNELS" },
  { lineCode: "DOT_AMORT_DEP_PROV_EXCEPT", label: "Dotations aux amortissements, dépréciations et provisions exceptionnelles",  section: "CHARGES_EXCEPTIONNELS" },
  // Autres déductions
  { lineCode: "PARTICIPATION_SALARIES",    label: "Participation des salariés aux résultats",                                     section: "AUTRES" },
  { lineCode: "IMPOTS_BENEFICES",          label: "Impôts sur les bénéfices",                                                     section: "AUTRES" },
];

// ── Helpers ───────────────────────────────────────────────────────────────

const PeriodQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

function periodKey(from: string, to: string) {
  return `${from}:${to}`;
}

/** French number format: 1 234 567,89 € */
function fmtEURFr(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

async function loadEquipeHint(client: any): Promise<number> {
  try {
    const { rows: tauxRows } = await client.query(
      "SELECT value FROM settings WHERE key = 'equipe.coutJourCharge'",
    );
    const { rows: membersRows } = await client.query(
      "SELECT COUNT(*) AS cnt FROM team_members WHERE availability != 'ABSENT'",
    );
    const coutJour = tauxRows[0]?.value ? Number(tauxRows[0].value) : 250;
    const activeCount = membersRows[0]?.cnt ? Number(membersRows[0].cnt) : 0;
    if (activeCount === 0 || coutJour === 0) return 0;
    // Estimate: 218 working days per year per person (French average)
    return Math.round(coutJour * activeCount * 218 * 100); // in cents
  } catch {
    return 0;
  }
}

type LineResult = PcgLine & {
  autoAmountCents: number;
  manualAmountCents: number | null;
};

async function buildLineResults(from: string, to: string): Promise<LineResult[]> {
  const pKey = periodKey(from, to);

  // Auto: sum factures issued in range
  const factures = await db.select().from(facturesTable);
  const caFactures = factures
    .filter(f => f.issuedDate >= from && f.issuedDate <= to)
    .reduce((acc, f) => acc + f.amountCents, 0);

  // Manual entries from DB
  const entries = await db.select().from(crEntriesTable);
  const entryMap = new Map(entries.filter(e => e.periodKey === pKey).map(e => [e.lineCode, e.amountCents]));

  // Equipe hint for salaries
  const dbClient = await pool.connect();
  let salaireHint = 0;
  try {
    salaireHint = await loadEquipeHint(dbClient);
  } finally {
    dbClient.release();
  }

  return PCG_LINES.map(line => {
    let autoAmountCents = 0;
    if (line.lineCode === "PRODUCTION_VENDUE_SERVICES") autoAmountCents = Math.round(caFactures);
    const manualAmountCents = entryMap.has(line.lineCode) ? (entryMap.get(line.lineCode) ?? 0) : null;
    return {
      ...line,
      autoAmountCents,
      manualAmountCents,
      // Attach salary hint via autoAmountCents only when no manual override
      ...(line.lineCode === "SALAIRES" && manualAmountCents === null ? { autoHint: `Estimation Équipe : ${fmtEURFr(salaireHint)} (${Math.round(salaireHint / 100).toLocaleString("fr-FR")} €)` } : {}),
    };
  });
}

function computeTotals(lines: LineResult[]) {
  const val = (line: LineResult) => line.manualAmountCents !== null ? line.manualAmountCents : line.autoAmountCents;

  const sum = (section: PcgSection) => lines.filter(l => l.section === section).reduce((a, l) => a + val(l), 0);

  const totalProduitsExploit = sum("PRODUITS_EXPLOITATION");
  const totalChargesExploit  = sum("CHARGES_EXPLOITATION");
  const resultatExploit      = totalProduitsExploit - totalChargesExploit;

  const totalProduitsFinanciers = sum("PRODUITS_FINANCIERS");
  const totalChargesFinancieres = sum("CHARGES_FINANCIERES");
  const resultatFinancier       = totalProduitsFinanciers - totalChargesFinancieres;

  const resultatCourant = resultatExploit + resultatFinancier;

  const totalProduitsExcept = sum("PRODUITS_EXCEPTIONNELS");
  const totalChargesExcept  = sum("CHARGES_EXCEPTIONNELS");
  const resultatExceptionnel = totalProduitsExcept - totalChargesExcept;

  const participation = val(lines.find(l => l.lineCode === "PARTICIPATION_SALARIES")!);
  const impots        = val(lines.find(l => l.lineCode === "IMPOTS_BENEFICES")!);

  const resultatExercice = resultatCourant + resultatExceptionnel - participation - impots;

  return {
    totalProduitsExploit,
    totalChargesExploit,
    resultatExploit,
    totalProduitsFinanciers,
    totalChargesFinancieres,
    resultatFinancier,
    resultatCourant,
    totalProduitsExcept,
    totalChargesExcept,
    resultatExceptionnel,
    participation,
    impots,
    resultatExercice,
  };
}

// ── GET /compte-resultat ──────────────────────────────────────────────────

router.get("/compte-resultat", async (req, res): Promise<void> => {
  const parsed = PeriodQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { from, to } = parsed.data;

  const lines = await buildLineResults(from, to);
  const totals = computeTotals(lines);

  res.json({ from, to, periodKey: periodKey(from, to), lines, totals });
});

// ── PATCH /compte-resultat/lignes ─────────────────────────────────────────

const PatchLignesBody = z.object({
  periodKey: z.string().min(1),
  lines: z.array(z.object({
    lineCode:     z.string().min(1),
    amountCents:  z.number().int(),
  })),
});

router.patch("/compte-resultat/lignes", requireAuth, async (req, res): Promise<void> => {
  const parsed = PatchLignesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { periodKey: pKey, lines } = parsed.data;

  // Validate all lineCodes exist and are not auto-computed (those are read-only)
  for (const { lineCode } of lines) {
    const pcgLine = PCG_LINES.find(l => l.lineCode === lineCode);
    if (!pcgLine) {
      res.status(400).json({ error: `Unknown lineCode: ${lineCode}` }); return;
    }
    if (pcgLine.isAutoComputed) {
      res.status(400).json({ error: `lineCode ${lineCode} is auto-computed and cannot be overridden via this endpoint` }); return;
    }
  }

  for (const { lineCode, amountCents } of lines) {
    // Try update first, then insert (manual upsert for broad pg compatibility)
    const existing = await db.select().from(crEntriesTable)
      .where(and(eq(crEntriesTable.periodKey, pKey), eq(crEntriesTable.lineCode, lineCode)));

    if (existing.length > 0) {
      await db.update(crEntriesTable)
        .set({ amountCents, updatedAt: new Date() })
        .where(and(eq(crEntriesTable.periodKey, pKey), eq(crEntriesTable.lineCode, lineCode)));
    } else {
      await db.insert(crEntriesTable).values({ periodKey: pKey, lineCode, amountCents });
    }
  }

  res.json({ ok: true, saved: lines.length });
});

// ── GET /compte-resultat/export/pdf ──────────────────────────────────────

router.get("/compte-resultat/export/pdf", async (req, res): Promise<void> => {
  const parsed = PeriodQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { from, to } = parsed.data;

  const lines = await buildLineResults(from, to);
  const totals = computeTotals(lines);

  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  const periodLabel = `Exercice du ${fmtDate(from)} au ${fmtDate(to)}`;

  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, info: { Title: `Compte de Résultat — ${periodLabel}` } });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="compte-resultat-${from.slice(0, 4)}.pdf"`,
  );
  doc.pipe(res);

  // ── Header ──
  doc.fontSize(20).font("Helvetica-Bold").fillColor("#0a0a0a").text("NODAQ", 50, 50);
  doc.fontSize(10).font("Helvetica").fillColor("#555").text("Compte de Résultat — PCG", 50, 76);
  doc.fontSize(10).font("Helvetica").fillColor("#555").text(periodLabel, 50, 90);
  // Generated date (right aligned)
  const genDate = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  doc.fontSize(8).fillColor("#999").text(`Généré le ${genDate}`, 50, 90, { align: "right", width: 495 });
  doc.moveTo(50, 108).lineTo(545, 108).strokeColor("#e0e0e0").lineWidth(1).stroke();

  const COL_LABEL = 50;
  const COL_AMOUNT = 400;
  const COL_WIDTH_LABEL = 340;
  const ROW_H = 16;

  let y = 120;

  const checkPage = () => {
    if (y > 760) {
      doc.addPage();
      y = 50;
      // Footer is added via page event
    }
  };

  const drawSectionHeader = (title: string, bg: string) => {
    checkPage();
    doc.rect(50, y, 495, ROW_H + 2).fillColor(bg).fill();
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor("#fff").text(title, COL_LABEL + 4, y + 4, { width: COL_WIDTH_LABEL });
    y += ROW_H + 4;
  };

  const drawLine = (label: string, amountCents: number, isZero: boolean, indent = 0) => {
    checkPage();
    if (y % 2 === 0) {
      doc.rect(50, y - 1, 495, ROW_H).fillColor("#fafafa").fill();
    }
    doc.fontSize(7.5).font("Helvetica").fillColor(isZero ? "#ccc" : "#222")
      .text(label, COL_LABEL + 4 + indent, y + 3, { width: COL_WIDTH_LABEL - indent, ellipsis: true });
    if (!isZero) {
      doc.fontSize(7.5).font("Helvetica").fillColor("#111")
        .text(fmtEURFr(amountCents), COL_AMOUNT, y + 3, { width: 140, align: "right" });
    }
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

  // ── Produits d'exploitation ──
  drawSectionHeader("I — PRODUITS D'EXPLOITATION", "#1a237e");
  for (const l of linesBySection("PRODUITS_EXPLOITATION")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total I — Produits d'exploitation", totals.totalProduitsExploit);

  // ── Charges d'exploitation ──
  drawSectionHeader("II — CHARGES D'EXPLOITATION", "#4a148c");
  for (const l of linesBySection("CHARGES_EXPLOITATION")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total II — Charges d'exploitation", totals.totalChargesExploit);
  drawResult("RÉSULTAT D'EXPLOITATION (I − II)", totals.resultatExploit);

  // ── Produits financiers ──
  drawSectionHeader("IV — PRODUITS FINANCIERS", "#006064");
  for (const l of linesBySection("PRODUITS_FINANCIERS")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total IV — Produits financiers", totals.totalProduitsFinanciers);

  // ── Charges financières ──
  drawSectionHeader("V — CHARGES FINANCIÈRES", "#004d40");
  for (const l of linesBySection("CHARGES_FINANCIERES")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total V — Charges financières", totals.totalChargesFinancieres);
  drawResult("RÉSULTAT FINANCIER (IV − V)", totals.resultatFinancier);
  drawResult("RÉSULTAT COURANT AVANT IMPÔTS (I−II + IV−V)", totals.resultatCourant);

  // ── Produits exceptionnels ──
  drawSectionHeader("VII — PRODUITS EXCEPTIONNELS", "#bf360c");
  for (const l of linesBySection("PRODUITS_EXCEPTIONNELS")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total VII — Produits exceptionnels", totals.totalProduitsExcept);

  // ── Charges exceptionnelles ──
  drawSectionHeader("VIII — CHARGES EXCEPTIONNELLES", "#7f0000");
  for (const l of linesBySection("CHARGES_EXCEPTIONNELS")) drawLine(l.label, val(l), val(l) === 0, 8);
  drawSubtotal("Total VIII — Charges exceptionnelles", totals.totalChargesExcept);
  drawResult("RÉSULTAT EXCEPTIONNEL (VII − VIII)", totals.resultatExceptionnel);

  // ── Autres déductions ──
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

  // ── Footer ──
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fillColor("#bbb")
      .text(`Page ${i + 1} / ${pageCount}`, 50, 820, { align: "center", width: 495 });
  }

  doc.end();
});

// ── GET /compte-resultat/export/csv ──────────────────────────────────────

router.get("/compte-resultat/export/csv", async (req, res): Promise<void> => {
  const parsed = PeriodQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { from, to } = parsed.data;

  const lines = await buildLineResults(from, to);
  const totals = computeTotals(lines);

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

  // UTF-8 BOM for Excel compatibility
  const bom = "\uFEFF";
  const csv = bom + rows.join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="compte-resultat-${from.slice(0, 4)}.csv"`,
  );
  res.send(csv);
});

export default router;
