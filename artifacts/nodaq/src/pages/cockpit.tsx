import { useMemo, useState, useCallback } from 'react';
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
  RefreshCw,
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
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCockpitKpisQueryKey,
  getGetCockpitActivityQueryKey,
  getListPendingActionsQueryKey,
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { AnimatedKpi } from '@/components/animated-kpi';
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
  containerVariants,
  itemVariants,
  slideRightVariants,
  fadeScaleVariants,
} from '@/lib/motion-variants';
import {
  useCockpitKpis,
  useCockpitActivity,
  usePendingActions,
  useApproveAction,
  useRejectAction,
} from '@/hooks/use-cockpit';

/** Formats a plain integer count for the animated counter */
const fmtCount = (n: number) => String(n);

/** Formats cents as a compact EUR string at each animation frame */
const fmtCentsCompact = (n: number) =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    notation: Math.abs(n / 100) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(n / 100) >= 10000 ? 1 : 0,
  }).format(n / 100);

export default function Cockpit() {
  const queryClient = useQueryClient();
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetCockpitKpisQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetCockpitActivityQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() }),
    ]);
    setRefreshKey((k) => k + 1);
    setIsRefreshing(false);
  }, [queryClient]);

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Vue d'ensemble"
        title="Cockpit"
        description="Le pilotage en temps réel de votre activité — trésorerie, affaires, factures et prospects."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={handleRefresh}
            disabled={isRefreshing}
            data-testid="button-refresh"
          >
            <motion.span
              animate={isRefreshing ? { rotate: 360 } : { rotate: 0 }}
              transition={isRefreshing ? { repeat: Infinity, duration: 0.7, ease: 'linear' } : {}}
              className="flex"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </motion.span>
            Actualiser
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {kpisError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            Impossible de charger les indicateurs. Réessayez dans un instant.
          </motion.div>
        )}

        {/* KPI grid — remount on refresh to re-run stagger */}
        <motion.div
          key={refreshKey}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3"
        >
          {kpisLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[110px] rounded-xl" />
            ))
          ) : (
            <>
              <AnimatedKpi
                testId="kpi-affaires-en-cours"
                label="Affaires en cours"
                target={kpis?.affairesEnCours ?? 0}
                format={fmtCount}
                icon={Briefcase}
              />
              <AnimatedKpi
                testId="kpi-ca-mois"
                label="CA du mois"
                target={kpis?.chiffreAffairesMois ?? 0}
                format={fmtCentsCompact}
                icon={TrendingUp}
                tone="accent"
              />
              <AnimatedKpi
                testId="kpi-factures-attente"
                label="Factures en attente"
                target={kpis?.facturesEnAttente ?? 0}
                format={fmtCount}
                hint={
                  kpis?.totalImpayeCents
                    ? `${fmtEUR(kpis.totalImpayeCents)} en retard`
                    : undefined
                }
                icon={FileWarning}
                tone={kpis?.totalImpayeCents ? 'warning' : 'default'}
              />
              <AnimatedKpi
                testId="kpi-prospects-pipeline"
                label="Prospects pipeline"
                target={kpis?.prospectsPipeline ?? 0}
                format={fmtCount}
                icon={Users}
              />
              <AnimatedKpi
                testId="kpi-contrats-actifs"
                label="Contrats actifs"
                target={kpis?.contratsActifs ?? 0}
                format={fmtCount}
                icon={Repeat}
              />
              <AnimatedKpi
                testId="kpi-actions-valider"
                label="Actions à valider"
                target={kpis?.pendingActionsCount ?? 0}
                format={fmtCount}
                icon={ShieldCheck}
                tone={kpis?.pendingActionsCount ? 'warning' : 'default'}
              />
            </>
          )}
        </motion.div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Treasury + chart */}
          <div className="xl:col-span-2 space-y-4">
            {/* Treasury card */}
            <motion.div
              variants={fadeScaleVariants}
              initial="hidden"
              animate="visible"
              className="rounded-xl border border-card-border bg-card p-5 shadow-sm"
            >
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
            </motion.div>

            {/* Revenue chart */}
            <motion.div
              variants={fadeScaleVariants}
              initial="hidden"
              animate="visible"
              transition={{ delay: 0.1 }}
              className="rounded-xl border border-card-border bg-card p-5 shadow-sm"
            >
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
                        isAnimationActive={true}
                        animationDuration={900}
                        animationEasing="ease-out"
                        animationBegin={200}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </motion.div>
          </div>

          {/* Pending actions queue */}
          <motion.div
            variants={fadeScaleVariants}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.18 }}
            className="rounded-xl border border-card-border bg-card shadow-sm flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <span className="text-sm font-medium">Actions à valider</span>
              <AnimatePresence mode="popLayout">
                {pending.length > 0 && (
                  <motion.span
                    key={pending.length}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                    className="font-mono-nums text-xs font-semibold text-chart-3 bg-chart-3/12 rounded-full px-2 py-0.5"
                  >
                    {pending.length}
                  </motion.span>
                )}
              </AnimatePresence>
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
                <motion.ul
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="divide-y divide-border"
                >
                  <AnimatePresence>
                    {pending.map((action) => (
                      <motion.li
                        key={action.id}
                        variants={slideRightVariants}
                        exit={{ x: 16, opacity: 0, transition: { duration: 0.2 } }}
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
                          <motion.div whileTap={{ scale: 0.94 }}>
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
                          </motion.div>
                          <motion.div whileTap={{ scale: 0.94 }}>
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
                          </motion.div>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>
              )}
            </div>
          </motion.div>
        </div>

        {/* Activity feed */}
        <motion.div
          variants={fadeScaleVariants}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.25 }}
          className="rounded-xl border border-card-border bg-card shadow-sm"
        >
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
            <motion.ul
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="divide-y divide-border"
            >
              {activity.map((item) => (
                <motion.li
                  key={item.id}
                  variants={itemVariants}
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
                </motion.li>
              ))}
            </motion.ul>
          )}
        </motion.div>
      </div>
    </div>
  );
}
