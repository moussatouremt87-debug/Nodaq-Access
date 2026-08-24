import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, FileText, ExternalLink, Send, CheckCircle2, XCircle, Clock,
  AlertCircle, MoreVertical, Trash2, Receipt, Undo2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/currency-input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from '@/components/ui/empty';
import { ToastAction } from '@/components/ui/toast';
import { BanniereConformite } from '@/components/banniere-conformite';
import { useToast } from '@/hooks/use-toast';
import { useLectureSeule } from '@/hooks/use-auth';
import { fmtEUR, fmtDate, toDateString } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';
import { useCompanyProfile } from '@/hooks/use-company-profile';

const API = '/api';

// ── Types ────────────────────────────────────────────────────────────────────

type FactureLine = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  vatRate: number;
  vatCategory: 'S' | 'Z' | 'E' | 'AE';
  unit?: string;
};

type Facture = {
  id: string;
  customerName: string;
  number: string;
  issuedDate: string;
  dueDate: string;
  amountCents: number;
  residualCents?: number | null;
  settled: boolean;
  statut: 'BROUILLON' | 'EMISE' | 'PAYEE' | 'ANNULEE_PAR_AVOIR';
  lines: FactureLine[];
  totalHTCents: number;
  totalTVACents: number;
  autoliquidation: boolean;
  attestationTvaFournie: boolean;
  pdfSha256?: string | null;
  pdfPath?: string | null;
  avoirId?: string | null;
  affaireId?: string | null;
  createdAt: string;
};

const VAT_RATES = [20, 10, 5.5, 2.1, 0] as const;

const STATUT_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  BROUILLON:          { label: 'Brouillon',       color: 'bg-muted text-muted-foreground border-border',          icon: Clock },
  EMISE:              { label: 'Émise',            color: 'bg-blue-500/10 text-blue-400 border-blue-500/25',       icon: Send },
  PAYEE:              { label: 'Payée',            color: 'bg-primary/15 text-primary border-primary/25',          icon: CheckCircle2 },
  ANNULEE_PAR_AVOIR:  { label: 'Annulée',          color: 'bg-destructive/10 text-destructive border-destructive/25', icon: XCircle },
};

function StatutBadge({ statut }: { statut: string }) {
  const meta = STATUT_META[statut] ?? STATUT_META.BROUILLON!;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.color}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useFactures(statut?: string) {
  return useQuery({
    queryKey: ['factures', statut],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (statut) sp.set('statut', statut);
      const res = await fetch(`${API}/factures?${sp}`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<{ factures: Facture[]; totalAmountCents: number; totalOverdueCents: number }>;
    },
  });
}

// ── Line editor ───────────────────────────────────────────────────────────────

