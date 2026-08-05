import { useMemo, useState } from 'react';
import { Plus, Receipt, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { fmtEUR, fmtDate, isOverdue } from '@/lib/format';
import { useFactures, useUpdateFactureMutation } from '@/hooks/use-factures';
import { FactureDialog } from '@/components/facture-dialog';
import { cn } from '@/lib/utils';

type FilterTab = 'ALL' | 'OVERDUE' | 'SETTLED';

export default function Factures() {
  const [tab, setTab] = useState<FilterTab>('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);

  const settledParam = tab === 'SETTLED' ? true : tab === 'OVERDUE' ? false : undefined;
  const { data, isLoading, isError } = useFactures({ settled: settledParam });
  const { updateFacture, isPending: settling } = useUpdateFactureMutation();

  const factures = data?.factures ?? [];

  const displayed = useMemo(() => {
    if (tab === 'OVERDUE') {
      return factures.filter((f) => !f.settled && isOverdue(f.dueDate));
    }
    return factures;
  }, [factures, tab]);

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Facturation"
        title="Factures"
        description="Suivez les règlements et les impayés en un coup d'œil."
        actions={
          <Button onClick={() => setDialogOpen(true)} data-testid="button-create-facture" className="gap-1.5">
            <Plus className="h-4 w-4" /> Nouvelle facture
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Total facturé
            </div>
            <div className="font-mono-nums text-2xl font-semibold mt-1">
              {data ? fmtEUR(data.totalAmountCents) : '—'}
            </div>
          </div>
          <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
            <div className="text-[11px] uppercase tracking-wide text-destructive/80 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Total impayé
            </div>
            <div className="font-mono-nums text-2xl font-semibold mt-1 text-destructive">
              {data ? fmtEUR(data.totalOverdueCents) : '—'}
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Nombre de factures
            </div>
            <div className="font-mono-nums text-2xl font-semibold mt-1">{factures.length}</div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
          <TabsList>
            <TabsTrigger value="ALL" data-testid="tab-all">Toutes</TabsTrigger>
            <TabsTrigger value="OVERDUE" data-testid="tab-overdue">En retard</TabsTrigger>
            <TabsTrigger value="SETTLED" data-testid="tab-settled">Réglées</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-destructive">
              Impossible de charger les factures.
            </div>
          ) : displayed.length === 0 ? (
            <Empty className="py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Receipt />
                </EmptyMedia>
                <EmptyTitle>Aucune facture</EmptyTitle>
                <EmptyDescription>
                  {tab === 'OVERDUE'
                    ? "Aucune facture en retard — bien joué."
                    : 'Créez votre première facture pour commencer le suivi.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" /> Nouvelle facture
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Numéro</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Émise</th>
                  <th className="px-4 py-3 font-medium">Échéance</th>
                  <th className="px-4 py-3 font-medium text-right">Montant</th>
                  <th className="px-4 py-3 font-medium text-right">Restant</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((facture) => {
                  const overdue = !facture.settled && isOverdue(facture.dueDate);
                  return (
                    <tr
                      key={facture.id}
                      className="border-b border-border last:border-0 hover-elevate"
                      data-testid={`row-facture-${facture.id}`}
                    >
                      <td className="px-5 py-3 font-mono-nums font-medium text-foreground">
                        {facture.number}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{facture.customerName}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {fmtDate(facture.issuedDate)}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 whitespace-nowrap',
                          overdue ? 'text-destructive font-medium' : 'text-muted-foreground',
                        )}
                      >
                        {fmtDate(facture.dueDate)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-nums tabular-nums">
                        {fmtEUR(facture.amountCents)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono-nums tabular-nums">
                        {facture.residualCents != null ? fmtEUR(facture.residualCents) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {facture.settled ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary border border-primary/25 px-2.5 py-0.5 text-[11px] font-semibold">
                            Réglée
                          </span>
                        ) : overdue ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/12 text-destructive border border-destructive/25 px-2.5 py-0.5 text-[11px] font-semibold">
                            En retard
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-[11px] font-semibold">
                            En attente
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {!facture.settled && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            disabled={settling}
                            onClick={() =>
                              updateFacture(facture.id, { settled: true, residualCents: 0 })
                            }
                            data-testid={`button-settle-facture-${facture.id}`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Régler
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <FactureDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
