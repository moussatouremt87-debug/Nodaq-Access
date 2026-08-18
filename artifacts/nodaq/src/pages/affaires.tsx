import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Plus,
  Search,
  Briefcase,
  Pencil,
  Trash2,
  MoreVertical,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { AffaireStatusBadge, AFFAIRE_STATUS_OPTIONS } from '@/components/status-badge';
import { fmtEUR, fmtDate } from '@/lib/format';
import { listContainerVariants, itemVariants } from '@/lib/motion-variants';
import { useAffaires, useAffaireStats, useDeleteAffaireMutation } from '@/hooks/use-affaires';
import { AffaireDialog } from '@/components/affaire-dialog';
import { useVertical } from '@/hooks/use-vertical';
import type { Affaire } from '@workspace/api-client-react';

export default function Affaires() {
  const [, navigate] = useLocation();
  const { words } = useVertical();
  const reducedMotion = useReducedMotion();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Affaire | null>(null);

  const { data, isLoading, isError } = useAffaires({
    statut: statusFilter !== 'ALL' ? statusFilter : undefined,
    inclureArchivees: statusFilter === 'ARCHIVEE' ? true : undefined,
  });
  const { data: stats } = useAffaireStats();
  const { deleteAffaire } = useDeleteAffaireMutation();

  const affaires = data?.affaires ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return affaires;
    const q = search.toLowerCase();
    return affaires.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.clientName?.toLowerCase().includes(q) ||
        a.reference?.toLowerCase().includes(q),
    );
  }, [affaires, search]);

  const statsByStatus = useMemo(() => {
    const map = new Map(stats?.byStatus.map((s) => [s.status, s]));
    return map;
  }, [stats]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (affaire: Affaire) => {
    setEditing(affaire);
    setDialogOpen(true);
  };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Portefeuille"
        title={words.plural.charAt(0).toUpperCase() + words.plural.slice(1)}
        description="Suivez chaque affaire depuis le prospect jusqu'à la facturation."
        actions={
          <Button onClick={openCreate} data-testid="button-create-affaire" className="gap-1.5">
            <Plus className="h-4 w-4" /> {words.newLabel}
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {/* Pipeline stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {AFFAIRE_STATUS_OPTIONS.map((opt, i) => {
            const s = statsByStatus.get(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() =>
                  setStatusFilter((prev) => (prev === opt.value ? 'ALL' : opt.value))
                }
                data-testid={`stat-status-${opt.value}`}
                className={`text-left rounded-lg border p-3 hover-elevate animate-stagger-in ${
                  statusFilter === opt.value
                    ? 'border-primary bg-primary/5'
                    : 'border-card-border bg-card'
                }`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                  {opt.label}
                </div>
                <div className="font-mono-nums text-lg font-semibold mt-1">
                  {s?.count ?? 0}
                </div>
                {s?.totalCents != null && (
                  <div className="text-[11px] text-muted-foreground font-mono-nums truncate">
                    {fmtEUR(s.totalCents)}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher une affaire, un client, une référence..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-affaires"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-56" aria-label="Filtrer par statut" data-testid="select-filter-status">
              <SelectValue placeholder="Tous les statuts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {AFFAIRE_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-destructive">
              Impossible de charger les affaires.
            </div>
          ) : filtered.length === 0 ? (
            <Empty className="py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Briefcase />
                </EmptyMedia>
                <EmptyTitle>Aucune affaire trouvée</EmptyTitle>
                <EmptyDescription>
                  Ajustez vos filtres ou créez votre première affaire.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={openCreate} data-testid="button-create-affaire-empty">
                  <Plus className="h-4 w-4" /> {words.newLabel}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">
                    {words.singular.charAt(0).toUpperCase() + words.singular.slice(1)}
                  </th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium text-right">Devisé</th>
                  <th className="px-4 py-3 font-medium text-right">Facturé</th>
                  <th className="px-4 py-3 font-medium text-right">Marge</th>
                  <th className="px-4 py-3 font-medium">Début</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <motion.tbody
                variants={reducedMotion ? undefined : listContainerVariants}
                initial={reducedMotion ? false : 'hidden'}
                animate="visible"
              >
                {filtered.map((affaire) => (
                  <motion.tr
                    key={affaire.id}
                    variants={reducedMotion ? undefined : itemVariants}
                    className="border-b border-border last:border-0 hover-elevate cursor-pointer"
                    data-testid={`row-affaire-${affaire.id}`}
                    onClick={() => navigate(`/affaires/${affaire.id}`)}
                  >
                    <td className="px-5 py-3">
                      <div className="font-medium text-foreground">{affaire.label}</div>
                      {affaire.reference && (
                        <div className="text-xs text-muted-foreground font-mono-nums">
                          {affaire.reference}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {affaire.clientName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <AffaireStatusBadge status={affaire.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono-nums tabular-nums">
                      {affaire.quotedAmountCents != null
                        ? fmtEUR(affaire.quotedAmountCents)
                        : affaire.montantVenduHt != null
                          ? fmtEUR(affaire.montantVenduHt)
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-nums tabular-nums">
                      {affaire.invoicedAmountCents != null ? fmtEUR(affaire.invoicedAmountCents) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono-nums tabular-nums">
                      {affaire.marginCents != null ? (
                        <span
                          className={
                            affaire.marginCents >= 0 ? 'text-primary' : 'text-destructive'
                          }
                        >
                          {fmtEUR(affaire.marginCents)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {fmtDate(affaire.startDate)}
                    </td>
                    {/* La ligne entière navigue vers le détail : ce menu est
                        dans son propre îlot de clic, sinon l'ouvrir
                        naviguerait aussi. */}
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <AffaireRowMenu
                        affaire={affaire}
                        onEdit={() => openEdit(affaire)}
                        onDelete={() => deleteAffaire(affaire.id)}
                      />
                    </td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </table>
          )}
        </div>
      </div>

      <AffaireDialog open={dialogOpen} onOpenChange={setDialogOpen} affaire={editing} />
    </div>
  );
}

function AffaireRowMenu({
  affaire,
  onEdit,
  onDelete,
}: {
  affaire: Affaire;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-testid={`button-menu-affaire-${affaire.id}`}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit} data-testid={`button-edit-affaire-${affaire.id}`}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setConfirmOpen(true)}
            className="text-destructive focus:text-destructive"
            data-testid={`button-delete-affaire-${affaire.id}`}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette affaire ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. « {affaire.label} » sera définitivement supprimée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
