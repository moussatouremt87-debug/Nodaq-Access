import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarClock, Plus, CheckCircle2, AlertTriangle, Clock, XCircle,
  Pencil, Trash2, MoreVertical,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Tabs, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from '@/components/ui/empty';
import { useToast } from '@/hooks/use-toast';
import { fmtEUR, fmtDate } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type Echeance = {
  id: string; type: string; label: string; dueDate: string;
  estimatedCents?: number | null; paidCents?: number | null; status: string;
  notes?: string | null; paidAt?: string | null; createdAt: string;
};

const TYPE_META: Record<string, { label: string; color: string }> = {
  TVA:    { label: 'TVA',    color: 'bg-blue-500/10 text-blue-400 border-blue-500/25' },
  IS:     { label: 'IS',     color: 'bg-purple-500/10 text-purple-400 border-purple-500/25' },
  URSSAF: { label: 'URSSAF', color: 'bg-orange-500/10 text-orange-400 border-orange-500/25' },
  CFE:    { label: 'CFE',    color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25' },
  CVAE:   { label: 'CVAE',   color: 'bg-pink-500/10 text-pink-400 border-pink-500/25' },
  AUTRE:  { label: 'Autre',  color: 'bg-muted text-muted-foreground border-border' },
};

const STATUS_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  A_VENIR:   { label: 'À venir',   icon: Clock,        color: 'text-muted-foreground' },
  PAYEE:     { label: 'Payée',     icon: CheckCircle2, color: 'text-primary' },
  EN_RETARD: { label: 'En retard', icon: AlertTriangle, color: 'text-destructive' },
};

