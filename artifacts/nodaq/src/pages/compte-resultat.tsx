import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileSpreadsheet, Download, FileDown, Info, Save, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { fmtEUR } from '@/lib/format';

const API = '/api';

// ── Types ─────────────────────────────────────────────────────────────────

type PcgSection =
  | 'PRODUITS_EXPLOITATION'
  | 'CHARGES_EXPLOITATION'
  | 'PRODUITS_FINANCIERS'
  | 'CHARGES_FINANCIERES'
  | 'PRODUITS_EXCEPTIONNELS'
  | 'CHARGES_EXCEPTIONNELS'
  | 'AUTRES';

type PcgLineData = {
  lineCode: string;
  label: string;
  section: PcgSection;
  isAutoComputed?: boolean;
  autoHint?: string;
  autoAmountCents: number;
  manualAmountCents: number | null;
};

type Totals = {
  totalProduitsExploit: number;
  totalChargesExploit: number;
  resultatExploit: number;
  totalProduitsFinanciers: number;
  totalChargesFinancieres: number;
  resultatFinancier: number;
  resultatCourant: number;
  totalProduitsExcept: number;
  totalChargesExcept: number;
  resultatExceptionnel: number;
  participation: number;
  impots: number;
  resultatExercice: number;
};

type CrData = {
  from: string;
  to: string;
  periodKey: string;
  lines: PcgLineData[];
  totals: Totals;
};

// ── Period helpers ────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

