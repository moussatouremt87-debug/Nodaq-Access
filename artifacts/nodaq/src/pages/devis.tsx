import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, FileText, MoreVertical, Pencil, Trash2,
  ArrowRightLeft, CheckCircle2, Send, XCircle, Clock, Copy, ExternalLink, Link2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrencyInput } from '@/components/currency-input';
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
import { useVertical } from '@/hooks/use-vertical';
import { fmtEUR, fmtDate } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type DevisLine = { id: string; description: string; quantity: number; unitPriceCents: number };
type Devis = {
  id: string; reference: string; clientName: string; status: string;
  lines: DevisLine[]; totalHTCents: number; totalTTCCents: number; tvaRate: number; remise: number;
  notes?: string | null; validUntil?: string | null; affaireId?: string | null;
  // Plus d'`acceptToken` : le jeton n'est plus stocké, seul son condensat l'est.
  // L'URL d'acceptation n'existe qu'UNE fois, dans la réponse à l'envoi.
  dateEnvoi?: string | null;
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
  const { proposalWord } = useVertical();
  const [search, setSearch] = useState('');
  /**
   * Le filtre de départ vient de l'URL quand elle en porte un.
   *
   * Sans ça, un lien « Voir les 3 devis en attente » ouvrait la liste COMPLÈTE :
   * l'écran était le bon, mais le compte annoncé ne correspondait à rien de ce
   * qui s'affichait, ce qui est une autre façon de mentir.
   */
  const [statusFilter, setStatusFilter] = useState(() => {
    const depuisUrl = new URLSearchParams(window.location.search).get('statut');
    return depuisUrl && depuisUrl in STATUS_META ? depuisUrl : 'ALL';
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Devis | null>(null);
  /** Rempli par la réponse à l'envoi — la seule occasion de voir le lien. */
  const [linkDialogDevis, setLinkDialogDevis] = useState<(Devis & { acceptUrl: string }) | null>(null);
  /** Devis currently open in the "Envoyer" email-input dialog */
  const [sendDialogDevis, setSendDialogDevis] = useState<Devis | null>(null);
  /** Devis pour lequel on demande confirmation avant de REMPLACER le lien. */
  const [nouveauLienDevis, setNouveauLienDevis] = useState<Devis | null>(null);

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

  const sendMut = useMutation({
    mutationFn: async ({ id, emailTo, message }: { id: string; emailTo: string; message?: string }) => {
      const res = await fetch(`${API}/devis/${id}/envoyer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailTo, message }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Envoi impossible');
      return res.json() as Promise<Devis & { acceptUrl: string; lienReutilise: boolean }>;
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['devis'] });
      setSendDialogDevis(null);
      if (updated.lienReutilise) {
        // Renvoi : le MÊME lien est reparti, l'ancien e-mail reste valide. Rien
        // de neuf à montrer, et surtout rien à faire croire qu'on a remplacé.
        toast({
          title: 'Devis renvoyé',
          description: 'Le même lien d\'acceptation a été renvoyé. Le précédent reste valide.',
        });
      } else {
        setLinkDialogDevis(updated);
      }
    },
    onError: (err: Error) => {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    },
  });

  /**
   * Remplace le lien d'acceptation. Action SÉPARÉE du renvoi, et destructrice :
   * l'ancien lien cesse de fonctionner. Elle n'existe que pour l'artisan qui
   * doit transmettre le lien autrement — SMS, messagerie — et a donc besoin de
   * le voir. Confirmation exigée avant appel.
   */
  const nouveauLienMut = useMutation({
    mutationFn: async (devis: Devis) => {
      const res = await fetch(`${API}/devis/${devis.id}/nouveau-lien`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Impossible d\'engendrer un lien');
      const j = await res.json() as { acceptUrl: string };
      return { ...devis, acceptUrl: j.acceptUrl };
    },
    onSuccess: (avecLien) => {
      setNouveauLienDevis(null);
      setLinkDialogDevis(avecLien);
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
        title={proposalWord}
        description="Créez, envoyez et convertissez vos devis en affaires."
        actions={
          // Pas de "Nouveau"/"Nouvelle" devant `proposalWord` : ce champ n'a
          // pas d'accord de genre (voir verticalPacks.ts) — le nom seul reste
          // grammaticalement correct dans les deux cas ("Devis", "Proposition
          // commerciale").
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> {proposalWord}
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
            <SelectTrigger className="sm:w-48" aria-label="Filtrer par statut">
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
                <Button onClick={openCreate}><Plus className="h-4 w-4" /> {proposalWord}</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <>
            {/* Sous `md:`, des CARTES — mêmes composants qu'au tableau. */}
            <div className="md:hidden divide-y divide-border">
              {devisList.map(d => (
                <div key={d.id} className="px-4 py-3 space-y-1.5" data-testid={`carte-devis-${d.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono-nums font-medium text-foreground truncate min-w-0">{d.reference}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <DevisStatusBadge status={d.status} />
                      <DevisRowMenu devis={d}
                        onEdit={() => openEdit(d)}
                        onDelete={() => deleteMut.mutate(d.id)}
                        onConvert={() => convertMut.mutate(d.id)}
                        onSend={() => setSendDialogDevis(d)}
                        onNouveauLien={() => setNouveauLienDevis(d)}
                        convertPending={convertMut.isPending}
                        sendPending={sendMut.isPending && sendMut.variables?.id === d.id} />
                    </div>
                  </div>
                  <div className="text-muted-foreground truncate min-w-0">{d.clientName}</div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono-nums tabular-nums font-semibold text-foreground">
                      {fmtEUR(d.totalTTCCents)}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(d.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
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
                            onSend={() => setSendDialogDevis(d)}
                            onNouveauLien={() => setNouveauLienDevis(d)}
                            convertPending={convertMut.isPending}
                            sendPending={sendMut.isPending && sendMut.variables?.id === d.id}
                          />
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </AnimatePresence>
              </table>
            </div>
            </>
          )}
        </div>
      </div>

      <DevisDialog open={dialogOpen} onOpenChange={setDialogOpen} devis={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ['devis'] })} />

      {/* Step 1: collect email before calling envoyer */}
      <SendDevisDialog
        devis={sendDialogDevis}
        open={!!sendDialogDevis}
        onOpenChange={open => { if (!open) setSendDialogDevis(null); }}
        onSend={(id, emailTo, message) => sendMut.mutate({ id, emailTo, message })}
        sending={sendMut.isPending}
        sendError={sendMut.error instanceof Error ? sendMut.error.message : null}
      />

      {/* Remplacement du lien — confirmation obligatoire, parce que l'action
          est destructrice et que ses dégâts tombent sur le CLIENT. */}
      <AlertDialog
        open={!!nouveauLienDevis}
        onOpenChange={(open) => { if (!open) setNouveauLienDevis(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Engendrer un nouveau lien d'acceptation ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le lien déjà envoyé à {nouveauLienDevis?.clientName} cessera de
              fonctionner immédiatement. S'il clique sur l'ancien message, il
              lira « lien invalide ou expiré ».
              <br /><br />
              Pour simplement renvoyer le devis, employez « Renvoyer au
              client » : le même lien repart et reste valide.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (nouveauLienDevis) nouveauLienMut.mutate(nouveauLienDevis); }}
              disabled={nouveauLienMut.isPending}
            >
              Engendrer un nouveau lien
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Step 2: display accept link after successful send */}
      <AcceptLinkDialog
        devis={linkDialogDevis}
        open={!!linkDialogDevis}
        onOpenChange={open => { if (!open) setLinkDialogDevis(null); }}
      />
    </div>
  );
}

function DevisRowMenu({ devis, onEdit, onDelete, onConvert, onSend, onNouveauLien, convertPending, sendPending }: {
  devis: Devis; onEdit: () => void; onDelete: () => void; onConvert: () => void;
  onSend: () => void; onNouveauLien: () => void; convertPending: boolean; sendPending: boolean;
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
          {(devis.status === 'BROUILLON' || devis.status === 'ENVOYE') && (
            <DropdownMenuItem onClick={onSend} disabled={sendPending}>
              <Send className="h-3.5 w-3.5 mr-2" />
              {devis.dateEnvoi ? 'Renvoyer au client' : 'Envoyer au client'}
            </DropdownMenuItem>
          )}
          {/* Action DISTINCTE du renvoi, et nommée pour ce qu'elle fait.
              Le renvoi réutilise le lien existant ; celle-ci le REMPLACE, et
              l'ancien cesse de fonctionner. Elle n'a de sens qu'une fois le
              devis parti, et seulement pour l'artisan qui doit transmettre le
              lien autrement — SMS, messagerie — donc le voir. */}
          {devis.dateEnvoi && devis.status !== 'ACCEPTE' && (
            <DropdownMenuItem onClick={onNouveauLien}>
              <Link2 className="h-3.5 w-3.5 mr-2" />
              Engendrer un nouveau lien…
            </DropdownMenuItem>
          )}
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

/** Dialog that collects the client email before calling POST /devis/:id/envoyer. */
function SendDevisDialog({ devis, open, onOpenChange, onSend, sending, sendError }: {
  devis: Devis | null; open: boolean; onOpenChange: (v: boolean) => void;
  onSend: (id: string, emailTo: string, message?: string) => void;
  sending: boolean; sendError: string | null;
}) {
  const [emailTo, setEmailTo] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (open) { setEmailTo(''); setMessage(''); }
  }, [open]);

  if (!devis) return null;

  const handleSend = () => {
    if (!emailTo.trim()) return;
    onSend(devis.id, emailTo.trim(), message.trim() || undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            Envoyer le devis {devis.reference}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="emailTo">Adresse e-mail du client *</Label>
            <Input
              id="emailTo"
              type="email"
              value={emailTo}
              onChange={e => setEmailTo(e.target.value)}
              placeholder="client@exemple.com"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="msg">Message personnalisé (optionnel)</Label>
            <Textarea
              id="msg"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              placeholder="Bonjour, veuillez trouver ci-joint votre devis..."
            />
          </div>
          {sendError && <p className="text-sm text-destructive">{sendError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSend} disabled={sending || !emailTo.trim()} className="gap-1.5">
            {sending ? 'Envoi en cours...' : <><Send className="h-4 w-4" /> Envoyer</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog showing the accept link for a sent devis. */
function AcceptLinkDialog({ devis, open, onOpenChange }: {
  devis: (Devis & { acceptUrl: string }) | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  if (!devis) return null;

  // L'URL vient de la RÉPONSE À L'ENVOI et de nulle part ailleurs : le jeton
  // n'étant plus stocké, il n'est pas reconstructible après coup. C'est le prix
  // de ne plus garder un porteur en base, et il est assumé — l'artisan renvoie
  // le devis, ce qui engendre un nouveau lien.
  const acceptUrl = devis.acceptUrl ?? null;

  const copyLink = () => {
    if (!acceptUrl) return;
    navigator.clipboard.writeText(acceptUrl).then(() =>
      toast({ title: 'Lien copié', description: 'Collez-le dans votre email au client.' })
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            Devis {devis.reference} — lien d'acceptation
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Envoyez ce lien à <span className="font-medium text-foreground">{devis.clientName}</span> pour
            qu'il puisse accepter le devis en ligne.
          </p>
          {acceptUrl ? (
            <div className="flex gap-2 items-center">
              <div className="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-mono text-muted-foreground truncate">
                {acceptUrl}
              </div>
              <Button size="sm" variant="outline" onClick={copyLink} className="shrink-0 gap-1.5">
                <Copy className="h-3.5 w-3.5" /> Copier
              </Button>
              <Button size="sm" variant="outline" asChild className="shrink-0 gap-1.5">
                <a href={acceptUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-destructive">
              Ce lien ne s'affiche qu'une fois. Il reste valide et « Renvoyer au
              client » le réexpédie tel quel ; pour en obtenir un affichable,
              employez « Engendrer un nouveau lien » — l'ancien cessera alors de
              fonctionner.
            </p>
          )}
          {devis.dateEnvoi && (
            <p className="text-xs text-muted-foreground">
              Envoyé le {new Date(devis.dateEnvoi).toLocaleDateString('fr-FR', { dateStyle: 'long' })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
          {acceptUrl && (
            <Button onClick={copyLink} className="gap-1.5">
              <Copy className="h-4 w-4" /> Copier le lien
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nom du client" />
            </div>
            <div className="space-y-1.5">
              <Label>Statut</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger aria-label="Statut du devis"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
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
                          <CurrencyInput valueCents={line.unitPriceCents}
                            onChangeCents={cents => updateLine(line.id, 'unitPriceCents', cents)}
                            className="h-8 text-sm text-right border-0 bg-transparent px-1 focus-visible:ring-0" min={0} />
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
              </div>
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
