import { useMemo, useState } from 'react';
import { Plus, Repeat, Pencil, Trash2, MoreVertical, PauseCircle, PlayCircle, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
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
import { ContratStatusBadge, cadenceLabel } from '@/components/status-badge';
import { fmtEUR, fmtDate } from '@/lib/format';
import { useContrats, useUpdateContratMutation, useDeleteContratMutation } from '@/hooks/use-contrats';
import { ContratDialog } from '@/components/contrat-dialog';
import type { Contrat } from '@workspace/api-client-react';

const STATUS_FILTERS = [
  { value: 'ALL', label: 'Tous' },
  { value: 'ACTIF', label: 'Actifs' },
  { value: 'SUSPENDU', label: 'Suspendus' },
  { value: 'TERMINE', label: 'Terminés' },
];

export default function Contrats() {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Contrat | null>(null);

  const { data: contrats, isLoading, isError } = useContrats();
  const { updateContrat } = useUpdateContratMutation();
  const { deleteContrat } = useDeleteContratMutation();

  const filtered = useMemo(() => {
    const list = contrats ?? [];
    if (statusFilter === 'ALL') return list;
    return list.filter((c) => c.status === statusFilter);
  }, [contrats, statusFilter]);

  const totalMonthlyValue = useMemo(() => {
    return (contrats ?? [])
      .filter((c) => c.status === 'ACTIF')
      .reduce((sum, c) => {
        const monthly =
          c.cadence === 'mensuel'
            ? 1
            : c.cadence === 'trimestriel'
              ? 1 / 3
              : c.cadence === 'semestriel'
                ? 1 / 6
                : 1 / 12;
        return sum + (c.amountCents ?? 0) * monthly;
      }, 0);
  }, [contrats]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (contrat: Contrat) => {
    setEditing(contrat);
    setDialogOpen(true);
  };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Récurrence"
        title="Contrats récurrents"
        description="Vos revenus récurrents, cadence par cadence."
        actions={
          <Button onClick={openCreate} data-testid="button-create-contrat" className="gap-1.5">
            <Plus className="h-4 w-4" /> Nouveau contrat
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-card-border bg-card p-4">
            {/* « MRR » a été signalé nommément au test du 22/08 : l'artisan
                qui pose des ardoises n'a pas à traduire un sigle de startup. */}
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Revenus par mois (contrats actifs)
            </div>
            <div className="font-mono-nums text-2xl font-semibold mt-1 text-primary">
              {fmtEUR(Math.round(totalMonthlyValue))}
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Contrats actifs
            </div>
            <div className="font-mono-nums text-2xl font-semibold mt-1">
              {(contrats ?? []).filter((c) => c.status === 'ACTIF').length}
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Total contrats
            </div>
            <div className="font-mono-nums text-2xl font-semibold mt-1">
              {(contrats ?? []).length}
            </div>
          </div>
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48" aria-label="Filtrer par statut de contrat" data-testid="select-filter-contrat-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-destructive">
              Impossible de charger les contrats.
            </div>
          ) : filtered.length === 0 ? (
            <Empty className="py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Repeat />
                </EmptyMedia>
                <EmptyTitle>Aucun contrat</EmptyTitle>
                <EmptyDescription>
                  Ajoutez votre premier contrat récurrent pour suivre vos revenus stables.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Nouveau contrat
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Contrat</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Cadence</th>
                  <th className="px-4 py-3 font-medium text-right">Montant</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium">Prochaine échéance</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((contrat) => (
                  <tr
                    key={contrat.id}
                    className="border-b border-border last:border-0 hover-elevate"
                    data-testid={`row-contrat-${contrat.id}`}
                  >
                    <td className="px-5 py-3 font-medium text-foreground">{contrat.label}</td>
                    <td className="px-4 py-3 text-muted-foreground">{contrat.clientName ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{cadenceLabel(contrat.cadence)}</td>
                    <td className="px-4 py-3 text-right font-mono-nums tabular-nums">
                      {contrat.amountCents != null ? fmtEUR(contrat.amountCents) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ContratStatusBadge status={contrat.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {fmtDate(contrat.nextOccurrenceDate)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <ContratRowMenu
                        contrat={contrat}
                        onEdit={() => openEdit(contrat)}
                        onDelete={() => deleteContrat(contrat.id)}
                        onSetStatus={(status) => updateContrat(contrat.id, { status })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ContratDialog open={dialogOpen} onOpenChange={setDialogOpen} contrat={editing} />
    </div>
  );
}

function ContratRowMenu({
  contrat,
  onEdit,
  onDelete,
  onSetStatus,
}: {
  contrat: Contrat;
  onEdit: () => void;
  onDelete: () => void;
  onSetStatus: (status: string) => void;
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
            data-testid={`button-menu-contrat-${contrat.id}`}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit} data-testid={`button-edit-contrat-${contrat.id}`}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
          </DropdownMenuItem>
          {contrat.status !== 'ACTIF' && (
            <DropdownMenuItem onClick={() => onSetStatus('ACTIF')} data-testid={`button-activate-contrat-${contrat.id}`}>
              <PlayCircle className="h-3.5 w-3.5 mr-2" /> Activer
            </DropdownMenuItem>
          )}
          {contrat.status === 'ACTIF' && (
            <DropdownMenuItem onClick={() => onSetStatus('SUSPENDU')} data-testid={`button-suspend-contrat-${contrat.id}`}>
              <PauseCircle className="h-3.5 w-3.5 mr-2" /> Suspendre
            </DropdownMenuItem>
          )}
          {contrat.status !== 'TERMINE' && (
            <DropdownMenuItem onClick={() => onSetStatus('TERMINE')} data-testid={`button-terminate-contrat-${contrat.id}`}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Marquer terminé
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => setConfirmOpen(true)}
            className="text-destructive focus:text-destructive"
            data-testid={`button-delete-contrat-${contrat.id}`}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce contrat ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {contrat.label} » sera définitivement supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
