import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FileText, ExternalLink } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty';
import { useToast } from '@/hooks/use-toast';
import { fmtEUR, fmtDate } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type Avoir = {
  id: string;
  numero: string;
  factureRefId: string;
  montantHtCents: number;
  montantTvaCents: number;
  motif: string;
  pdfSha256?: string | null;
  createdAt: string;
};

function useAvoirs() {
  return useQuery({
    queryKey: ['avoirs'],
    queryFn: async () => {
      const res = await fetch(`${API}/avoirs`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<{ avoirs: Avoir[]; total: number }>;
    },
  });
}

export default function AvoirsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data, isLoading, isError } = useAvoirs();

  const createMut = useMutation({
    mutationFn: async (body: {
      factureRefId: string;
      montantHtCents: number;
      montantTvaCents: number;
      motif: string;
    }) => {
      const res = await fetch(`${API}/avoirs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erreur lors de la création de l\'avoir');
      return json as Avoir;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['avoirs'] });
      qc.invalidateQueries({ queryKey: ['factures'] });
      toast({ title: 'Avoir créé', description: 'La facture a été marquée comme annulée.' });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    },
  });

  const avoirs = data?.avoirs ?? [];

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Finance"
        title="Avoirs"
        description="Corrections de factures émises. Un avoir est lié à une facture EMISE et ne peut pas être modifié."
        actions={
          <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nouvel avoir
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6">
        <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-destructive">Impossible de charger les avoirs.</div>
          ) : avoirs.length === 0 ? (
            <Empty className="py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FileText /></EmptyMedia>
                <EmptyTitle>Aucun avoir</EmptyTitle>
                <EmptyDescription>Les avoirs corrigent des factures émises. Créez un avoir si vous avez besoin d'annuler ou corriger une facture.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4" /> Nouvel avoir</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <motion.table
              variants={containerVariants} initial="hidden" animate="visible"
              className="w-full text-sm"
            >
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Numéro</th>
                  <th className="px-4 py-3 font-medium">Facture annulée</th>
                  <th className="px-4 py-3 font-medium">Motif</th>
                  <th className="px-4 py-3 font-medium text-right">Montant HT</th>
                  <th className="px-4 py-3 font-medium text-right">TVA</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <AnimatePresence>
                <tbody>
                  {avoirs.map(a => (
                    <motion.tr key={a.id} layout
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-5 py-3 font-mono-nums font-medium text-foreground">{a.numero}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono-nums">{a.factureRefId.slice(0, 8)}…</td>
                      <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">{a.motif}</td>
                      <td className="px-4 py-3 text-right font-mono-nums tabular-nums">{fmtEUR(a.montantHtCents)}</td>
                      <td className="px-4 py-3 text-right font-mono-nums tabular-nums text-muted-foreground">{fmtEUR(a.montantTvaCents)}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                      <td className="px-3 py-3">
                        {a.pdfSha256 && (
                          <a href={`${API}/avoirs/${a.id}/pdf`} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <ExternalLink className="h-3.5 w-3.5" /> PDF
                          </a>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </AnimatePresence>
            </motion.table>
          )}
        </div>
      </div>

      <AvoirDialog open={dialogOpen} onOpenChange={setDialogOpen} onSave={body => createMut.mutate(body)} saving={createMut.isPending} />
    </div>
  );
}

function AvoirDialog({ open, onOpenChange, onSave, saving }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (body: { factureRefId: string; montantHtCents: number; montantTvaCents: number; motif: string }) => void;
  saving: boolean;
}) {
  const [factureRefId, setFactureRefId] = useState('');
  const [montantHT, setMontantHT] = useState('');
  const [montantTVA, setMontantTVA] = useState('0');
  const [motif, setMotif] = useState('');

  const handleSave = () => {
    if (!factureRefId.trim() || !montantHT || !motif.trim()) return;
    onSave({
      factureRefId: factureRefId.trim(),
      montantHtCents: Math.round(Number(montantHT) * 100),
      montantTvaCents: Math.round(Number(montantTVA) * 100),
      motif: motif.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvel avoir</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Un avoir annule ou corrige une facture émise. Il est irréversible une fois créé.
          </p>
          <div className="space-y-1.5">
            <Label>ID de la facture EMISE *</Label>
            <Input value={factureRefId} onChange={e => setFactureRefId(e.target.value)}
              placeholder="Collez l'ID de la facture à corriger" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Montant HT de l'avoir (€) *</Label>
              <Input type="number" value={montantHT} onChange={e => setMontantHT(e.target.value)}
                placeholder="0.00" min={0} step={0.01} />
            </div>
            <div className="space-y-1.5">
              <Label>TVA (€)</Label>
              <Input type="number" value={montantTVA} onChange={e => setMontantTVA(e.target.value)}
                placeholder="0.00" min={0} step={0.01} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Motif *</Label>
            <Textarea value={motif} onChange={e => setMotif(e.target.value)} rows={2}
              placeholder="Erreur de facturation, annulation commande..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !factureRefId.trim() || !montantHT || !motif.trim()}>
            {saving ? 'Création…' : 'Créer l\'avoir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
