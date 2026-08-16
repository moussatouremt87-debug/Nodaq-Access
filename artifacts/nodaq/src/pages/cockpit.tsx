import { useMemo, useState, useCallback } from 'react';
import { ObjectifsCockpit } from '@/components/objectifs-cockpit';
import { Link } from 'wouter';
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
  RefreshCw,
  CalendarDays,
  Building2,
  DatabaseZap,
  Lock,
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
import { useIsOwner, useHasFinancialAccess } from '@/hooks/use-auth';
import { useVertical } from '@/hooks/use-vertical';
import { useCompanyProfile } from '@/hooks/use-company-profile';

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
  const { words } = useVertical();
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: kpis, isLoading: kpisLoading, isError: kpisError } = useCockpitKpis();
  const { data: activity, isLoading: activityLoading } = useCockpitActivity();
  const { data: pendingActions, isLoading: pendingLoading, isError: pendingError } = usePendingActions();
  const { approve, isPending: approving } = useApproveAction();
  const { reject, isPending: rejecting } = useRejectAction();
  const { incomplete: profilIncomplet } = useCompanyProfile();
  const isOwner = useIsOwner();
  const financier = useHasFinancialAccess();

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

  // ── YTD helpers ──────────────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const pctYearElapsed = (() => {
    const n = new Date();
    const start = new Date(n.getFullYear(), 0, 1).getTime();
    const end   = new Date(n.getFullYear() + 1, 0, 1).getTime();
    return Math.round(((n.getTime() - start) / (end - start)) * 100);
  })();
  const ytd = kpis?.ytd ?? {
    caYtdCents: 0,
    caPrevYearSamePeriodCents: 0,
    caGrowthPct: null,
    facturesEmisesYtd: 0,
    tauxRecouvrement: 0,
  };

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // US-A6.2 : sans try/finally, un des trois `invalidateQueries` qui
    // échoue (ex. panne transitoire sur /pending-actions, exactement le
    // défaut que ce bouton doit permettre de contourner) fait rejeter le
    // `Promise.all` — `setIsRefreshing(false)` n'est alors jamais atteint,
    // et le bouton "Actualiser" reste DÉSACTIVÉ pour de bon, jusqu'au
    // rechargement de la page. L'utilisateur perd alors le seul moyen de
    // se rétablir manuellement d'un échec.
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetCockpitKpisQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetCockpitActivityQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListPendingActionsQueryKey() }),
      ]);
      setRefreshKey((k) => k + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Vue d'ensemble"
        title="Cockpit"
        description="Le pilotage en temps réel de votre activité — trésorerie, affaires, factures et prospects."
        withMesh
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

        {/* CTA : profil entreprise non renseigné (OWNER uniquement) */}
        {profilIncomplet && isOwner && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid="cta-onboarding"
            className="rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="h-4.5 w-4.5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">Votre profil entreprise est incomplet</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Renseignez votre SIRET pour que vos devis et factures soient conformes.
                </div>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Link href="/onboarding">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium cursor-pointer">
                  <Building2 className="h-3.5 w-3.5" /> Compléter le profil
                </span>
              </Link>
              <Link href="/reprise">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-background border border-border text-foreground px-3 py-1.5 text-xs font-medium cursor-pointer">
                  <DatabaseZap className="h-3.5 w-3.5" /> Reprendre les données
                </span>
              </Link>
            </div>
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
                label={`${words.plural.charAt(0).toUpperCase() + words.plural.slice(1)} en cours`}
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
                masked={!financier}
              />
              <AnimatedKpi
                testId="kpi-factures-attente"
                label="Factures en attente"
                target={kpis?.facturesEnAttente ?? 0}
                format={fmtCount}
                hint={
                  // US-A3.1 : la sévérité affichée dépend du cycle du
                  // secteur, pas du seul fait qu'une facture soit en retard
                  // — une facture tout juste échue est normale pour un B2B
                  // à délai standard, pas pour un commerce à encaissement
                  // comptant. `totalImpayeSignificatifCents` (pas
                  // `totalImpayeCents`) porte cette distinction.
                  financier && kpis?.totalImpayeSignificatifCents
                    ? kpis.delaiPaiementUsuelJours > 0
                      ? `${fmtEUR(kpis.totalImpayeSignificatifCents)} en retard — au-delà du délai standard de votre secteur (${kpis.delaiPaiementUsuelJours} j)`
                      : `${fmtEUR(kpis.totalImpayeSignificatifCents)} en retard`
                    : undefined
                }
                icon={FileWarning}
                tone={financier && kpis?.totalImpayeSignificatifCents ? 'warning' : 'default'}
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

        {/* ── YTD Bilan ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-0.5">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
              Bilan {currentYear} — du 1er janvier à aujourd'hui
            </span>
          </div>

          {/* Objectifs — le bloc se retire lui-même si le rôle n'y a pas droit
              ou si le patron l'a désactivé : la réponse est alors vide. */}
          <div className="mb-4">
            <ObjectifsCockpit />
          </div>

          <motion.div
            key={`ytd-${refreshKey}`}
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            {kpisLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[110px] rounded-xl" />
              ))
            ) : (
              <>
                <AnimatedKpi
                  label="CA de l'année"
                  target={ytd.caYtdCents}
                  format={fmtCentsCompact}
                  icon={TrendingUp}
                  tone="accent"
                  masked={!financier}
                  hint={
                    ytd.caGrowthPct != null
                      ? `${ytd.caGrowthPct >= 0 ? '↑' : '↓'} ${Math.abs(ytd.caGrowthPct)} % vs N−1`
                      : undefined
                  }
                />
                <AnimatedKpi
                  label="Factures émises"
                  target={ytd.facturesEmisesYtd}
                  format={fmtCount}
                  icon={Euro}
                  masked={!financier}
                />
                <AnimatedKpi
                  label="Taux de recouvrement"
                  target={ytd.tauxRecouvrement}
                  format={(n) => `${Math.round(n)} %`}
                  icon={ShieldCheck}
                  masked={!financier}
                  tone={
                    ytd.tauxRecouvrement >= 80
                      ? 'accent'
                      : ytd.tauxRecouvrement < 60
                        ? 'warning'
                        : 'default'
                  }
                />
              </>
            )}
          </motion.div>

          {/* Year-progress bar */}
          {!kpisLoading && (
            <div className="rounded-xl border border-card-border bg-card px-5 py-3 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progression annuelle</span>
                <span className="font-mono-nums tabular-nums">
                  {pctYearElapsed} % de l'année écoulée
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pctYearElapsed}%` }}
                  transition={{ duration: 1.2, ease: 'easeOut', delay: 0.2 }}
                  className="h-full rounded-full bg-primary/50"
                />
              </div>
            </div>
          )}
        </div>

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
              ) : !financier ? (
                <div className="h-56 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                  <Lock className="h-4 w-4" strokeWidth={2} />
                  <span className="text-sm">Réservé aux gestionnaires financiers</span>
                </div>
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
              ) : pendingError ? (
                // US-A6.2 : un échec de chargement ne doit JAMAIS se confondre
                // avec "rien à valider" — c'est exactement le défaut confirmé
                // en recette (panneau vide malgré des données backend correctes).
                <div className="mx-4 my-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  Impossible de charger les actions à valider. Réessayez dans un instant.
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
                        initial="hidden"
                        animate="visible"
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
