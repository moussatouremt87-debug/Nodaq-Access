import { useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, BarChart3, Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { fmtEUR } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';
import { useVertical } from '@/hooks/use-vertical';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);


const API = '/api';

type MargeAffaire = {
  id: string; label: string; clientName?: string | null; status: string;
  invoicedAmountCents?: number | null; marginCents?: number | null; marginPct?: number | null;
};
type MargeMensuelle = { month: string; revenueCents: number; marginCents: number };
type MargeStats = {
  totalRevenueCents: number;
  /** null = aucune marge mesurée sur la période. */
  totalMarginCents: number | null;
  marginPct: number | null;
  affairesMargeInconnue?: number;
  affaires: MargeAffaire[]; mensuelle: MargeMensuelle[];
};

function useMargeStats(statut?: string) {
  return useQuery({
    queryKey: ['marge', statut],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (statut) sp.set('statut', statut);
      const res = await fetch(`${API}/marge?${sp}`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<MargeStats>;
    },
  });
}

const STATUT_OPTIONS = [
  { value: 'ALL', label: 'Tous les statuts' },
  { value: 'EN_COURS', label: 'En cours' },
  { value: 'TERMINEE', label: 'Terminées' },
  { value: 'ACCEPTEE', label: 'Acceptées' },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-card-border bg-card shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name === 'CA' ? 'Chiffre d\'affaires' : 'Marge'} : {fmtEUR(p.value)}
        </p>
      ))}
    </div>
  );
};

export default function MargePage() {
  const { words } = useVertical();
  const feminin = words.indefinite.startsWith('une ');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const { data, isLoading, isError } = useMargeStats(statusFilter !== 'ALL' ? statusFilter : undefined);

  const chartData = (data?.mensuelle ?? []).map(m => ({
    month: m.month.replace(/^(\d{4})-(\d{2})$/, (_, y, mo) => {
      const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
      return months[parseInt(mo) - 1] ?? mo;
    }),
    CA: m.revenueCents,
    Marge: m.marginCents,
  }));

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Finance"
        title="Marge"
        description={`Analysez votre rentabilité par ${words.singular} et par période.`}
        actions={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48 gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {/* KPI cards */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible"
          className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <motion.div variants={itemVariants} className="rounded-xl border border-card-border bg-card p-5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-3">
              <BarChart3 className="h-3.5 w-3.5" /> Chiffre d'affaires
            </div>
            {isLoading ? <Skeleton className="h-8 w-32" /> : (
              <div className="text-2xl font-semibold font-mono-nums">{fmtEUR(data?.totalRevenueCents ?? 0)}</div>
            )}
          </motion.div>

          <motion.div variants={itemVariants} className={`rounded-xl border p-5 ${
            data?.totalMarginCents == null
              ? 'border-card-border bg-card'
              : data.totalMarginCents >= 0
                ? 'border-primary/25 bg-primary/5'
                : 'border-destructive/25 bg-destructive/5'
          }`}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-3">
              {data?.totalMarginCents == null
                ? <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                : data.totalMarginCents >= 0
                  ? <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  : <TrendingDown className="h-3.5 w-3.5 text-destructive" />
              }
              Marge brute
            </div>
            {isLoading ? <Skeleton className="h-8 w-32" /> : data?.totalMarginCents == null ? (
              /* Une marge inconnue affichée « 0 € » se lit « ce chantier n'a rien
                 rapporté ». On dit qu'elle n'est pas mesurée. */
              <div className="text-base font-medium text-muted-foreground">Non mesurée</div>
            ) : (
              <div className={`text-2xl font-semibold font-mono-nums ${data.totalMarginCents >= 0 ? 'text-primary' : 'text-destructive'}`}>
                {fmtEUR(data.totalMarginCents)}
              </div>
            )}
          </motion.div>

          <motion.div variants={itemVariants} className="rounded-xl border border-card-border bg-card p-5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-3">
              <TrendingUp className="h-3.5 w-3.5" /> Taux de marge (sur facturé)
            </div>
            {isLoading ? <Skeleton className="h-8 w-20" /> : data?.marginPct == null ? (
              <div className="text-base font-medium text-muted-foreground">Non mesuré</div>
            ) : (
              <div className={`text-2xl font-semibold font-mono-nums ${
                data.marginPct >= 30 ? 'text-primary' : data.marginPct >= 15 ? 'text-yellow-400' : 'text-destructive'
              }`}>
                {data.marginPct.toFixed(1)} %
              </div>
            )}
            {!isLoading && (data?.affairesMargeInconnue ?? 0) > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                {data!.affairesMargeInconnue} {words.singular}(s) sans marge mesuré{feminin ? 'e' : ''}(s), exclu{feminin ? 'e' : ''}(s) du calcul
              </div>
            )}
          </motion.div>
        </motion.div>

        {/* Chart */}
        {chartData.length > 0 && (
          <div className="rounded-xl border border-card-border bg-card p-5">
            <h2 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wide">
              Évolution mensuelle (CA vs Marge)
            </h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid vertical={false} strokeDasharray="3 3"
                  stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => `${(v / 100).toFixed(0)} €`}
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="CA" name="CA" fill="hsl(var(--muted-foreground))" opacity={0.4}
                  radius={[4, 4, 0, 0]} animationDuration={900} />
                <Bar dataKey="Marge" name="Marge" fill="hsl(var(--sidebar-primary))"
                  radius={[4, 4, 0, 0]} animationDuration={900} animationBegin={200} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-medium">Détail par {words.singular}</h2>
          </div>
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-destructive">Impossible de charger les données.</div>
          ) : (data?.affaires ?? []).length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {words.noneLabel} avec données de marge pour ce filtre.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">{capitalize(words.singular)}</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium text-right">CA facturé</th>
                  <th className="px-4 py-3 font-medium text-right">Marge (€)</th>
                  <th className="px-4 py-3 font-medium text-right">Marge (% facturé)</th>
                </tr>
              </thead>
              <tbody>
                {(data?.affaires ?? []).map(a => {
                  const pct = a.marginPct ?? 0;
                  return (
                    <tr key={a.id} className="border-b border-border last:border-0 hover-elevate">
                      <td className="px-5 py-3 font-medium text-foreground">{a.label}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.clientName ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono-nums tabular-nums">
                        {a.invoicedAmountCents != null ? fmtEUR(a.invoicedAmountCents) : '—'}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono-nums tabular-nums ${
                        (a.marginCents ?? 0) >= 0 ? 'text-primary' : 'text-destructive'
                      }`}>
                        {a.marginCents != null ? fmtEUR(a.marginCents) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {a.marginPct != null ? (
                          <div className="inline-flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${
                                pct >= 30 ? 'bg-primary' : pct >= 15 ? 'bg-yellow-400' : 'bg-destructive'
                              }`}
                                style={{ width: `${Math.min(Math.abs(pct), 100)}%` }} />
                            </div>
                            <span className={`font-mono-nums tabular-nums text-xs ${
                              pct >= 30 ? 'text-primary' : pct >= 15 ? 'text-yellow-400' : 'text-destructive'
                            }`}>
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
