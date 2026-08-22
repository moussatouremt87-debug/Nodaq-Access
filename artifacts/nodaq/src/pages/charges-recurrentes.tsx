import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Repeat, Plus, PauseCircle, PlayCircle,
  Pencil, Trash2, MoreVertical,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListChargesRecurrentes,
  useCreateChargeRecurrente,
  useUpdateChargeRecurrente,
  useDeleteChargeRecurrente,
  getListChargesRecurrentesQueryKey,
  type ChargeRecurrente,
} from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/currency-input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from '@/components/ui/empty';
import { useToast } from '@/hooks/use-toast';
import { fmtEUR, fmtDate } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  LOYER:           { label: 'Loyer',          color: 'bg-blue-500/10 text-blue-400 border-blue-500/25' },
  MASSE_SALARIALE: { label: 'Masse salariale', color: 'bg-purple-500/10 text-purple-400 border-purple-500/25' },
  ABONNEMENT:      { label: 'Abonnement',      color: 'bg-orange-500/10 text-orange-400 border-orange-500/25' },
  ASSURANCE:       { label: 'Assurance',       color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25' },
  AUTRE:           { label: 'Autre',           color: 'bg-muted text-muted-foreground border-border' },
};

const CADENCE_META: Record<string, string> = {
  mensuel: 'Mensuelle',
  trimestriel: 'Trimestrielle',
  semestriel: 'Semestrielle',
  annuel: 'Annuelle',
};

