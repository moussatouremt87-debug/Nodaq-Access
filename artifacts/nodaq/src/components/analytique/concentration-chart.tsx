/**
 * ConcentrationChart — horizontal stacked bars showing client share of CA.
 *
 * Spec §10:
 *  - Répartition par client = barres horizontales empilées, JAMAIS de camembert.
 *  - Au-delà de 7 catégories, replier la queue dans « Autres ».
 *  - JAMAIS DE DOUBLE AXE.
 * Spec §11:
 *  - Série principale : bleu #2a78d6 et sa rampe.
 * Spec §12:
 *  - Pleine largeur, VUE TABLEAU accessible.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';

export interface ClientShare {
  client: string;
  pct: number;
}

interface ConcentrationChartProps {
  data: ClientShare[];
  loading?: boolean;
}

// Blue ramp for clients (spec §11: série principale bleu #2a78d6 et sa rampe)
const BLUE_RAMP = [
  '#2a78d6', '#4a90e2', '#6aaaf0', '#8ec3f9',
  '#b3d9ff', '#d6ecff', '#e8f4ff',
];

const MAX_VISIBLE = 7;

function CustomTooltip({
  active, payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number; payload: ClientShare }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-sm">
      <p className="font-medium text-foreground">{d?.payload.client}</p>
      <p className="text-muted-foreground">{d?.value} %</p>
    </div>
  );
}

export function ConcentrationChart({ data, loading }: ConcentrationChartProps) {
  if (loading) {
    return <Skeleton className="w-full h-40 rounded-xl" />;
  }

  if (!data.length) {
    return (
      <div className="w-full h-32 flex items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        Pas encore de données sur la période
      </div>
    );
  }

  // Fold tail into "Autres" beyond MAX_VISIBLE (spec §10)
  const sorted = [...data].sort((a, b) => b.pct - a.pct);
  let chartData: ClientShare[];
  if (sorted.length <= MAX_VISIBLE) {
    chartData = sorted;
  } else {
    const visible = sorted.slice(0, MAX_VISIBLE - 1);
    const autres = sorted.slice(MAX_VISIBLE - 1).reduce((acc, d) => acc + d.pct, 0);
    chartData = [...visible, { client: 'Autres', pct: Math.round(autres) }];
  }

  return (
    <div className="w-full">
      {/* Horizontal layout — spec §10: barres horizontales */}
      <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 36)}>
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
        >
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(v) => `${v} %`}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="client"
            width={110}
            tick={{ fontSize: 12, fill: '#374151' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="pct" radius={[0, 4, 4, 0]} maxBarSize={28}>
            {chartData.map((_, i) => (
              <Cell
                key={i}
                fill={BLUE_RAMP[Math.min(i, BLUE_RAMP.length - 1)]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Table view — spec §12 */}
      <details className="mt-2">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors py-1">
          Voir en tableau
        </summary>
        <table className="mt-2 w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-muted-foreground py-1 pr-4 font-normal">Client</th>
              <th className="text-right text-muted-foreground py-1 font-normal">Part du CA</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((d) => (
              <tr key={d.client} className="border-b border-border/50">
                <td className="py-1 pr-4 text-foreground">{d.client}</td>
                <td className="py-1 text-right tabular-nums text-foreground">{d.pct} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
