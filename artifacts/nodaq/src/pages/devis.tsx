import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, FileText, MoreVertical, Pencil, Trash2,
  ArrowRightLeft, CheckCircle2, Send, XCircle, Clock,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from '@/components/ui/empty';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { fmtEUR, fmtDate } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type DevisLine = { id: string; description: string; quantity: number; unitPriceCents: number };
type Devis = {
  id: string; reference: string; clientName: string; status: string;
  lines: DevisLine[]; totalHTCents: number; totalTTCCents: number; tvaRate: number; remise: number;
  notes?: string | null; validUntil?: string | null; affaireId?: string | null;
  createdAt: string; updatedAt: string;
};

const STATUS_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  BROUILLON: { label: 'Brouillon', color: 'bg-muted text-muted-foreground border-border', icon: Clock },
  ENVOYE:    { label: 'Envoyé',    color: 'bg-blue-500/10 text-blue-400 border-blue-500/25', icon: Send },
  ACCEPTE:   { label: 'Accepté',   color: 'bg-primary/15 text-primary border-primary/25', icon: CheckCircle2 },
  REFUSE:    { label: 'Refusé',    color: 'bg-destructive/10 text-destructive border-destructive/25', icon: XCircle },
  EXPIRE:    { label: 'Expiré',    color: 'bg-orange-500/10 text-orange-400 border-orange-500/25', icon: Clock },
};

const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }));

function DevisStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.BROUILLON;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.color}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function useDevis(params: { statut?: string; search?: string }) {
  return useQuery({
    queryKey: ['devis', params],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (params.statut) sp.set('statut', params.statut);
      if (params.search) sp.set('search', params.search);
      const res = await fetch(`${API}/devis?${sp}`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<{ devis: Devis[]; total: number; totalTTC: number }>;
    },
  });
}

export default function DevisPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Devis | null>(null);

  const { data, isLoading, isError } = useDevis({
    statut: statusFilter !== 'ALL' ? statusFilter : undefined,
  });

  const devisList = useMemo(() => {
    const all = data?.devis ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(d => d.clientName.toLowerCase().includes(q) || d.reference.toLowerCase().includes(q));
  }, [data, search]);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/devis/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Suppression échouée');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devis'] });
      toast({ title: 'Devis supprimé' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    },
  });

  const convertMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/devis/${id}/convert`, { method: 'POST' });
      if (!res.ok) throw new Error('Conversion échouée');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devis'] });
      qc.invalidateQueries({ queryKey: ['affaires'] });
      toast({ title: 'Affaire créée', description: 'Le devis a été converti en affaire.' });
    },
  });

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (d: Devis) => { setEditing(d); setDialogOpen(true); };

  // Summary stats
  const stats = useMemo(() => {
    const all = data?.devis ?? [];
    return STATUS_OPTIONS.map(s => ({
      ...s,
      count: all.filter(d => d.status === s.value).length,
      total: all.filter(d => d.status === s.value).reduce((acc, d) => acc + d.totalTTCCents, 0),
    }));
  }, [data]);

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Commercial"
        title="Devis"
        description="Créez, envoyez et convertissez vos devis en affaires."
        actions={
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nouveau devis
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {/* Stats */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible"
          className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stats.map((s, i) => (
            <motion.button key={s.value} variants={itemVariants}
              onClick={() => setStatusFilter(prev => prev === s.value ? 'ALL' : s.value)}
              className={`text-left rounded-lg border p-3 hover-elevate transition-colors ${
                statusFilter === s.value ? 'border-primary bg-primary/5' : 'border-card-border bg-card'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{s.label}</div>
              <div className="font-mono-nums text-lg font-semibold mt-1">{s.count}</div>
              {s.total > 0 && (
                <div className="text-[11px] text-muted-foreground font-mono-nums truncate">{fmtEUR(s.total)}</div>
              )}
            </motion.button>
          ))}
        </motion.div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Rechercher un devis, un client..." value={search}
              onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-48">
              <SelectValue placeholder="Tous les statuts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {STATUS_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-destructive">Impossible de charger les devis.</div>
          ) : devisList.length === 0 ? (
            <Empty className="py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FileText /></EmptyMedia>
                <EmptyTitle>Aucun devis</EmptyTitle>
                <EmptyDescription>Créez votre premier devis pour démarrer.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={openCreate}><Plus className="h-4 w-4" /> Nouveau devis</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Référence</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium text-right">Total TTC</th>
                  <th className="px-4 py-3 font-medium">Validité</th>
                  <th className="px-4 py-3 font-medium">Créé le</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <AnimatePresence>
                <tbody>
                  {devisList.map(d => (
                    <motion.tr key={d.id} layout
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="border-b border-border last:border-0 hover-elevate"
                    >
                      <td className="px-5 py-3 font-mono-nums font-medium text-foreground">{d.reference}</td>
                      <td className="px-4 py-3 text-muted-foreground">{d.clientName}</td>
                      <td className="px-4 py-3"><DevisStatusBadge status={d.status} /></td>
                      <td className="px-4 py-3 text-right font-mono-nums tabular-nums font-semibold">
                        {fmtEUR(d.totalTTCCents)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {d.validUntil ? fmtDate(d.validUntil) : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(d.createdAt)}</td>
                      <td className="px-3 py-3 text-right">
                        <DevisRowMenu
                          devis={d}
                          onEdit={() => openEdit(d)}
                          onDelete={() => deleteMut.mutate(d.id)}
                          onConvert={() => convertMut.mutate(d.id)}
                          convertPending={convertMut.isPending}
                        />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </AnimatePresence>
            </table>
          )}
        </div>
      </div>

      <DevisDialog open={dialogOpen} onOpenChange={setDialogOpen} devis={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ['devis'] })} />
    </div>
  );
}