export default function ChargesRecurrentesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChargeRecurrente | null>(null);

  const { data: charges = [], isLoading, isError } = useListChargesRecurrentes();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListChargesRecurrentesQueryKey() });

  const toggleActiveMut = useUpdateChargeRecurrente({
    mutation: {
      onSuccess: (updated) => {
        invalidate();
        toast({ title: updated.active ? 'Charge réactivée' : 'Charge suspendue' });
      },
      onError: () => toast({ title: 'Impossible de mettre à jour', variant: 'destructive' }),
    },
  });

  const deleteMut = useDeleteChargeRecurrente({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: 'Charge supprimée' });
      },
      onError: () => toast({ title: 'Suppression échouée', variant: 'destructive' }),
    },
  });

  const stats = {
    total: charges.length,
    actives: charges.filter(c => c.active).length,
    totalMensualise: charges
      .filter(c => c.active)
      .reduce((acc, c) => acc + c.amountCents / (c.cadence === 'mensuel' ? 1 : c.cadence === 'trimestriel' ? 3 : c.cadence === 'semestriel' ? 6 : 12), 0),
  };

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: ChargeRecurrente) => { setEditing(c); setDialogOpen(true); };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Finance"
        title="Charges récurrentes"
        description="Loyer, salaires, abonnements — vos sorties fixes qui reviennent à intervalle régulier."
        actions={
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> Ajouter une charge
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        <motion.div variants={containerVariants} initial="hidden" animate="visible"
          className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Charges suivies', value: stats.total, color: 'border-card-border bg-card' },
            { label: 'Actives', value: stats.actives, color: 'border-card-border bg-card' },
            { label: 'Équivalent mensuel', value: fmtEUR(Math.round(stats.totalMensualise)), color: 'border-card-border bg-card' },
          ].map((s, i) => (
            <motion.div key={i} variants={itemVariants}
              className={`rounded-xl border p-4 ${s.color}`}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">{s.label}</div>
              <div className="text-xl font-semibold font-mono-nums">{s.value}</div>
            </motion.div>
          ))}
        </motion.div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-destructive">Impossible de charger les charges récurrentes.</div>
        ) : charges.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Repeat /></EmptyMedia>
              <EmptyTitle>Aucune charge récurrente</EmptyTitle>
              <EmptyDescription>Ajoutez votre loyer, vos salaires ou vos abonnements pour les suivre.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={openCreate}><Plus className="h-4 w-4" /> Ajouter une charge</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {charges.map(c => {
                const categoryMeta = CATEGORY_META[c.category] ?? CATEGORY_META.AUTRE;

                return (
                  <motion.div key={c.id} layout
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className={`rounded-xl border bg-card p-4 hover-elevate transition-colors ${
                      c.active ? 'border-card-border' : 'border-card-border opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <Repeat className="h-5 w-5 mt-0.5 shrink-0 text-primary" />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground">{c.label}</span>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${categoryMeta.color}`}>
                            {categoryMeta.label}
                          </span>
                          {!c.active && (
                            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              Suspendue
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {CADENCE_META[c.cadence] ?? c.cadence} · depuis le {fmtDate(c.startDate)}
                          {c.endDate ? ` · jusqu'au ${fmtDate(c.endDate)}` : ''}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-mono-nums text-sm font-semibold">{fmtEUR(c.amountCents)}</div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
                          disabled={toggleActiveMut.isPending}
                          onClick={() => toggleActiveMut.mutate({ id: c.id, data: { active: !c.active } })}>
                          {c.active
                            ? (<><PauseCircle className="h-3 w-3" /> Suspendre</>)
                            : (<><PlayCircle className="h-3 w-3" /> Réactiver</>)}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(c)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => deleteMut.mutate({ id: c.id })}
                              className="text-destructive focus:text-destructive">
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <ChargeRecurrenteDialog open={dialogOpen} onOpenChange={setDialogOpen} charge={editing}
        onSaved={invalidate} />
    </div>
  );
}

function ChargeRecurrenteDialog({ open, onOpenChange, charge, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; charge: ChargeRecurrente | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [category, setCategory] = useState('LOYER');
  const [cadence, setCadence] = useState('mensuel');
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  // En CENTIMES, et non une chaîne d'euros : la conversion vit dans
  // `CurrencyInput`, à un seul endroit.
  const [amountCents, setAmountCents] = useState(0);
  const [notes, setNotes] = useState('');

  const createMut = useCreateChargeRecurrente();
  const updateMut = useUpdateChargeRecurrente();
  const saving = createMut.isPending || updateMut.isPending;

  useEffect(() => {
    if (open) {
      if (charge) {
        setCategory(charge.category);
        setCadence(charge.cadence);
        setLabel(charge.label);
        setStartDate(charge.startDate);
        setAmountCents(charge.amountCents);
        setNotes(charge.notes ?? '');
      } else {
        setCategory('LOYER'); setCadence('mensuel'); setLabel(''); setStartDate(''); setAmountCents(0); setNotes('');
      }
    }
  }, [open, charge]);

  const handleSave = async () => {
    if (!label.trim() || !startDate || amountCents <= 0) return;
    const data = {
      category, cadence, label, startDate,
      amountCents,
      ...(notes ? { notes } : {}),
    };
    const onError = () => toast({ title: 'Erreur', description: "Impossible d'enregistrer", variant: 'destructive' });
    const onSuccess = () => {
      onSaved();
      onOpenChange(false);
      toast({ title: charge ? 'Charge mise à jour' : 'Charge ajoutée' });
    };
    if (charge) updateMut.mutate({ id: charge.id, data }, { onSuccess, onError });
    else createMut.mutate({ data }, { onSuccess, onError });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{charge ? 'Modifier la charge' : 'Nouvelle charge récurrente'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Catégorie</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_META).map(([v, m]) => (
                    <SelectItem key={v} value={v}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cadence</Label>
              <Select value={cadence} onValueChange={setCadence}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CADENCE_META).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Libellé *</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Ex : Loyer atelier" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Première échéance *</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Montant (€) *</Label>
              <CurrencyInput valueCents={amountCents} onChangeCents={setAmountCents} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note optionnelle..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !label.trim() || !startDate || !amountCents}>
            {saving ? 'Enregistrement...' : charge ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
