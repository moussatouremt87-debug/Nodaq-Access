import { useMemo, useState } from 'react';
import { Plus, Users, Trash2, Phone, Mail, GripVertical } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { PROSPECT_STAGE_OPTIONS, sourceLabel } from '@/components/status-badge';
import { fmtEUR, initials } from '@/lib/format';
import { useProspects, useUpdateProspectMutation, useDeleteProspectMutation } from '@/hooks/use-prospects';
import { ProspectDialog } from '@/components/prospect-dialog';
import type { Prospect } from '@workspace/api-client-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export default function Prospects() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Prospect | null>(null);
  const { data: prospects, isLoading, isError } = useProspects();
  const { updateProspect } = useUpdateProspectMutation();
  const { deleteProspect } = useDeleteProspectMutation();

  const grouped = useMemo(() => {
    const map = new Map<string, Prospect[]>();
    for (const opt of PROSPECT_STAGE_OPTIONS) map.set(opt.value, []);
    for (const p of prospects ?? []) {
      const list = map.get(p.stage) ?? [];
      list.push(p);
      map.set(p.stage, list);
    }
    return map;
  }, [prospects]);

  const totalPipelineValue = useMemo(
    () =>
      (prospects ?? [])
        .filter((p) => p.stage !== 'GAGNE' && p.stage !== 'PERDU')
        .reduce((sum, p) => sum + (p.estimatedValueCents ?? 0), 0),
    [prospects],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (p: Prospect) => {
    setEditing(p);
    setDialogOpen(true);
  };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="CRM"
        title="Prospects"
        description="Vos contacts commerciaux, étape par étape."
        actions={
          <Button onClick={openCreate} data-testid="button-create-prospect" className="gap-1.5">
            <Plus className="h-4 w-4" /> Nouveau prospect
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Total des affaires en discussion
            </div>
            <div className="font-mono-nums text-2xl font-semibold mt-1 text-primary">
              {fmtEUR(totalPipelineValue)}
            </div>
          </div>
          <div className="rounded-xl border border-card-border bg-card p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Prospects actifs
            </div>
            <div className="font-mono-nums text-2xl font-semibold mt-1">
              {(prospects ?? []).filter((p) => p.stage !== 'GAGNE' && p.stage !== 'PERDU').length}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-72 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-destructive rounded-xl border border-card-border bg-card">
            Impossible de charger les prospects.
          </div>
        ) : (prospects ?? []).length === 0 ? (
          <Empty className="py-14 rounded-xl border border-dashed border-card-border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>Aucun contact commercial</EmptyTitle>
              <EmptyDescription>Ajoutez votre premier prospect pour démarrer.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> Nouveau prospect
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 overflow-x-auto pb-2">
            {PROSPECT_STAGE_OPTIONS.map((opt) => {
              const list = grouped.get(opt.value) ?? [];
              return (
                <div key={opt.value} className="min-w-[220px] flex flex-col">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {opt.label}
                    </span>
                    <span className="text-[11px] font-mono-nums text-muted-foreground">
                      {list.length}
                    </span>
                  </div>
                  <div className="flex-1 space-y-2 rounded-xl border border-dashed border-border bg-muted/30 p-2 min-h-[140px]">
                    {list.map((p) => (
                      <ProspectCard
                        key={p.id}
                        prospect={p}
                        onEdit={() => openEdit(p)}
                        onDelete={() => deleteProspect(p.id)}
                        onMoveNext={(stage) => updateProspect(p.id, { stage })}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ProspectDialog open={dialogOpen} onOpenChange={setDialogOpen} prospect={editing} />
    </div>
  );
}

function ProspectCard({
  prospect,
  onEdit,
  onDelete,
  onMoveNext,
}: {
  prospect: Prospect;
  onEdit: () => void;
  onDelete: () => void;
  onMoveNext: (stage: string) => void;
}) {
  return (
    <div
      className="group rounded-lg border border-card-border bg-card p-3 shadow-sm hover-elevate cursor-pointer"
      onClick={onEdit}
      data-testid={`card-prospect-${prospect.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarFallback className="text-[10px] font-semibold bg-primary/15 text-primary">
              {initials(prospect.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{prospect.name}</div>
            {prospect.companyName && (
              <div className="text-xs text-muted-foreground truncate">{prospect.companyName}</div>
            )}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
          data-testid={`button-delete-prospect-${prospect.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          {sourceLabel(prospect.source)}
        </span>
        {prospect.estimatedValueCents != null && (
          <span className="font-mono-nums text-xs font-semibold text-foreground">
            {fmtEUR(prospect.estimatedValueCents)}
          </span>
        )}
      </div>

      {(prospect.phone || prospect.email) && (
        <div className="mt-2 pt-2 border-t border-border/60 space-y-1">
          {prospect.phone && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
              <Phone className="h-3 w-3 shrink-0" /> {prospect.phone}
            </div>
          )}
          {prospect.email && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
              <Mail className="h-3 w-3 shrink-0" /> {prospect.email}
            </div>
          )}
        </div>
      )}

      <div onClick={(e) => e.stopPropagation()} className="mt-2">
        <Select value={prospect.stage} onValueChange={onMoveNext}>
          <SelectTrigger
            className="h-6 text-[11px] px-2 border-dashed"
            data-testid={`select-move-prospect-${prospect.id}`}
          >
            <div className="flex items-center gap-1">
              <GripVertical className="h-3 w-3 text-muted-foreground" />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent>
            {PROSPECT_STAGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
