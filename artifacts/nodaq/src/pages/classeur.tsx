import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  FolderOpen, Search, Upload, Trash2, FileText, FileCheck,
  FileSpreadsheet, FolderKanban, Plus, Download,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { fmtDate } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type ClasseurDocument = {
  id: string; name: string; category: string; size?: number | null;
  mimeType?: string | null; notes?: string | null; affaireId?: string | null; createdAt: string;
  hasContent: boolean;
};

const CATEGORIES = [
  { value: 'FACTURES',  label: 'Factures',  icon: FileSpreadsheet, color: 'text-green-400' },
  { value: 'CONTRATS',  label: 'Contrats',  icon: FileCheck,       color: 'text-blue-400' },
  { value: 'DEVIS',     label: 'Devis',     icon: FileText,        color: 'text-yellow-400' },
  { value: 'DIVERS',    label: 'Divers',    icon: FolderKanban,    color: 'text-muted-foreground' },
];

function fmtSize(bytes?: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function useClasseur(params: { category?: string; search?: string }) {
  return useQuery({
    queryKey: ['classeur', params],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (params.category) sp.set('category', params.category);
      if (params.search) sp.set('search', params.search);
      const res = await fetch(`${API}/classeur?${sp}`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<{ documents: ClasseurDocument[]; total: number }>;
    },
  });
}

export default function ClasseurPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ClasseurDocument | null>(null);

  const { data, isLoading, isError } = useClasseur({
    category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
  });

  const documents = useMemo(() => {
    const all = data?.documents ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(d => d.name.toLowerCase().includes(q));
  }, [data, search]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, ClasseurDocument[]>();
    CATEGORIES.forEach(c => map.set(c.value, []));
    documents.forEach(d => {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    });
    return map;
  }, [documents]);

  const countByCategory = useMemo(() => {
    const all = data?.documents ?? [];
    return new Map(CATEGORIES.map(c => [c.value, all.filter(d => d.category === c.value).length]));
  }, [data]);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/classeur/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Suppression échouée');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classeur'] });
      toast({ title: 'Document supprimé' });
      setToDelete(null);
    },
  });

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Documents"
        title="Classeur"
        description="Organisez et retrouvez tous vos documents par catégorie."
        actions={
          <Button onClick={() => setUploadOpen(true)} className="gap-1.5">
            <Upload className="h-4 w-4" /> Ajouter un document
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {/* Category tabs */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible"
          className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {CATEGORIES.map(cat => {
            const Icon = cat.icon;
            const count = countByCategory.get(cat.value) ?? 0;
            const active = categoryFilter === cat.value;
            return (
              <motion.button key={cat.value} variants={itemVariants}
                onClick={() => setCategoryFilter(prev => prev === cat.value ? 'ALL' : cat.value)}
                className={`text-left rounded-lg border p-4 hover-elevate transition-colors ${
                  active ? 'border-primary bg-primary/5' : 'border-card-border bg-card'
                }`}
              >
                <Icon className={`h-5 w-5 mb-2 ${cat.color}`} />
                <div className="font-medium text-sm">{cat.label}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{count} document{count !== 1 ? 's' : ''}</div>
              </motion.button>
            );
          })}
        </motion.div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Rechercher un document..." value={search}
            onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        {/* Documents */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-destructive">Impossible de charger les documents.</div>
        ) : documents.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FolderOpen /></EmptyMedia>
              <EmptyTitle>Aucun document</EmptyTitle>
              <EmptyDescription>Ajoutez vos premiers documents pour les retrouver facilement.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> Ajouter un document</Button>
            </EmptyContent>
          </Empty>
        ) : categoryFilter === 'ALL' ? (
          // Grouped view
          <div className="space-y-6">
            {CATEGORIES.map(cat => {
              const docs = grouped.get(cat.value) ?? [];
              if (docs.length === 0) return null;
              const Icon = cat.icon;
              return (
                <div key={cat.value}>
                  <div className="flex items-center gap-2 mb-3">
                    <Icon className={`h-4 w-4 ${cat.color}`} />
                    <span className="font-medium text-sm">{cat.label}</span>
                    <span className="text-xs text-muted-foreground">({docs.length})</span>
                  </div>
                  <DocumentList docs={docs} onDelete={setToDelete} />
                </div>
              );
            })}
          </div>
        ) : (
          <DocumentList docs={documents} onDelete={setToDelete} />
        )}
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen}
        onSaved={() => qc.invalidateQueries({ queryKey: ['classeur'] })} />

      <AlertDialog open={!!toDelete} onOpenChange={v => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {toDelete?.name} » sera définitivement supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && deleteMut.mutate(toDelete.id)}
              className="bg-destructive text-destructive-foreground">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DocumentList({ docs, onDelete }: { docs: ClasseurDocument[]; onDelete: (d: ClasseurDocument) => void }) {
  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 font-medium">Nom</th>
              <th className="px-4 py-3 font-medium">Catégorie</th>
              <th className="px-4 py-3 font-medium text-right">Taille</th>
              <th className="px-4 py-3 font-medium">Ajouté le</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {docs.map(doc => {
              const cat = CATEGORIES.find(c => c.value === doc.category);
              const Icon = cat?.icon ?? FileText;
              return (
                <tr key={doc.id} className="border-b border-border last:border-0 hover-elevate">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Icon className={`h-4 w-4 shrink-0 ${cat?.color ?? 'text-muted-foreground'}`} />
                      {doc.hasContent ? (
                        <a href={`${API}/classeur/${doc.id}/telechargement`} target="_blank" rel="noreferrer"
                          className="font-medium text-foreground truncate max-w-xs hover:text-primary hover:underline"
                          title="Télécharger">
                          {doc.name}
                        </a>
                      ) : (
                        <span className="font-medium text-foreground truncate max-w-xs" title="Document sans contenu archivé">
                          {doc.name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{cat?.label ?? doc.category}</td>
                  <td className="px-4 py-3 text-right font-mono-nums text-muted-foreground text-xs">{fmtSize(doc.size)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(doc.createdAt)}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {doc.hasContent && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" asChild>
                          <a href={`${API}/classeur/${doc.id}/telechargement`} target="_blank" rel="noreferrer" title="Télécharger">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => onDelete(doc)} title="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UploadDialog({ open, onOpenChange, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('DIVERS');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); if (!name) setName(f.name); }
  };

  const handleSave = async () => {
    if (!file) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (name.trim()) formData.append('name', name.trim());
      formData.append('category', category);
      if (notes) formData.append('notes', notes);

      const res = await fetch(`${API}/classeur`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: 'Erreur', description: (err as { error?: string }).error ?? "Impossible d'ajouter le document", variant: 'destructive' });
        return;
      }
      onSaved();
      onOpenChange(false);
      setName(''); setCategory('DIVERS'); setNotes(''); setFile(null);
      toast({ title: 'Document ajouté au classeur' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter un document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* File drop zone */}
          <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors">
            <Upload className="h-6 w-6 text-muted-foreground mb-1.5" />
            <span className="text-sm text-muted-foreground">
              {file ? file.name : 'Cliquez ou glissez un fichier ici'}
            </span>
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleFile} />
          </label>
          <div className="space-y-1.5">
            <Label>Nom du document</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder={file?.name ?? 'Ex : Contrat-Client-2026.pdf'} />
          </div>
          <div className="space-y-1.5">
            <Label>Catégorie</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Note optionnelle..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !file}>
            {saving ? 'Ajout...' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