function yearPeriod(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function fmtDateFr(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ── Data fetching ─────────────────────────────────────────────────────────

function useCr(from: string, to: string) {
  return useQuery<CrData>({
    queryKey: ['compte-resultat', from, to],
    queryFn: async () => {
      const res = await fetch(`${API}/compte-resultat?from=${from}&to=${to}`);
      if (!res.ok) throw new Error('Échec du chargement');
      return res.json();
    },
  });
}

// ── Formatting ────────────────────────────────────────────────────────────

function fmtAmountInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function parseAmountInput(raw: string): number {
  // Accept "1 234,56" or "1234.56" or "1234,56"
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  if (Number.isNaN(val)) return 0;
  return Math.round(val * 100);
}

function fmtResult(cents: number): string {
  return fmtEUR(Math.abs(cents));
}

// ── Section display config ────────────────────────────────────────────────

type SectionCfg = {
  key: PcgSection;
  title: string;
  roman: string;
  color: string;
  bgClass: string;
};

const SECTIONS: SectionCfg[] = [
  { key: 'PRODUITS_EXPLOITATION',  roman: 'I',    title: 'Produits d\'exploitation',  color: '#1a237e', bgClass: 'bg-[#1a237e]' },
  { key: 'CHARGES_EXPLOITATION',   roman: 'II',   title: 'Charges d\'exploitation',   color: '#4a148c', bgClass: 'bg-[#4a148c]' },
  { key: 'PRODUITS_FINANCIERS',    roman: 'IV',   title: 'Produits financiers',        color: '#006064', bgClass: 'bg-[#006064]' },
  { key: 'CHARGES_FINANCIERES',    roman: 'V',    title: 'Charges financières',        color: '#004d40', bgClass: 'bg-[#004d40]' },
  { key: 'PRODUITS_EXCEPTIONNELS', roman: 'VII',  title: 'Produits exceptionnels',     color: '#bf360c', bgClass: 'bg-[#bf360c]' },
  { key: 'CHARGES_EXCEPTIONNELS',  roman: 'VIII', title: 'Charges exceptionnelles',    color: '#7f0000', bgClass: 'bg-[#7f0000]' },
  { key: 'AUTRES',                 roman: '',     title: 'Autres déductions',          color: '#37474f', bgClass: 'bg-[#37474f]' },
];

// ── Sub-components ────────────────────────────────────────────────────────

function AmountCell({ cents, muted = false }: { cents: number; muted?: boolean }) {
  if (cents === 0 && muted) {
    return <span className="text-muted-foreground/40 font-mono-nums text-xs">—</span>;
  }
  const negative = cents < 0;
  return (
    <span className={`font-mono-nums text-sm tabular-nums ${negative ? 'text-destructive' : ''}`}>
      {fmtEUR(cents)}
    </span>
  );
}

function ResultBadge({ cents, label }: { cents: number; label: string }) {
  const positive = cents >= 0;
  return (
    <div className={`flex items-center justify-between px-4 py-3 rounded-lg border ${
      positive
        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
        : 'bg-destructive/10 border-destructive/20 text-destructive'
    }`}>
      <span className="font-semibold text-sm">{label}</span>
      <span className="font-mono-nums font-bold text-base">
        {cents < 0 && '−\u200a'}{fmtResult(cents)}
      </span>
    </div>
  );
}

type EditMap = Map<string, number | null>;

function LineRow({
  line,
  editMap,
  onEdit,
}: {
  line: PcgLineData;
  editMap: EditMap;
  onEdit: (code: string, cents: number | null) => void;
}) {
  const storedCents = editMap.has(line.lineCode)
    ? editMap.get(line.lineCode)!
    : (line.manualAmountCents !== null ? line.manualAmountCents : line.autoAmountCents);

  const [inputVal, setInputVal] = useState<string>(() =>
    storedCents === 0 ? '' : fmtAmountInput(storedCents),
  );
  const [focused, setFocused] = useState(false);

  const currentCents = editMap.has(line.lineCode)
    ? (editMap.get(line.lineCode) ?? 0)
    : (line.manualAmountCents !== null ? line.manualAmountCents : line.autoAmountCents);

  if (line.isAutoComputed) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 last:border-0 bg-muted/20">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-foreground flex items-center gap-1.5">
            {line.label}
            {line.autoHint && (
              <span title={line.autoHint} className="cursor-help">
                <Info className="h-3 w-3 text-muted-foreground/60" />
              </span>
            )}
          </div>
          {line.autoHint && (
            <div className="text-[11px] text-muted-foreground/70 mt-0.5">{line.autoHint}</div>
          )}
        </div>
        <div className="shrink-0 w-40 text-right">
          <AmountCell cents={line.autoAmountCents} muted={line.autoAmountCents === 0} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 last:border-0 hover:bg-muted/10 group">
      <div className="flex-1 min-w-0">
        <span className="text-sm text-foreground leading-tight">{line.label}</span>
      </div>
      <div className="shrink-0 w-40 flex justify-end">
        {focused ? (
          <input
            type="text"
            className="w-full text-right font-mono-nums text-sm border border-primary/40 rounded px-2 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onBlur={() => {
              setFocused(false);
              const cents = parseAmountInput(inputVal);
              setInputVal(cents === 0 ? '' : fmtAmountInput(cents));
              onEdit(line.lineCode, cents);
            }}
            onFocus={e => e.target.select()}
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setFocused(true);
              setInputVal(currentCents === 0 ? '' : fmtAmountInput(currentCents));
            }}
            className={`w-full text-right font-mono-nums text-sm px-2 py-0.5 rounded cursor-text hover:bg-muted/30 transition-colors ${
              currentCents === 0 ? 'text-muted-foreground/40' : ''
            }`}
          >
            {currentCents === 0 ? '—' : fmtEUR(currentCents)}
          </button>
        )}
      </div>
    </div>
  );
}