function daysUntil(dueDate: string): number {
  const d = new Date(dueDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function useEcheances(statut?: string) {
  return useQuery({
    queryKey: ['echeances', statut],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (statut) sp.set('statut', statut);
      const res = await fetch(`${API}/echeances?${sp}`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<Echeance[]>;
    },
  });
}

type FilterTab = 'ALL' | 'A_VENIR' | 'EN_RETARD' | 'PAYEE';

export default function EcheancierPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<FilterTab>('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Echeance | null>(null);

  const { data: echeances = [], isLoading, isError } = useEcheances(tab !== 'ALL' ? tab : undefined);

  const payMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/echeances/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAYEE' }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['echeances'] });
      toast({ title: 'Échéance marquée comme payée' });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/echeances/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Suppression échouée');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['echeances'] });
      toast({ title: 'Échéance supprimée' });
    },
  });

  // Summary stats
  const stats = {
    total: echeances.length,
    aVenir: echeances.filter(e => e.status === 'A_VENIR').length,
    urgent: echeances.filter(e => e.status === 'A_VENIR' && daysUntil(e.dueDate) <= 30).length,
    enRetard: echeances.filter(e => e.status === 'EN_RETARD').length,
    totalDu: echeances.filter(e => e.status !== 'PAYEE').reduce((acc, e) => acc + (e.estimatedCents ?? 0), 0),
  };

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (e: Echeance) => { setEditing(e); setDialogOpen(true); };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Fiscal"
        title="Échéancier fiscal"
        description="Suivez vos obligations fiscales et sociales pour ne jamais être en retard."
        actions={
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> Ajouter une échéance
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {/* Summary */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible"
          className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Échéances à venir', value: stats.aVenir, color: 'border-card-border bg-card' },
            { label: 'Urgentes (< 30j)', value: stats.urgent, color: 'border-yellow-500/25 bg-yellow-500/5', accent: 'text-yellow-400' },
            { label: 'En retard', value: stats.enRetard, color: 'border-destructive/25 bg-destructive/5', accent: 'text-destructive' },
            { label: 'Total à payer', value: fmtEUR(stats.totalDu), color: 'border-card-border bg-card', mono: true },
          ].map((s, i) => (
            <motion.div key={i} variants={itemVariants}
              className={`rounded-xl border p-4 ${s.color}`}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">{s.label}</div>
              <div className={`text-xl font-semibold ${s.mono ? 'font-mono-nums' : 'font-mono-nums'} ${s.accent ?? ''}`}>
                {s.value}
              </div>
            </motion.div>
          ))}
        </motion.div>

        <Tabs value={tab} onValueChange={v => setTab(v as FilterTab)}>
          <TabsList>
            <TabsTrigger value="ALL">Toutes</TabsTrigger>
            <TabsTrigger value="A_VENIR">À venir</TabsTrigger>
            <TabsTrigger value="EN_RETARD" className="data-[state=active]:text-destructive">En retard</TabsTrigger>
            <TabsTrigger value="PAYEE">Payées</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* List */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-destructive">Impossible de charger les échéances.</div>
        ) : echeances.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon"><CalendarClock /></EmptyMedia>
              <EmptyTitle>Aucune échéance</EmptyTitle>
              <EmptyDescription>Ajoutez vos premières échéances fiscales pour les suivre.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={openCreate}><Plus className="h-4 w-4" /> Ajouter une échéance</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {echeances.map(e => {
                const typeMeta = TYPE_META[e.type] ?? TYPE_META.AUTRE;
                const statusMeta = STATUS_META[e.status] ?? STATUS_META.A_VENIR;
                const StatusIcon = statusMeta.icon;
                const days = daysUntil(e.dueDate);
                const isUrgent = e.status === 'A_VENIR' && days <= 30 && days >= 0;

                return (
                  <motion.div key={e.id} layout
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className={`rounded-xl border bg-card p-4 hover-elevate transition-colors ${
                      e.status === 'EN_RETARD' ? 'border-destructive/30 bg-destructive/5' :
                      isUrgent ? 'border-yellow-500/30 bg-yellow-500/5' :
                      'border-card-border'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <StatusIcon className={`h-5 w-5 mt-0.5 shrink-0 ${statusMeta.color}`} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-foreground">{e.label}</span>
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${typeMeta.color}`}>
                            {typeMeta.label}
                          </span>
                          {isUrgent && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-400">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {days === 0 ? "Aujourd'hui" : `${days}j restants`}
                            </span>
                          )}
                          {e.status === 'EN_RETARD' && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                              <XCircle className="h-2.5 w-2.5" />
                              {Math.abs(days)}j de retard
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Échéance : {fmtDate(e.dueDate)}
                          {e.status === 'PAYEE' && e.paidAt && ` · Payée le ${fmtDate(e.paidAt)}`}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        {e.estimatedCents != null && (
                          <div className="font-mono-nums text-sm font-semibold">
                            {fmtEUR(e.estimatedCents)}
                          </div>
                        )}
                        <div className={`text-xs font-medium ${statusMeta.color}`}>
                          {statusMeta.label}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {e.status !== 'PAYEE' && (
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
                            disabled={payMut.isPending}
                            onClick={() => payMut.mutate(e.id)}>
                            <CheckCircle2 className="h-3 w-3" /> Marquer payée
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(e)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => deleteMut.mutate(e.id)}
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

      <EcheanceDialog open={dialogOpen} onOpenChange={setDialogOpen} echeance={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ['echeances'] })} />
    </div>
  );
}

function EcheanceDialog({ open, onOpenChange, echeance, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; echeance: Echeance | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState('TVA');
  const [label, setLabel] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimatedCents, setEstimatedCents] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (echeance) {
        setType(echeance.type);
        setLabel(echeance.label);
        setDueDate(echeance.dueDate);
        setEstimatedCents(echeance.estimatedCents != null ? String(echeance.estimatedCents / 100) : '');
        setNotes(echeance.notes ?? '');
      } else {
        setType('TVA'); setLabel(''); setDueDate(''); setEstimatedCents(''); setNotes('');
      }
    }
  }, [open, echeance]);

  const handleSave = async () => {
    if (!label.trim() || !dueDate) return;
    setSaving(true);
    try {
      const url = echeance ? `${API}/echeances/${echeance.id}` : `${API}/echeances`;
      const method = echeance ? 'PATCH' : 'POST';
      const res2 = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, label, dueDate,
          ...(estimatedCents ? { estimatedCents: Math.round(Number(estimatedCents) * 100) } : {}),
          ...(notes ? { notes } : {}),
        }),
      });
      if (!res2.ok) {
        const err = await res2.json().catch(() => ({}));
        toast({ title: 'Erreur', description: (err as any).error ?? 'Impossible d\'enregistrer', variant: 'destructive' });
        return;
      }
      onSaved();
      onOpenChange(false);
      toast({ title: echeance ? 'Échéance mise à jour' : 'Échéance ajoutée' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{echeance ? 'Modifier l\'échéance' : 'Nouvelle échéance'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_META).map(([v, m]) => (
                    <SelectItem key={v} value={v}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date d'échéance *</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Libellé *</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Ex : Déclaration TVA CA3 — Juillet 2026" />
          </div>
          <div className="space-y-1.5">
            <Label>Montant estimé (€)</Label>
            <Input type="number" value={estimatedCents} onChange={e => setEstimatedCents(e.target.value)}
              placeholder="0.00" min={0} step={0.01} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note optionnelle..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !label.trim() || !dueDate}>
            {saving ? 'Enregistrement...' : echeance ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
