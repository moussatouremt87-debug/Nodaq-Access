import { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { ArrowLeft, Pencil, Calendar, Euro, User, FileText, CheckCircle2, Clock, TrendingUp, Flag } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AffaireStatusBadge } from '@/components/status-badge';
import { AffaireDialog } from '@/components/affaire-dialog';
import { useAffaire } from '@/hooks/use-affaires';
import { fmtEUR, fmtDate } from '@/lib/format';
import type { Affaire } from '@workspace/api-client-react';

export default function AffaireDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: affaire, isLoading, isError } = useAffaire(params.id ?? '');

  const handleBack = () => setLocation('/affaires');

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (isError || !affaire) {
    return (
      <div className="p-6">
        <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" /> Retour aux affaires
        </button>
        <p className="text-sm text-muted-foreground">Affaire introuvable.</p>
      </div>
    );
  }

  const margin = affaire.marginCents ?? 0;
  const quoted = affaire.quotedAmountCents ?? 0;
  const invoiced = affaire.invoicedAmountCents ?? 0;
  const sold = affaire.montantVenduHt ?? 0;
  const marginPct = quoted > 0 ? Math.round((margin / quoted) * 100) : null;

  return (
    <div className="flex flex-col gap-4 p-4 pb-10 max-w-2xl mx-auto">
      {/* Back nav */}
      <button
        onClick={handleBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground self-start -ml-1"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux affaires
      </button>

      {/* Header card */}
      <div className="rounded-2xl border border-card-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-semibold text-foreground leading-tight">
              {affaire.label}
            </h1>
            {affaire.clientName && (
              <p className="mt-1 text-[13px] text-muted-foreground flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 shrink-0" />
                {affaire.clientName}
              </p>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            <AffaireStatusBadge status={affaire.status} />
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)} className="gap-1.5 text-xs">
              <Pencil className="h-3.5 w-3.5" /> Modifier
            </Button>
          </div>
        </div>

        {affaire.reference && (
          <p className="mt-2 text-[12px] font-mono text-muted-foreground/70">
            Réf. {affaire.reference}
          </p>
        )}
      </div>

      {/* Dates */}
      {(affaire.startDate || affaire.completedAt || affaire.dateFinPrevue) && (
        <div className="rounded-2xl border border-card-border bg-card p-5 space-y-3">
          <h2 className="font-semibold text-sm text-foreground">Dates</h2>
          <div className="grid grid-cols-2 gap-3">
            {affaire.startDate && (
              <div className="rounded-xl bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <Calendar className="h-3.5 w-3.5" /> Début
                </div>
                <p className="text-sm font-semibold text-foreground">{fmtDate(affaire.startDate)}</p>
              </div>
            )}
            {affaire.completedAt && (
              <div className="rounded-xl bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Terminé
                </div>
                <p className="text-sm font-semibold text-foreground">{fmtDate(affaire.completedAt)}</p>
              </div>
            )}
            {affaire.dateFinPrevue && (
              <div className="rounded-xl bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <Flag className="h-3.5 w-3.5" /> Fin prévue
                </div>
                <p className="text-sm font-semibold text-foreground">{fmtDate(affaire.dateFinPrevue)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Avancement — non financier, visible indépendamment de l'accès financier */}
      {affaire.avancementPct != null && (
        <div className="rounded-2xl border border-card-border bg-card p-5 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Avancement
            </h2>
            <span className="text-sm font-semibold text-foreground tabular-nums">{affaire.avancementPct} %</span>
          </div>
          <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, affaire.avancementPct))}%` }}
            />
          </div>
        </div>
      )}

      {/* Financials */}
      {(quoted > 0 || invoiced > 0 || sold > 0) && (
        <div className="rounded-2xl border border-card-border bg-card p-5 space-y-3">
          <h2 className="font-semibold text-sm text-foreground">Finances</h2>
          <div className="grid grid-cols-2 gap-3">
            {quoted > 0 && (
              <div className="rounded-xl bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <Euro className="h-3.5 w-3.5" /> Devisé
                </div>
                <p className="text-sm font-semibold text-foreground tabular-nums">{fmtEUR(quoted)}</p>
              </div>
            )}
            {invoiced > 0 && (
              <div className="rounded-xl bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <FileText className="h-3.5 w-3.5" /> Facturé
                </div>
                <p className="text-sm font-semibold text-foreground tabular-nums">{fmtEUR(invoiced)}</p>
              </div>
            )}
            {sold > 0 && (
              <div className="rounded-xl bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  <Euro className="h-3.5 w-3.5" /> Vendu
                </div>
                <p className="text-sm font-semibold text-foreground tabular-nums">{fmtEUR(sold)}</p>
              </div>
            )}
          </div>

          {marginPct !== null && (
            <div className="rounded-xl bg-muted/30 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Marge brute
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground tabular-nums">{fmtEUR(margin)}</span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {marginPct} %
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {affaire.notes && (
        <div className="rounded-2xl border border-card-border bg-card p-5">
          <h2 className="font-semibold text-sm text-foreground mb-2">Notes</h2>
          <p className="text-[13.5px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {affaire.notes}
          </p>
        </div>
      )}

      {/* Empty state when no extra details */}
      {!affaire.startDate && !affaire.completedAt && !affaire.dateFinPrevue
        && affaire.avancementPct == null && quoted === 0 && sold === 0 && !affaire.notes && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
          <Clock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Aucun détail ajouté pour cette affaire.</p>
          <Button size="sm" variant="outline" className="mt-3 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> Compléter l'affaire
          </Button>
        </div>
      )}

      <AffaireDialog open={dialogOpen} onOpenChange={setDialogOpen} affaire={affaire as Affaire} />
    </div>
  );
}
