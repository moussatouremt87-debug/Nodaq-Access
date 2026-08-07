/**
 * EvolutionChart — line/area chart for a single indicator series over time.
 *
 * Spec §10:
 *  - Ligne (aire si une seule série).
 *  - JAMAIS DE DOUBLE AXE.
 *  - Pas de légende quand il n'y a qu'une série (le titre suffit).
 * Spec §11:
 *  - Série principale : bleu #2a78d6.
 * Spec §12:
 *  - Infobulle au survol et à l'appui, cible tactile plus grande que la marque.
 *  - Graphiques pleine largeur.
 */
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import type { SeriePoint } from '@/hooks/use-analytics';
import { fmtEURCompact } from '@/lib/format';
import { Skeleton } from '@/components/ui/skeleton';

interface EvolutionChartProps {
  /** Monthly series from useIndicateurSerie. */
  data: SeriePoint[];
  loading?: boolean;
  /** Unit string from the indicator — determines Y-axis formatting. */
  unite?: string;
  /** Title shown above the chart (replaces legend for single series). */
  titre?: string;
}

const BLUE = '#2a78d6';
const GRID = '#e5e7eb';

function fmtValeur(v: number | null | undefined, unite?: string): string {
  if (v === null || v === undefined) return '—';
  if (unite?.includes('centimes')) return fmtEURCompact(v);
  if (unite?.includes('jours')) return `${v} j`;
  if (unite === '%') return `${v} %`;
  return String(v);
}

function CustomTooltip({
  active, payload, label, unite,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  unite?: string;
}) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-sm">
      <p className="text-muted-foreground text-xs mb-0.5">{label}</p>
      <p className="font-semibold text-foreground">{fmtValeur(val, unite)}</p>
    </div>
  );
}

export function EvolutionChart({ data, loading, unite, titre }: EvolutionChartProps) {
  if (loading) {
    return <Skeleton className="w-full h-48 rounded-xl" />;
  }

  // Only plot points that have real data
  const chartData = data.map((p) => ({
    label: p.periode.label,
    valeur: p.donneesInsuffisantes ? null : p.valeur,
  }));

  if (chartData.every((d) => d.valeur === null)) {
    return (
      <div className="w-full h-48 flex items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        Pas encore assez de données pour afficher l'évolution
      </div>
    );
  }

  const isCents = unite?.includes('centimes');
  const formatY = (v: number) =>
    isCents
      ? new Intl.NumberFormat('fr-FR', { notation: 'compact', style: 'currency', currency: 'EUR' }).format(v / 100)
      : String(v);

  return (
    <div className="w-full">
      {titre && (
        <p className="text-sm font-medium text-foreground mb-2">{titre}</p>
      )}
      {/* No legend — spec §12: "pas de légende quand il n'y a qu'une série" */}
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="grad-blue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={BLUE} stopOpacity={0.18} />
              <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={formatY}
          />
          <Tooltip
            content={<CustomTooltip unite={unite} />}
            cursor={{ stroke: BLUE, strokeWidth: 1, strokeDasharray: '4 4' }}
          />
          <Area
            type="monotone"
            dataKey="valeur"
            stroke={BLUE}
            strokeWidth={2}
            fill="url(#grad-blue)"
            dot={false}
            activeDot={{ r: 6, fill: BLUE, stroke: '#fff', strokeWidth: 2 }}
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      {/* Accessible table view — spec §12: "Une VUE TABLEAU est toujours accessible" */}
      <details className="mt-2">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors py-1">
          Voir en tableau
        </summary>
        <table className="mt-2 w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-muted-foreground py-1 pr-4 font-normal">Période</th>
              <th className="text-right text-muted-foreground py-1 font-normal">Valeur</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((d) => (
              <tr key={d.label} className="border-b border-border/50">
                <td className="py-1 pr-4 text-foreground">{d.label}</td>
                <td className="py-1 text-right tabular-nums text-foreground">
                  {fmtValeur(d.valeur, unite)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
