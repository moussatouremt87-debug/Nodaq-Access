import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, FileBarChart, Users, Briefcase, Receipt, Percent,
  ChevronLeft, ChevronRight, Printer,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtEUR } from '@/lib/format';

import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type RapportSummary = {
  caMois: number; nouvellesAffaires: number; nouveauxClients: number;
  facturesEncaissees: number;
  /** null = aucune marge mesurée ce mois-ci. */
  tauxMarge: number | null;
  affairesMargeInconnue?: number;
};
type MargeAffaire = {
  id: string; label: string; clientName?: string | null; status: string;
  invoicedAmountCents?: number | null; marginCents?: number | null; marginPct?: number | null;
};
type RapportMensuel = {
  mois: string; summary: RapportSummary;
  topAffaires: MargeAffaire[];
  topClients: { clientName: string; totalCents: number }[];
};

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function fmtMois(mois: string) {
  const [y, m] = mois.split('-');
  return `${MONTHS_FR[parseInt(m) - 1]} ${y}`;
}

function currentMois() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function prevMois(mois: string) {
  const [y, m] = mois.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMois(mois: string) {
  const [y, m] = mois.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function useRapport(mois: string) {
  return useQuery({
    queryKey: ['rapport-mensuel', mois],
    queryFn: async () => {
      const res = await fetch(`${API}/rapports/mensuel?mois=${mois}`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<RapportMensuel>;
    },
  });
}

export default function RapportsPage() {
  const [mois, setMois] = useState(currentMois());
  const { data, isLoading, isError } = useRapport(mois);

  const isFuture = mois > currentMois();

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Finance"
        title="Rapport mensuel"
        description="Vue d'ensemble de l'activité de votre entreprise par mois."
        actions={
          <Button variant="outline" className="gap-1.5" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6 print:px-0">
        {/* Month selector */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setMois(prevMois(mois))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="rounded-lg border border-card-border bg-card px-5 py-2 font-semibold text-sm min-w-[180px] text-center">
            {fmtMois(mois)}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setMois(nextMois(mois))} disabled={isFuture}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {mois !== currentMois() && (
            <Button variant="ghost" size="sm" onClick={() => setMois(currentMois())}
              className="text-xs text-muted-foreground">
              Mois actuel
            </Button>
          )}
        </div>

        {isError && (
          <div className="p-8 text-center text-sm text-destructive">Impossible de charger le rapport.</div>
        )}

        {/* Summary KPIs */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible"
          className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {([
            { label: "CA du mois", icon: TrendingUp, value: data?.summary.caMois ?? 0,
              fmt: (v: number | null) => (v === null ? '—' : fmtEUR(v)), highlight: true },
            { label: "Nouvelles affaires", icon: Briefcase, value: data?.summary.nouvellesAffaires ?? 0,
              fmt: (v: number | null) => String(v ?? '—') },
            { label: "Nouveaux clients", icon: Users, value: data?.summary.nouveauxClients ?? 0,
              fmt: (v: number | null) => String(v ?? '—') },
            { label: "Factures encaissées", icon: Receipt, value: data?.summary.facturesEncaissees ?? 0,
              fmt: (v: number | null) => String(v ?? '—') },
            // Un taux inconnu affiché « 0,0 % » se lit « vous ne gagnez rien ».
            { label: "Taux de marge", icon: Percent, value: data?.summary.tauxMarge ?? null,
              fmt: (v: number | null) => (v === null ? 'Non mesuré' : `${v.toFixed(1)} %`) },
          ] satisfies ReadonlyArray<{
            label: string;
            icon: typeof Percent;
            value: number | null;
            fmt: (v: number | null) => string;
            highlight?: boolean;
          }>).map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <motion.div key={i} variants={itemVariants}
                className={`rounded-xl border p-4 ${
                  kpi.highlight ? 'border-primary/25 bg-primary/5' : 'border-card-border bg-card'
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-2">
                  <Icon className="h-3 w-3" /> {kpi.label}
                </div>
                {isLoading ? <Skeleton className="h-7 w-20" /> : (
                  <div className={`text-xl font-semibold font-mono-nums ${kpi.highlight ? 'text-primary' : ''}`}>
                    {kpi.fmt(kpi.value)}
                  </div>
                )}
              </motion.div>
            );
          })}
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Top affaires */}
          <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Top affaires</h2>
            </div>
            {isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (data?.topAffaires ?? []).length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Aucune affaire ce mois.</div>
            ) : (
              <div className="divide-y divide-border">
                {(data?.topAffaires ?? []).map((a, i) => (
                  <div key={a.id} className="flex items-center gap-3 px-5 py-3 hover-elevate">
                    <span className="text-xs font-mono-nums text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{a.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.clientName ?? '—'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono-nums text-sm font-semibold">
                        {a.invoicedAmountCents != null ? fmtEUR(a.invoicedAmountCents) : '—'}
                      </div>
                      {a.marginPct != null && (
                        <div className={`text-[11px] font-mono-nums ${
                          a.marginPct >= 30 ? 'text-primary' : a.marginPct >= 15 ? 'text-yellow-400' : 'text-destructive'
                        }`}>
                          {a.marginPct.toFixed(1)}% marge
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top clients */}
          <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Top clients</h2>
            </div>
            {isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (data?.topClients ?? []).length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Aucune facturation ce mois.</div>
            ) : (
              <div className="divide-y divide-border">
                {(data?.topClients ?? []).map((c, i) => {
                  const max = data?.topClients[0]?.totalCents ?? 1;
                  const pct = (c.totalCents / max) * 100;
                  return (
                    <div key={i} className="flex items-center gap-3 px-5 py-3 hover-elevate">
                      <span className="text-xs font-mono-nums text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="font-medium text-sm truncate">{c.clientName}</div>
                        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-sidebar-primary rounded-full"
                            style={{ width: `${pct}%`, transition: 'width 600ms ease' }} />
                        </div>
                      </div>
                      <div className="font-mono-nums text-sm font-semibold shrink-0">
                        {fmtEUR(c.totalCents)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
