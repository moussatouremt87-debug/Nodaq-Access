import { useMemo } from 'react';
import {
  Briefcase,
  Euro,
  FileWarning,
  Users,
  Repeat,
  ShieldCheck,
  Wallet,
  TrendingUp,
  Check,
  X,
  Activity,
  ArrowUpRight,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { fmtEUR, fmtEURCompact, fmtMonth, fmtRelative } from '@/lib/format';
import {
  useCockpitKpis,
  useCockpitActivity,
  usePendingActions,
  useApproveAction,
  useRejectAction,
} from '@/hooks/use-cockpit';

export default function Cockpit() {
  const { data: kpis, isLoading: kpisLoading, isError: kpisError } = useCockpitKpis();
  const { data: activity, isLoading: activityLoading } = useCockpitActivity();
  const { data: pendingActions, isLoading: pendingLoading } = usePendingActions();
  const { approve, isPending: approving } = useApproveAction();
  const { reject, isPending: rejecting } = useRejectAction();

  const chartData = useMemo(
    () =>
      (kpis?.monthlySeries ?? []).map((m) => ({
        month: fmtMonth(m.month),
        revenue: m.revenueCents / 100,
        invoices: m.invoiceCount,
      })),
    [kpis?.monthlySeries],
  );

  const pending = (pendingActions ?? []).filter((a) => a.status === 'EN_ATTENTE');

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Vue d'ensemble"
        title="Cockpit"
        description="Le pilotage en temps réel de votre activité — trésorerie, affaires, factures et prospects."
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {kpisError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Impossible de charger les indicateurs. Réessayez dans un instant.
          </div>
        )}

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {kpisLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[110px] rounded-xl" />
            ))
          ) : (
            <>
              <KpiCard
                testId="kpi-affaires-en-cours"
                label="Affaires en cours"
                value={String(kpis?.affairesEnCours ?? 0)}
                icon={Briefcase}
                delay={0}
              />
              <KpiCard
                testId="kpi-ca-mois"
                label="CA du mois"
                value={fmtEURCompact(kpis?.chiffreAffairesMois)}
                icon={TrendingUp}
                tone="accent"
                delay={40}
              />
              <KpiCard
                testId="kpi-factures-attente"
                label="Factures en attente"
                value={String(kpis?.facturesEnAttente ?? 0)}
                hint={
                  kpis?.totalImpayeCents
                    ? `${fmtEUR(kpis.totalImpayeCents)} en retard`
                    : undefined
                }
                icon={FileWarning}
                tone={kpis?.totalImpayeCents ? 'warning' : 'default'}
                delay={80}
              />
              <KpiCard
                testId="kpi-prospects-pipeline"
                label="Prospects pipeline"
                value={String(kpis?.prospectsPipeline ?? 0)}
                icon={Users}
                delay={120}
              />
              <KpiCard
                testId="kpi-contrats-actifs"
                label="Contrats actifs"
                value={String(kpis?.contratsActifs ?? 0)}
                icon={Repeat}
                delay={160}
              />
              <KpiCard
                testId="kpi-actions-valider"
                label="Actions à valider"
                value={String(kpis?.pendingActionsCount ?? 0)}
                icon={ShieldCheck}
                tone={kpis?.pendingActionsCount ? 'warning' : 'default'}
                delay={200}
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Treasury + chart */}
          <div className="xl:col-span-2 space-y-4">
            <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                    Trésorerie disponible
                  </span>
                </div>
              </div>
              {kpisLoading ? (
                <Skeleton className="h-9 w-48 mt-2" />
              ) : (
                <div
                  className="font-mono-nums text-3xl md:text-4xl font-semibold tabular-nums text-foreground"
                  data-testid="text-treasury-balance"
                >
                  {kpis?.treasuryBalanceCents != null
                    ? fmtEUR(kpis.treasuryBalanceCents)
                    : '—'}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Chiffre d'affaires mensuel</span>
                </div>
              </div>
              {kpisLoading ? (
                <Skeleton className="h-56 w-full" />
              ) : chartData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
                  Pas encore de données de facturation.
                </div>
              ) : (
                <div className="h-56 -ml-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} barCategoryGap="28%">
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="hsl(var(--border))"
                      />
                      <XAxis
                        dataKey="month"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                        tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                      />
                      <Tooltip
                        cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                        contentStyle={{
                          background: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--popover-border))',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                        formatter={(value: number) => [
                          new Intl.NumberFormat('fr-FR', {
                            style: 'currency',
                            currency: 'EUR',
                            maximumFractionDigits: 0,
                          }).format(value),
                          'CA',
                        ]}
                      />
                      <Bar
                        dataKey="revenue"
                        radius={[4, 4, 0, 0]}
                        fill="hsl(var(--primary))"
                        maxBarSize={40}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Pending actions queue */}
          <div className="rounded-xl border border-card-border bg-card shadow-sm flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <span className="text-sm font-medium">Actions à valider</span>
              {pending.length > 0 && (
                <span className="font-mono-nums text-xs font-semibold text-chart-3 bg-chart-3/12 rounded-full px-2 py-0.5">
                  {pending.length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto max-h-[420px]">
              {pendingLoading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : pending.length === 0 ? (
                <Empty className="py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <ShieldCheck />
                    </EmptyMedia>
                    <EmptyTitle>Rien à valider</EmptyTitle>
                    <EmptyDescription>
                      Toutes les actions en attente ont été traitées.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {pending.map((action) => (
                    <li
                      key={action.id}
                      className="p-4 space-y-2"
                      data-testid={`pending-action-${action.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">
                            {action.label}
                          </div>
                          {action.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {action.description}
                            </div>
                          )}
                          {action.affaireLabel && (
                            <div className="text-[11px] text-muted-foreground/80 mt-1">
                              Affaire : {action.affaireLabel}
                            </div>
                          )}
                        </div>
                        {action.amountCents != null && (
                          <div className="font-mono-nums text-sm font-semibold shrink-0 tabular-nums">
                            {fmtEUR(action.amountCents)}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 px-2.5 text-xs gap-1 bg-primary"
                          disabled={approving || rejecting}
                          onClick={() => approve(action.id)}
                          data-testid={`button-approve-${action.id}`}
                        >
                          <Check className="h-3.5 w-3.5" /> Approuver
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs gap-1"
                          disabled={approving || rejecting}
                          onClick={() => reject(action.id)}
                          data-testid={`button-reject-${action.id}`}
                        >
                          <X className="h-3.5 w-3.5" /> Rejeter
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div className="rounded-xl border border-card-border bg-card shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <span className="text-sm font-medium">Activité récente</span>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </div>
          {activityLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !activity || activity.length === 0 ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Euro />
                </EmptyMedia>
                <EmptyTitle>Aucune activité pour le moment</EmptyTitle>
                <EmptyDescription>
                  Les événements liés à vos affaires, factures et prospects
                  apparaîtront ici.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                  data-testid={`activity-item-${item.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-foreground truncate">{item.label}</div>
                      {item.meta && (
                        <div className="text-xs text-muted-foreground truncate">
                          {item.meta}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono-nums shrink-0">
                    {fmtRelative(item.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
