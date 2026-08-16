import { Link } from 'wouter';
import { motion } from 'framer-motion';
import { LineChart as LineChartIcon, ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useGetPrevisionnelTresorerie } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtEUR, fmtDate } from '@/lib/format';
import { fadeScaleVariants } from '@/lib/motion-variants';

export default function PrevisionnelTresoreriePage() {
  const { data, isLoading, isError } = useGetPrevisionnelTresorerie();

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Finance"
        title="Prévisionnel de trésorerie"
        description="La trajectoire de votre solde sur les huit prochaines semaines, à partir de ce qui est déjà connu."
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : isError ? (
          <div className="p-8 text-center text-sm text-destructive">Impossible de charger le prévisionnel.</div>
        ) : data?.donneesInsuffisantes ? (
          <motion.div variants={fadeScaleVariants} initial="hidden" animate="visible"
            className="rounded-xl border border-card-border bg-card p-8 text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <LineChartIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <div className="font-medium text-foreground">Aucun compte bancaire connecté</div>
              <div className="text-sm text-muted-foreground max-w-md mx-auto">
                Le prévisionnel a besoin d'un solde de départ réel pour projeter votre trésorerie.
                Connectez votre compte bancaire pour l'activer.
              </div>
            </div>
            <Link href="/connecteurs">
              <Button className="gap-1.5">
                Connecter ma banque <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </motion.div>
        ) : (
          <>
            <motion.div variants={fadeScaleVariants} initial="hidden" animate="visible"
              className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground mb-4">
                Solde projeté
              </div>
              <div className="h-64 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data!.semaines.map(s => ({ semaine: fmtDate(s.debut), solde: (s.soldeFinCents ?? 0) / 100 }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="semaine" tickLine={false} axisLine={false}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tickLine={false} axisLine={false} width={56}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(v) => `${Math.round(v / 1000)}k€`} />
                    <Tooltip
                      cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
                      contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--popover-border))', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                      formatter={(value: number) => [
                        new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value),
                        'Solde',
                      ]}
                    />
                    <Line dataKey="solde" type="monotone" stroke="hsl(var(--primary))" strokeWidth={2}
                      dot={{ r: 3, fill: 'hsl(var(--primary))' }}
                      isAnimationActive={true} animationDuration={900} animationEasing="ease-out" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {data!.unpricedEcheancesCount > 0 && (
              <div className="rounded-lg bg-muted/50 border border-border p-3 text-sm text-muted-foreground">
                {data!.unpricedEcheancesCount} échéance{data!.unpricedEcheancesCount > 1 ? 's' : ''} à venir sans montant estimé —
                non comptée{data!.unpricedEcheancesCount > 1 ? 's' : ''} dans les sorties ci-dessus.
                Complétez-les dans l'Échéancier fiscal pour affiner le prévisionnel.
              </div>
            )}

            <div className="rounded-xl border border-card-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left font-medium px-4 py-3">Semaine</th>
                    <th className="text-right font-medium px-4 py-3">Entrées</th>
                    <th className="text-right font-medium px-4 py-3">Sorties</th>
                    <th className="text-right font-medium px-4 py-3">Solde fin de semaine</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.semaines.map((s, i) => (
                    <tr key={i} className="border-b border-card-border last:border-0">
                      <td className="px-4 py-3 text-foreground">{fmtDate(s.debut)} – {fmtDate(s.fin)}</td>
                      <td className="px-4 py-3 text-right font-mono-nums text-primary">
                        {s.entreesCents > 0 && <TrendingUp className="inline h-3 w-3 mr-1 -mt-0.5" />}
                        {fmtEUR(s.entreesCents)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-nums text-destructive">
                        {s.sortiesCents > 0 && <TrendingDown className="inline h-3 w-3 mr-1 -mt-0.5" />}
                        {fmtEUR(s.sortiesCents)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-nums font-semibold text-foreground">
                        {s.soldeFinCents != null ? fmtEUR(s.soldeFinCents) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