function LineEditor({ lines, onChange, tvaFranchise = false }: {
  lines: FactureLine[];
  onChange: (lines: FactureLine[]) => void;
  /** Franchise en base de TVA (US-A1.3) — aucun taux ne se choisit, jamais. */
  tvaFranchise?: boolean;
}) {
  const add = () => onChange([...lines, tvaFranchise
    ? {
      id: crypto.randomUUID(), description: '', quantity: 1, unitPriceCents: 0,
      vatRate: 0, vatCategory: 'E',
    }
    : {
      id: crypto.randomUUID(), description: '', quantity: 1, unitPriceCents: 0,
      vatRate: 20, vatCategory: 'S',
    }]);

  const remove = (id: string) => onChange(lines.filter(l => l.id !== id));
  const update = (id: string, field: keyof FactureLine, val: unknown) =>
    onChange(lines.map(l => l.id === id ? { ...l, [field]: val } : l));

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-2 py-2 text-right font-medium w-16">Qté</th>
                <th className="px-2 py-2 text-right font-medium w-24">PU HT (€)</th>
                <th className="px-2 py-2 text-right font-medium w-20">TVA %</th>
                <th className="px-2 py-2 text-right font-medium w-20">Total HT</th>
                <th className="px-2 py-2 w-7" />
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const net = l.quantity * (l.unitPriceCents / 100);
                return (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5">
                      <Input value={l.description}
                        onChange={e => update(l.id, 'description', e.target.value)}
                        placeholder="Description…" className="h-7 text-xs border-0 bg-transparent px-1 focus-visible:ring-0" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="number" value={l.quantity}
                        onChange={e => update(l.id, 'quantity', Number(e.target.value))}
                        className="h-7 text-xs text-right border-0 bg-transparent px-1 focus-visible:ring-0" min={0.01} step={0.01} />
                    </td>
                    <td className="px-2 py-1.5">
                      <CurrencyInput valueCents={l.unitPriceCents}
                        onChangeCents={cents => update(l.id, 'unitPriceCents', cents)}
                        className="h-7 text-xs text-right border-0 bg-transparent px-1 focus-visible:ring-0" min={0} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {tvaFranchise ? (
                        <span className="text-xs text-muted-foreground">Franchise</span>
                      ) : (
                        <Select value={String(l.vatRate)}
                          onValueChange={v => {
                            const rate = Number(v);
                            update(l.id, 'vatRate', rate);
                            update(l.id, 'vatCategory', rate === 0 ? 'Z' : 'S');
                          }}>
                          <SelectTrigger className="h-7 text-xs border-0 bg-transparent focus:ring-0" aria-label="Taux de TVA de la ligne">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VAT_RATES.map(r => (
                              <SelectItem key={r} value={String(r)}>{r} %</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono-nums text-xs text-muted-foreground">
                      {net.toFixed(2)} €
                    </td>
                    <td className="px-1 py-1.5">
                      {lines.length > 1 && (
                        <button onClick={() => remove(l.id)} className="text-muted-foreground hover:text-destructive p-1">
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-border bg-muted/20">
          <Button variant="ghost" size="sm" onClick={add} className="h-7 gap-1 text-xs">
            <Plus className="h-3.5 w-3.5" /> Ajouter une ligne
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Create/Edit dialog ────────────────────────────────────────────────────────

function FactureDialog({ open, onOpenChange, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { tvaFranchise } = useCompanyProfile();
  const [customerName, setCustomerName] = useState('');
  const [issuedDate, setIssuedDate] = useState(toDateString(new Date()));
  const [dueDate, setDueDate] = useState('');
  const [autoliquidation, setAutoliquidation] = useState(false);
  const [attestationTvaFournie, setAttestationTvaFournie] = useState(false);
  const [lines, setLines] = useState<FactureLine[]>([{
    id: crypto.randomUUID(), description: '', quantity: 1, unitPriceCents: 0, vatRate: 20, vatCategory: 'S',
  }]);
  const [saving, setSaving] = useState(false);

  // US-A1.3 : un profil en franchise ne facture jamais de TVA — aucun champ
  // ne se demande à l'émission. Corrige les lignes déjà présentes une fois
  // le profil chargé (l'état initial ci-dessus ne peut pas encore le savoir).
  useEffect(() => {
    if (tvaFranchise) {
      setLines(prev => prev.map(l => ({ ...l, vatRate: 0, vatCategory: 'E' })));
    }
  }, [tvaFranchise]);

  const hasReducedRate = lines.some(l => l.vatRate === 10 || l.vatRate === 5.5);
  const masquerTva = autoliquidation || tvaFranchise;

  const totals = useMemo(() => {
    const totalHT = lines.reduce((acc, l) => acc + Math.round(l.quantity * l.unitPriceCents), 0);
    const totalTVA = masquerTva ? 0 : lines.reduce((acc, l) => {
      const base = Math.round(l.quantity * l.unitPriceCents);
      return acc + Math.round((base * l.vatRate) / 100);
    }, 0);
    return { totalHT, totalTVA, totalTTC: totalHT + totalTVA };
  }, [lines, masquerTva]);

  const handleSave = async () => {
    if (!customerName.trim() || !issuedDate || !dueDate) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/factures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName, issuedDate, dueDate, lines, autoliquidation, attestationTvaFournie }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: 'Erreur', description: (err as { error?: string }).error ?? 'Impossible de créer la facture', variant: 'destructive' });
        return;
      }
      onSaved();
      onOpenChange(false);
      toast({ title: 'Facture créée' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvelle facture</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nom du client" />
            </div>
            <div className="space-y-1.5">
              <Label>Date d'émission *</Label>
              <Input type="date" value={issuedDate} onChange={e => setIssuedDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Échéance *</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={autoliquidation} onCheckedChange={v => setAutoliquidation(!!v)} />
              Autoliquidation (art. 283-2 nonies CGI)
            </label>
            {hasReducedRate && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={attestationTvaFournie} onCheckedChange={v => setAttestationTvaFournie(!!v)} />
                <span className={attestationTvaFournie ? '' : 'text-orange-400'}>
                  Attestation TVA réduite reçue
                </span>
              </label>
            )}
          </div>

          {hasReducedRate && !attestationTvaFournie && (
            <div className="flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Une ligne a un taux réduit (10 % ou 5,5 %). L'attestation TVA signée par le client est obligatoire avant d'émettre.
            </div>
          )}

          <Label>Lignes</Label>
          {tvaFranchise && (
            <p className="text-xs text-muted-foreground">
              Profil en franchise en base de TVA — aucun taux ne se choisit, aucune TVA n'est facturée.
            </p>
          )}
          <LineEditor lines={lines} onChange={setLines} tvaFranchise={tvaFranchise} />

          <div className="flex justify-end">
            <div className="space-y-1 text-sm min-w-[200px]">
              <div className="flex justify-between text-muted-foreground">
                <span>Total HT</span>
                <span className="font-mono-nums">{fmtEUR(totals.totalHT)}</span>
              </div>
              {!masquerTva && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Total TVA</span>
                  <span className="font-mono-nums">{fmtEUR(totals.totalTVA)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-border pt-1">
                <span>Total TTC</span>
                <span className="font-mono-nums text-primary">{fmtEUR(totals.totalTTC)}</span>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !customerName.trim() || !issuedDate || !dueDate}>
            {saving ? 'Création…' : 'Créer le brouillon'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Emit dialog ───────────────────────────────────────────────────────────────

function EmettreDialog({ open, onOpenChange, facture, onEmit }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facture: Facture | null;
  onEmit: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [emailTo, setEmailTo] = useState('');

  const handleEmit = async () => {
    if (!facture) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/factures/${facture.id}/emettre`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issuedDate: facture.issuedDate,
          dueDate: facture.dueDate,
          sendEmail,
          emailTo: sendEmail ? emailTo : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const issues = json.issues as Array<{ code: string; message: string }> | undefined;
        const msg = issues
          ? issues.map(i => i.message).join('\n')
          : (json.error as string ?? 'Erreur d\'émission');
        toast({ title: 'Émission bloquée', description: msg, variant: 'destructive' });
        return;
      }
      toast({ title: `Facture ${json.number} émise`, description: sendEmail ? 'Envoyée par e-mail.' : undefined });
      qc.invalidateQueries({ queryKey: ['factures'] });
      onOpenChange(false);
      onEmit();
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Émettre la facture</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <p className="text-muted-foreground">
            L'émission verrouille définitivement la facture. Toute correction ultérieure
            devra passer par un avoir.
          </p>
          {facture?.lines.some(l => l.vatRate === 10 || l.vatRate === 5.5) && !facture.attestationTvaFournie && (
            <div className="flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-400">
              <AlertCircle className="h-3.5 w-3.5" />
              Cette facture contient des lignes à taux réduit sans attestation TVA cochée. L'émission sera bloquée.
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={sendEmail} onCheckedChange={v => setSendEmail(!!v)} />
            Envoyer par e-mail après émission
          </label>
          {sendEmail && (
            <div className="space-y-1.5">
              <Label>Adresse e-mail du client</Label>
              <Input type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="client@exemple.fr" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleEmit} disabled={sending || (sendEmail && !emailTo.trim())}>
            {sending ? 'Émission…' : 'Émettre et verrouiller'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FacturesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const lectureSeule = useLectureSeule();
  const [statutFilter, setStatutFilter] = useState('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [emettreOpen, setEmettreOpen] = useState(false);
  const [selectedFacture, setSelectedFacture] = useState<Facture | null>(null);

  const { data, isLoading, isError } = useFactures(
    statutFilter !== 'ALL' ? statutFilter : undefined,
  );

  /**
   * Annule le dernier règlement. Le serveur écrit une contre-passation — le
   * journal des règlements est en ajout seul, rien n'y est jamais supprimé.
   */
  const annulerPaiementMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/factures/${id}/annuler-paiement`, { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Annulation impossible");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factures'] });
      toast({ title: 'Règlement annulé', description: 'La facture est de nouveau à encaisser.' });
    },
    onError: (e: Error) =>
      toast({ title: "Rien n'a été annulé", description: e.message, variant: 'destructive' }),
  });

  const payerMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/factures/${id}/payer`, { method: 'POST' });
      if (!res.ok) throw new Error('Erreur');
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['factures'] });
      // Le retour en arrière est proposé AU MOMENT du geste, pas caché dans un
      // menu qu'il faudra retrouver. « J'ai cliqué par accident » se répare là
      // où l'accident vient d'avoir lieu.
      toast({
        title: 'Facture marquée comme payée',
        description: 'Ce n’était pas voulu ? Annulez tout de suite.',
        action: (
          <ToastAction altText="Annuler le règlement" onClick={() => annulerPaiementMut.mutate(id)}>
            Annuler
          </ToastAction>
        ),
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/factures/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Suppression échouée');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factures'] });
      toast({ title: 'Facture supprimée' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    },
  });

  const factures = data?.factures ?? [];

  const stats = useMemo(() => {
    const statuts = ['BROUILLON', 'EMISE', 'PAYEE', 'ANNULEE_PAR_AVOIR'] as const;
    return statuts.map(s => ({
      key: s,
      label: STATUT_META[s]?.label ?? s,
      count: factures.filter(f => f.statut === s).length,
      total: factures.filter(f => f.statut === s).reduce((acc, f) => acc + f.amountCents, 0),
    }));
  }, [factures]);

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Finance"
        title="Factures"
        description="Émettez des factures conformes avec numérotation séquentielle et Factur-X intégré."
        actions={
          // US-A5.4 — un tiers de confiance consulte les factures, il n'en
          // émet pas. Le serveur refuse de toute façon ; on évite juste de
          // proposer un bouton qui mènerait à une erreur.
          lectureSeule ? null : (
            <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> Nouvelle facture
            </Button>
          )
        }
      />

      {/* Ticket 4.36 lot B — sur le cockpit ET ici : c'est l'écran où l'on
          pense à ses factures, donc celui où l'information trouve son moment. */}
      <div className="mb-4"><BanniereConformite /></div>

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {/* Stats */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible"
          className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map(s => (
            <motion.button key={s.key} variants={itemVariants}
              onClick={() => setStatutFilter(prev => prev === s.key ? 'ALL' : s.key)}
              className={`text-left rounded-lg border p-3 hover-elevate transition-colors ${
                statutFilter === s.key ? 'border-primary bg-primary/5' : 'border-card-border bg-card'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="font-mono-nums text-lg font-semibold mt-1">{s.count}</div>
              {s.total > 0 && <div className="text-[11px] text-muted-foreground font-mono-nums">{fmtEUR(s.total)}</div>}
            </motion.button>
          ))}
        </motion.div>

        {/* Filter */}
        <div className="flex gap-3">
          <Select value={statutFilter} onValueChange={setStatutFilter}>
            <SelectTrigger className="w-48" aria-label="Filtrer par statut">
              <SelectValue placeholder="Tous les statuts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les statuts</SelectItem>
              {['BROUILLON', 'EMISE', 'PAYEE', 'ANNULEE_PAR_AVOIR'].map(s => (
                <SelectItem key={s} value={s}>{STATUT_META[s]?.label ?? s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary */}
        {data && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>Total émis : <strong className="text-foreground font-mono-nums">{fmtEUR(data.totalAmountCents)}</strong></span>
            {data.totalOverdueCents > 0 && (
              <span className="text-orange-400">Impayés en retard : <strong className="font-mono-nums">{fmtEUR(data.totalOverdueCents)}</strong></span>
            )}
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-destructive">Impossible de charger les factures.</div>
          ) : factures.length === 0 ? (
            <Empty className="py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Receipt /></EmptyMedia>
                <EmptyTitle>Aucune facture</EmptyTitle>
                <EmptyDescription>Créez votre première facture conforme avec numérotation légale et Factur-X.</EmptyDescription>
              </EmptyHeader>
              {!lectureSeule && (
                <EmptyContent>
                  <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4" /> Nouvelle facture</Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Numéro</th>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Statut</th>
                    <th className="px-4 py-3 font-medium text-right">Total TTC</th>
                    <th className="px-4 py-3 font-medium">Échéance</th>
                    <th className="px-4 py-3 font-medium">PDF</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <AnimatePresence>
                  <tbody>
                    {factures.map(f => (
                      <motion.tr key={f.id} layout
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="border-b border-border last:border-0 hover-elevate"
                      >
                        <td className="px-5 py-3 font-mono-nums font-medium text-foreground">
                          {f.number || <span className="text-muted-foreground italic text-xs">Brouillon</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{f.customerName}</td>
                        <td className="px-4 py-3"><StatutBadge statut={f.statut} /></td>
                        <td className="px-4 py-3 text-right font-mono-nums tabular-nums font-semibold">
                          {fmtEUR(f.amountCents)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(f.dueDate)}</td>
                        <td className="px-4 py-3">
                          {f.pdfSha256 ? (
                            <a href={`${API}/factures/${f.id}/pdf`} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                              <ExternalLink className="h-3.5 w-3.5" /> PDF
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <FactureRowMenu
                            facture={f}
                            onEmettre={() => { setSelectedFacture(f); setEmettreOpen(true); }}
                            onPayer={() => payerMut.mutate(f.id)}
                            onAnnulerPaiement={() => annulerPaiementMut.mutate(f.id)}
                            onDelete={() => deleteMut.mutate(f.id)}
                          />
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </AnimatePresence>
              </table>
            </div>
          )}
        </div>
      </div>

      <FactureDialog open={dialogOpen} onOpenChange={setDialogOpen}
        onSaved={() => qc.invalidateQueries({ queryKey: ['factures'] })} />

      <EmettreDialog open={emettreOpen} onOpenChange={setEmettreOpen}
        facture={selectedFacture}
        onEmit={() => qc.invalidateQueries({ queryKey: ['factures'] })} />
    </div>
  );
}

function FactureRowMenu({ facture, onEmettre, onPayer, onAnnulerPaiement, onDelete }: {
  facture: Facture;
  onEmettre: () => void;
  onPayer: () => void;
  onAnnulerPaiement: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lectureSeule = useLectureSeule();
  // US-A5.4 — pour un tiers de confiance, il ne reste dans ce menu que la
  // consultation du PDF. Les trois actions mutantes (émettre, marquer payée,
  // supprimer) disparaissent ; le serveur les refuserait de toute façon.
  const isBrouillon = facture.statut === 'BROUILLON' && !lectureSeule;
  const isEmise = facture.statut === 'EMISE' && !lectureSeule;
  // Le bandeau d'annulation immédiate ne couvre que l'instant du clic. Celui
  // qui s'en aperçoit le lendemain doit pouvoir revenir en arrière aussi.
  const isPayee = facture.statut === 'PAYEE' && !lectureSeule;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isBrouillon && (
            <DropdownMenuItem onClick={onEmettre}>
              <Send className="h-3.5 w-3.5 mr-2" /> Émettre
            </DropdownMenuItem>
          )}
          {isEmise && (
            <DropdownMenuItem onClick={onPayer}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Marquer payée
            </DropdownMenuItem>
          )}
          {isPayee && (
            <DropdownMenuItem onClick={onAnnulerPaiement} data-testid="annuler-paiement">
              <Undo2 className="h-3.5 w-3.5 mr-2" /> Annuler le règlement
            </DropdownMenuItem>
          )}
          {facture.pdfSha256 && (
            <DropdownMenuItem asChild>
              <a href={`/api/factures/${facture.id}/pdf`} target="_blank" rel="noreferrer">
                <FileText className="h-3.5 w-3.5 mr-2" /> Voir PDF
              </a>
            </DropdownMenuItem>
          )}
          {isBrouillon && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirmDelete(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce brouillon ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le brouillon de facture sera définitivement supprimé. Cette action est irréversible.
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