function DevisRowMenu({ devis, onEdit, onDelete, onConvert, convertPending }: {
  devis: Devis; onEdit: () => void; onDelete: () => void; onConvert: () => void; convertPending: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}><Pencil className="h-3.5 w-3.5 mr-2" />Modifier</DropdownMenuItem>
          {devis.status === 'ACCEPTE' && !devis.affaireId && (
            <DropdownMenuItem onClick={onConvert} disabled={convertPending}>
              <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />Convertir en affaire
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setConfirmOpen(true)} className="text-destructive focus:text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-2" />Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce devis ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le devis « {devis.reference} » sera définitivement supprimé.
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

function DevisDialog({ open, onOpenChange, devis, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; devis: Devis | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [clientName, setClientName] = useState('');
  const [status, setStatus] = useState('BROUILLON');
  const [tvaRate, setTvaRate] = useState(20);
  const [remise, setRemise] = useState(0);
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DevisLine[]>([
    { id: crypto.randomUUID(), description: '', quantity: 1, unitPriceCents: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (devis) {
        setClientName(devis.clientName);
        setStatus(devis.status);
        setTvaRate(devis.tvaRate);
        setRemise(devis.remise);
        setValidUntil(devis.validUntil ?? '');
        setNotes(devis.notes ?? '');
        setLines(devis.lines.length > 0 ? devis.lines : [{ id: crypto.randomUUID(), description: '', quantity: 1, unitPriceCents: 0 }]);
      } else {
        setClientName(''); setStatus('BROUILLON'); setTvaRate(20); setRemise(0);
        setValidUntil(''); setNotes('');
        setLines([{ id: crypto.randomUUID(), description: '', quantity: 1, unitPriceCents: 0 }]);
      }
    }
  }, [open, devis]);

  const subtotalHT = lines.reduce((acc, l) => acc + l.quantity * (l.unitPriceCents / 100), 0);
  const afterRemise = subtotalHT * (1 - remise / 100);
  const totalTTC = afterRemise * (1 + tvaRate / 100);

  const addLine = () => setLines(l => [...l, { id: crypto.randomUUID(), description: '', quantity: 1, unitPriceCents: 0 }]);
  const removeLine = (id: string) => setLines(l => l.filter(x => x.id !== id));
  const updateLine = (id: string, field: keyof DevisLine, val: unknown) =>
    setLines(l => l.map(x => x.id === id ? { ...x, [field]: val } : x));

  const handleSave = async () => {
    if (!clientName.trim()) return;
    setSaving(true);
    try {
      const url = devis ? `${API}/devis/${devis.id}` : `${API}/devis`;
      const method = devis ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName, status, lines, tvaRate, remise,
          ...(validUntil ? { validUntil } : {}),
          ...(notes ? { notes } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: 'Erreur', description: (err as any).error ?? 'Impossible d\'enregistrer le devis', variant: 'destructive' });
        return;
      }
      onSaved();
      onOpenChange(false);
      toast({ title: devis ? 'Devis mis à jour' : 'Devis créé' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{devis ? `Modifier ${devis.reference}` : 'Nouveau devis'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nom du client" />
            </div>
            <div className="space-y-1.5">
              <Label>Statut</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>TVA (%)</Label>
              <Input type="number" value={tvaRate} onChange={e => setTvaRate(Number(e.target.value))} min={0} max={100} />
            </div>
            <div className="space-y-1.5">
              <Label>Remise (%)</Label>
              <Input type="number" value={remise} onChange={e => setRemise(Number(e.target.value))} min={0} max={100} />
            </div>
            <div className="space-y-1.5">
              <Label>Valable jusqu'au</Label>
              <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
            </div>
          </div>

          {/* Lines */}
          <div className="space-y-2">
            <Label>Lignes</Label>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Description</th>
                    <th className="px-3 py-2 text-right font-medium w-20">Qté</th>
                    <th className="px-3 py-2 text-right font-medium w-28">P.U. HT (€)</th>
                    <th className="px-3 py-2 text-right font-medium w-24">Total HT</th>
                    <th className="px-2 py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.id} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5">
                        <Input value={line.description} onChange={e => updateLine(line.id, 'description', e.target.value)}
                          placeholder="Description..." className="h-8 text-sm border-0 bg-transparent px-1 focus-visible:ring-0" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" value={line.quantity}
                          onChange={e => updateLine(line.id, 'quantity', Number(e.target.value))}
                          className="h-8 text-sm text-right border-0 bg-transparent px-1 focus-visible:ring-0" min={1} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" value={(line.unitPriceCents / 100).toFixed(2)}
                          onChange={e => updateLine(line.id, 'unitPriceCents', Math.round(Number(e.target.value) * 100))}
                          className="h-8 text-sm text-right border-0 bg-transparent px-1 focus-visible:ring-0" min={0} step={0.01} />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono-nums text-xs text-muted-foreground">
                        {(line.quantity * line.unitPriceCents / 100).toFixed(2)} €
                      </td>
                      <td className="px-2 py-1.5">
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(line.id)} className="text-muted-foreground hover:text-destructive">
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 border-t border-border bg-muted/20">
                <Button variant="ghost" size="sm" onClick={addLine} className="h-7 gap-1 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
                </Button>
              </div>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="space-y-1 text-sm min-w-[200px]">
                <div className="flex justify-between text-muted-foreground">
                  <span>Sous-total HT</span>
                  <span className="font-mono-nums">{subtotalHT.toFixed(2)} €</span>
                </div>
                {remise > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Remise ({remise}%)</span>
                    <span className="font-mono-nums text-destructive">-{(subtotalHT * remise / 100).toFixed(2)} €</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>TVA ({tvaRate}%)</span>
                  <span className="font-mono-nums">{(afterRemise * tvaRate / 100).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-border pt-1">
                  <span>Total TTC</span>
                  <span className="font-mono-nums text-primary">{totalTTC.toFixed(2)} €</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Notes internes, conditions particulières..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !clientName.trim()}>
            {saving ? 'Enregistrement...' : devis ? 'Enregistrer' : 'Créer le devis'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