function SectionBlock({
  cfg,
  lines,
  subtotalLabel,
  subtotalCents,
  editMap,
  onEdit,
  defaultOpen = true,
}: {
  cfg: SectionCfg;
  lines: PcgLineData[];
  subtotalLabel: string;
  subtotalCents: number;
  editMap: EditMap;
  onEdit: (code: string, cents: number | null) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-card-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left text-white font-semibold text-sm"
        style={{ backgroundColor: cfg.color }}
      >
        <span>{cfg.roman && `${cfg.roman} — `}{cfg.title}</span>
        {open ? <ChevronDown className="h-4 w-4 opacity-70" /> : <ChevronRight className="h-4 w-4 opacity-70" />}
      </button>

      {open && (
        <>
          <div className="divide-y divide-border/30">
            {lines.map(l => (
              <LineRow key={l.lineCode} line={l} editMap={editMap} onEdit={onEdit} />
            ))}
          </div>

          {/* Subtotal row */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-t border-border font-semibold text-sm">
            <span className="text-foreground">{subtotalLabel}</span>
            <AmountCell cents={subtotalCents} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function CompteResultat() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // Period state
  const [mode, setMode] = useState<'year' | 'custom'>('year');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [customFrom, setCustomFrom] = useState(`${CURRENT_YEAR}-01-01`);
  const [customTo, setCustomTo]     = useState(`${CURRENT_YEAR}-12-31`);

  const { from, to } = useMemo(() => {
    if (mode === 'year') return yearPeriod(year);
    return { from: customFrom, to: customTo };
  }, [mode, year, customFrom, customTo]);

  const { data, isLoading, isError } = useCr(from, to);

  // Local edit map: lineCode → cents override.
  // The map is scoped to a single period. When the active period changes the
  // map is cleared so edits from period A never bleed into period B.
  const [editMap, setEditMap] = useState<EditMap>(new Map());

  // Track the period the current editMap belongs to.
  const activePeriodKey = `${from}:${to}`;
  const editPeriodKeyRef = useRef<string>(activePeriodKey);

  // Whenever the active period changes, discard any stale draft.
  // The ref update happens synchronously in render so the effect always sees
  // the old value on the first render of a new period.
  useEffect(() => {
    if (editPeriodKeyRef.current !== activePeriodKey) {
      editPeriodKeyRef.current = activePeriodKey;
      setEditMap(new Map());
    }
  }, [activePeriodKey]);

  const isDirty = editMap.size > 0;

  // Guard period changes: confirm if there are unsaved edits, then apply.
  const changePeriod = useCallback((apply: () => void) => {
    if (isDirty) {
      const ok = window.confirm(
        'Vous avez des modifications non enregistrées. Changer de période les annulera. Continuer ?',
      );
      if (!ok) return;
      setEditMap(new Map());
    }
    apply();
  }, [isDirty]);

  const handleEdit = useCallback((code: string, cents: number | null) => {
    setEditMap(prev => {
      const next = new Map(prev);
      next.set(code, cents ?? 0);
      return next;
    });
  }, []);

  // Recompute totals locally from editMap + server data
  const totals = useMemo<Totals | null>(() => {
    if (!data) return null;
    const val = (l: PcgLineData) => {
      if (editMap.has(l.lineCode)) return editMap.get(l.lineCode) ?? 0;
      return l.manualAmountCents !== null ? l.manualAmountCents : l.autoAmountCents;
    };
    const sum = (section: PcgSection) =>
      data.lines.filter(l => l.section === section).reduce((a, l) => a + val(l), 0);

    const totalProduitsExploit   = sum('PRODUITS_EXPLOITATION');
    const totalChargesExploit    = sum('CHARGES_EXPLOITATION');
    const resultatExploit        = totalProduitsExploit - totalChargesExploit;
    const totalProduitsFinanciers = sum('PRODUITS_FINANCIERS');
    const totalChargesFinancieres = sum('CHARGES_FINANCIERES');
    const resultatFinancier      = totalProduitsFinanciers - totalChargesFinancieres;
    const resultatCourant        = resultatExploit + resultatFinancier;
    const totalProduitsExcept    = sum('PRODUITS_EXCEPTIONNELS');
    const totalChargesExcept     = sum('CHARGES_EXCEPTIONNELS');
    const resultatExceptionnel   = totalProduitsExcept - totalChargesExcept;
    const participation = val(data.lines.find(l => l.lineCode === 'PARTICIPATION_SALARIES')!);
    const impots        = val(data.lines.find(l => l.lineCode === 'IMPOTS_BENEFICES')!);
    const resultatExercice = resultatCourant + resultatExceptionnel - participation - impots;

    return {
      totalProduitsExploit, totalChargesExploit, resultatExploit,
      totalProduitsFinanciers, totalChargesFinancieres, resultatFinancier,
      resultatCourant, totalProduitsExcept, totalChargesExcept,
      resultatExceptionnel, participation, impots, resultatExercice,
    };
  }, [data, editMap]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('No data');
      // Collect all lines including those NOT in editMap (persist all)
      const allLines = data.lines.map(l => ({
        lineCode: l.lineCode,
        amountCents: editMap.has(l.lineCode)
          ? (editMap.get(l.lineCode) ?? 0)
          : (l.manualAmountCents !== null ? l.manualAmountCents : l.autoAmountCents),
      })).filter(l => !data.lines.find(dl => dl.lineCode === l.lineCode)?.isAutoComputed);

      const res = await fetch(`${API}/compte-resultat/lignes`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodKey: data.periodKey, lines: allLines }),
      });
      if (!res.ok) throw new Error('Échec de la sauvegarde');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Enregistré', description: 'Les charges ont été sauvegardées pour cette période.' });
      setEditMap(new Map());
      qc.invalidateQueries({ queryKey: ['compte-resultat', from, to] });
    },
    onError: () => {
      toast({ title: 'Erreur', description: 'Impossible de sauvegarder.', variant: 'destructive' });
    },
  });

  const handleExportPdf = () => {
    window.open(`${API}/compte-resultat/export/pdf?from=${from}&to=${to}`, '_blank');
  };

  const handleExportCsv = () => {
    window.open(`${API}/compte-resultat/export/csv?from=${from}&to=${to}`, '_blank');
  };

  const linesBySection = (section: PcgSection) =>
    (data?.lines ?? []).filter(l => l.section === section);

  const years = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

  return (
    <div className="pb-20">
      <PageHeader
        eyebrow="Finance"
        title="Compte de Résultat"
        description="Plan Comptable Général — exercice fiscal complet."
        actions={
          <div className="flex items-center gap-2">
            {isDirty && (
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                size="sm"
                className="gap-1.5"
              >
                {saveMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Save className="h-4 w-4" />}
                Enregistrer
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportCsv}>
              <FileDown className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPdf}>
              <Download className="h-4 w-4" /> PDF
            </Button>
          </div>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6 max-w-5xl">

        {/* Period selector */}
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-border overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => changePeriod(() => setMode('year'))}
                className={`px-3 py-1.5 transition-colors ${mode === 'year' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/40'}`}
              >
                Exercice annuel
              </button>
              <button
                type="button"
                onClick={() => changePeriod(() => setMode('custom'))}
                className={`px-3 py-1.5 border-l border-border transition-colors ${mode === 'custom' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/40'}`}
              >
                Plage libre
              </button>
            </div>

            {mode === 'year' ? (
              <div className="flex items-center gap-1">
                {years.map(y => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => changePeriod(() => setYear(y))}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      y === year ? 'bg-primary/15 text-primary border border-primary/25' : 'hover:bg-muted/30'
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => { const v = e.target.value; changePeriod(() => setCustomFrom(v)); }}
                  className="border border-border rounded px-2 py-1 bg-background text-sm"
                />
                <span className="text-muted-foreground">→</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => { const v = e.target.value; changePeriod(() => setCustomTo(v)); }}
                  className="border border-border rounded px-2 py-1 bg-background text-sm"
                />
              </div>
            )}
          </div>

          {data && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Période : {fmtDateFr(from)} au {fmtDateFr(to)}
              <span className="ml-2 text-muted-foreground/50">Cliquez sur un montant pour le modifier.</span>
            </div>
          )}
        </div>

        {isError && (
          <div className="p-8 text-center text-sm text-destructive">
            Impossible de charger les données. Vérifiez les paramètres de période.
          </div>
        )}

        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        )}

        {data && totals && (
          <div className="space-y-4">

            {/* I — Produits d'exploitation */}
            <SectionBlock
              cfg={SECTIONS[0]!}
              lines={linesBySection('PRODUITS_EXPLOITATION')}
              subtotalLabel="Total I — Produits d'exploitation"
              subtotalCents={totals.totalProduitsExploit}
              editMap={editMap}
              onEdit={handleEdit}
            />

            {/* II — Charges d'exploitation */}
            <SectionBlock
              cfg={SECTIONS[1]!}
              lines={linesBySection('CHARGES_EXPLOITATION')}
              subtotalLabel="Total II — Charges d'exploitation"
              subtotalCents={totals.totalChargesExploit}
              editMap={editMap}
              onEdit={handleEdit}
            />

            <ResultBadge cents={totals.resultatExploit} label="Résultat d'exploitation (I − II)" />

            {/* IV — Produits financiers */}
            <SectionBlock
              cfg={SECTIONS[2]!}
              lines={linesBySection('PRODUITS_FINANCIERS')}
              subtotalLabel="Total IV — Produits financiers"
              subtotalCents={totals.totalProduitsFinanciers}
              editMap={editMap}
              onEdit={handleEdit}
              defaultOpen={false}
            />

            {/* V — Charges financières */}
            <SectionBlock
              cfg={SECTIONS[3]!}
              lines={linesBySection('CHARGES_FINANCIERES')}
              subtotalLabel="Total V — Charges financières"
              subtotalCents={totals.totalChargesFinancieres}
              editMap={editMap}
              onEdit={handleEdit}
              defaultOpen={false}
            />

            <ResultBadge cents={totals.resultatFinancier} label="Résultat financier (IV − V)" />
            <ResultBadge cents={totals.resultatCourant}   label="Résultat courant avant impôts (I−II + IV−V)" />

            {/* VII — Produits exceptionnels */}
            <SectionBlock
              cfg={SECTIONS[4]!}
              lines={linesBySection('PRODUITS_EXCEPTIONNELS')}
              subtotalLabel="Total VII — Produits exceptionnels"
              subtotalCents={totals.totalProduitsExcept}
              editMap={editMap}
              onEdit={handleEdit}
              defaultOpen={false}
            />

            {/* VIII — Charges exceptionnelles */}
            <SectionBlock
              cfg={SECTIONS[5]!}
              lines={linesBySection('CHARGES_EXCEPTIONNELS')}
              subtotalLabel="Total VIII — Charges exceptionnelles"
              subtotalCents={totals.totalChargesExcept}
              editMap={editMap}
              onEdit={handleEdit}
              defaultOpen={false}
            />

            <ResultBadge cents={totals.resultatExceptionnel} label="Résultat exceptionnel (VII − VIII)" />

            {/* Autres déductions */}
            <SectionBlock
              cfg={SECTIONS[6]!}
              lines={linesBySection('AUTRES')}
              subtotalLabel="Total — Participation + IS"
              subtotalCents={totals.participation + totals.impots}
              editMap={editMap}
              onEdit={handleEdit}
              defaultOpen={true}
            />

            {/* Final result */}
            <div className={`rounded-xl border-2 p-5 ${
              totals.resultatExercice >= 0
                ? 'border-emerald-500/40 bg-emerald-500/8'
                : 'border-destructive/40 bg-destructive/8'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                    Résultat de l'exercice
                  </div>
                  <div className={`text-lg font-bold ${
                    totals.resultatExercice >= 0 ? 'text-emerald-400' : 'text-destructive'
                  }`}>
                    {totals.resultatExercice >= 0 ? 'Bénéfice' : 'Perte'}
                  </div>
                </div>
                <div className={`text-3xl font-bold font-mono-nums tabular-nums ${
                  totals.resultatExercice >= 0 ? 'text-emerald-400' : 'text-destructive'
                }`}>
                  {totals.resultatExercice < 0 && '−\u200a'}{fmtResult(totals.resultatExercice)}
                </div>
              </div>
            </div>

            {/* Action bar — repeat at bottom */}
            <div className="flex justify-end gap-2 pt-2">
              {isDirty && (
                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                  className="gap-1.5"
                >
                  {saveMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Save className="h-4 w-4" />}
                  Enregistrer les charges
                </Button>
              )}
              <Button variant="outline" className="gap-1.5" onClick={handleExportCsv}>
                <FileDown className="h-4 w-4" /> Exporter CSV
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={handleExportPdf}>
                <Download className="h-4 w-4" /> Télécharger PDF
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
