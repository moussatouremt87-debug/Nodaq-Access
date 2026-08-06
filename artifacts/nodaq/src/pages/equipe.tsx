import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, MoreVertical, Pencil, Trash2, CheckCircle2,
  Clock, AlertCircle, RefreshCw, UserPlus, TrendingUp,
  CalendarOff,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
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
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/auth';

const API = '/api';

// ── Types ─────────────────────────────────────────────────────────────────
type ScheduleSlot = { day: string; affaireId: string | null };
type TeamMember = {
  id: string; name: string; role: string; email?: string | null;
  availability: 'DISPONIBLE' | 'PARTIEL' | 'ABSENT'; schedule: ScheduleSlot[];
  createdAt: string; updatedAt: string;
};
type CapacityRow = {
  mois: string; capaciteH: number; chargeH: number; ecartH: number; verdict: string;
};
type PerformanceRow = {
  mois: string; heuresEstimees: number; caRealise: number;
  eurosParHeure: number | null; verdict: string;
};
type PlanningData = {
  capacity: CapacityRow[]; performance: PerformanceRow[]; tauxHoraire: number;
};
type Absence = {
  id: string; membreId: string; type: string; dateDebut: string; dateFin: string;
};

const DAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const DAY_LABELS: Record<string, string> = {
  LUN: 'Lun', MAR: 'Mar', MER: 'Mer', JEU: 'Jeu', VEN: 'Ven', SAM: 'Sam', DIM: 'Dim',
};
const AVAIL_META = {
  DISPONIBLE: { label: 'Disponible', color: 'text-primary', icon: CheckCircle2 },
  PARTIEL:    { label: 'Partiel',    color: 'text-yellow-400', icon: Clock },
  ABSENT:     { label: 'Absent',     color: 'text-destructive', icon: AlertCircle },
};
const VERDICT_STYLE: Record<string, string> = {
  'ok':            'text-primary',
  'limite':        'text-yellow-400',
  'sous-capacité': 'text-destructive font-semibold',
  'sous-objectif': 'text-destructive font-semibold',
  'inconnu':       'text-muted-foreground',
};

// ── Data hooks ────────────────────────────────────────────────────────────
function useTeam() {
  return useQuery<TeamMember[]>({
    queryKey: ['equipe'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/equipe`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json();
    },
  });
}

function useAffaires() {
  return useQuery<{ affaires: Affaire[] }>({
    queryKey: ['affaires'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/affaires`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json();
    },
    staleTime: 60_000,
  });
}

function usePlannings() {
  return useQuery<PlanningData>({
    queryKey: ['equipe-plannings'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/equipe/plannings`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json();
    },
  });
}

function useAbsences() {
  return useQuery<Absence[]>({
    queryKey: ['equipe-absences'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/equipe/absences`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json();
    },
  });
}

// ── Capacity table ────────────────────────────────────────────────────────
function CapaciteTable({ rows, tauxHoraire, onTauxChange }: {
  rows: CapacityRow[]; tauxHoraire: number; onTauxChange: (v: number) => void;
}) {
  const [taux, setTaux] = useState(String(tauxHoraire));
  const [dirty, setDirty] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  useEffect(() => { setTaux(String(tauxHoraire)); setDirty(false); }, [tauxHoraire]);

  const handleRecalc = async () => {
    const val = Number(taux);
    if (!Number.isFinite(val) || val <= 0) return;
    const res = await apiFetch(`${API}/equipe/plannings/taux`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tauxHoraire: val }),
    });
    if (res.ok) { qc.invalidateQueries({ queryKey: ['equipe-plannings'] }); onTauxChange(val); setDirty(false); toast({ title: 'Taux mis à jour' }); }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Capacité vs charge estimée
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          estimation — charge dérivée de la prévision de ventes
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {['Mois', 'Capacité', 'Charge estimée', 'Écart', 'Verdict'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr key={r.mois}>
                <td className="px-4 py-2.5 font-mono-nums text-sm">{r.mois}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.capaciteH > 0 ? `${r.capaciteH} h` : '0 h'}</td>
                <td className="px-4 py-2.5">{r.chargeH > 0 ? `${r.chargeH} h` : '—'}</td>
                <td className="px-4 py-2.5 font-mono-nums">{r.chargeH > 0 ? `${r.ecartH > 0 ? '+' : ''}${r.ecartH} h` : '—'}</td>
                <td className={cn('px-4 py-2.5 text-sm', VERDICT_STYLE[r.verdict] ?? 'text-muted-foreground')}>
                  {r.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-border flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Taux horaire facturé moyen (€/h) :</span>
        <Input
          className="h-8 w-20 font-mono-nums"
          value={taux}
          onChange={e => { setTaux(e.target.value); setDirty(e.target.value !== String(tauxHoraire)); }}
          type="number" min={1}
        />
        <Button size="sm" variant="outline" onClick={handleRecalc} disabled={!dirty}>
          Recalculer
        </Button>
      </div>
    </div>
  );
}

// ── Performance table ─────────────────────────────────────────────────────
function PerformanceTable({ rows }: { rows: PerformanceRow[] }) {
  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold text-foreground">Performance horaire réalisée</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          estimation — heures dérivées des contrats actuels (pas d'un pointage), CA des factures
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {['Mois', 'Heures estimées', 'CA réalisé', '€/h réalisé', 'Verdict'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(r => (
              <tr key={r.mois}>
                <td className="px-4 py-2.5 font-mono-nums text-sm">{r.mois}</td>
                <td className="px-4 py-2.5">{r.heuresEstimees > 0 ? `${r.heuresEstimees} h` : '0 h'}</td>
                <td className="px-4 py-2.5 font-mono-nums">{r.caRealise.toLocaleString('fr-FR')} €</td>
                <td className="px-4 py-2.5 font-mono-nums">{r.eurosParHeure !== null ? `${r.eurosParHeure} €/h` : '—'}</td>
                <td className={cn('px-4 py-2.5 text-sm', VERDICT_STYLE[r.verdict] ?? 'text-muted-foreground')}>
                  {r.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Absence section ───────────────────────────────────────────────────────
function AbsencesSection({ members, absences }: { members: TeamMember[]; absences: Absence[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [membreId, setMembreId] = useState('__none__');
  const [type, setType] = useState<'Congés' | 'Maladie' | 'RTT' | 'Autre'>('Congés');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (membreId === '__none__' || !dateDebut || !dateFin) return;
    setSaving(true);
    try {
      const res = await apiFetch(`${API}/equipe/absences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membreId, type, dateDebut, dateFin }),
      });
      if (!res.ok) throw new Error('Échec');
      qc.invalidateQueries({ queryKey: ['equipe-absences'] });
      setMembreId('__none__'); setDateDebut(''); setDateFin('');
      toast({ title: 'Absence enregistrée' });
    } catch (e: any) {
      toast({ title: 'Erreur', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <CalendarOff className="h-4 w-4 text-muted-foreground" />
          Absences
        </h2>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Select value={membreId} onValueChange={setMembreId}>
            <SelectTrigger><SelectValue placeholder="— salarié —" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— salarié —</SelectItem>
              {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={v => setType(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['Congés', 'Maladie', 'RTT', 'Autre'].map(t => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)} placeholder="Début" />
          <Input type="date" value={dateFin} onChange={e => setDateFin(e.target.value)} placeholder="Fin" />
        </div>
        <Button onClick={handleAdd} disabled={saving || membreId === '__none__' || !dateDebut || !dateFin}>
          {saving ? 'Enregistrement...' : "Ajouter l'absence"}
        </Button>

        {absences.length > 0 && (
          <div className="border-t border-border pt-4 space-y-2">
            {absences.map(a => {
              const m = members.find(mb => mb.id === a.membreId);
              return (
                <div key={a.id} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/30">
                  <span className="font-medium">{m?.name ?? '—'}</span>
                  <span className="text-muted-foreground">{a.type}</span>
                  <span className="font-mono-nums text-xs text-muted-foreground">
                    {a.dateDebut} → {a.dateFin}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function EquipePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: members = [], isLoading: membersLoading } = useTeam();
  const { data: planning, isLoading: planningLoading } = usePlannings();
  const { data: absences = [] } = useAbsences();
  const { data: affairesData } = useAffaires();
  const affaires = affairesData?.affaires ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [toDelete, setToDelete] = useState<TeamMember | null>(null);

  // Inline add form state
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [addingInline, setAddingInline] = useState(false);

  const activeCount = members.filter(m => m.availability !== 'ABSENT').length;

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`${API}/equipe/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Suppression échouée');
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipe'] }); toast({ title: 'Membre supprimé' }); setToDelete(null); },
    onError: (err: Error) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const handleInlineAdd = async () => {
    if (!newName.trim()) return;
    setAddingInline(true);
    try {
      const res = await apiFetch(`${API}/equipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          role: newRole.trim() || 'Collaborateur',
          availability: 'DISPONIBLE',
          schedule: DAYS.map(day => ({ day, affaireId: null })),
        }),
      });
      if (!res.ok) throw new Error('Échec');
      qc.invalidateQueries({ queryKey: ['equipe'] });
      qc.invalidateQueries({ queryKey: ['equipe-plannings'] });
      setNewName(''); setNewRole('');
      toast({ title: 'Membre ajouté' });
    } catch (e: any) {
      toast({ title: 'Erreur', description: e.message, variant: 'destructive' });
    } finally {
      setAddingInline(false);
    }
  };

  const handleSilaeSync = () => {
    toast({ title: 'Synchronisation Silae', description: 'Connecteur non configuré — action simulée.' });
  };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Plateforme"
        title="Équipe & plannings"
        description="Gérez vos collaborateurs, suivez la capacité et enregistrez les absences."
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">

        {/* ── Capacité vs charge estimée ── */}
        {planningLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : planning ? (
          <CapaciteTable
            rows={planning.capacity}
            tauxHoraire={planning.tauxHoraire}
            onTauxChange={() => {}}
          />
        ) : null}

        {/* ── Performance horaire réalisée ── */}
        {planningLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : planning ? (
          <PerformanceTable rows={planning.performance} />
        ) : null}

        {/* ── Équipe ── */}
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Équipe ({activeCount} actif{activeCount !== 1 ? 's' : ''})
            </h2>
            <Button size="sm" variant="outline" onClick={handleSilaeSync} className="gap-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Synchroniser depuis Silae
            </Button>
          </div>

          {/* Inline add form */}
          <div className="px-5 py-4 border-b border-border bg-muted/10">
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1 flex-1 min-w-32">
                <Label className="text-xs">Nom</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="Prénom Nom" className="h-9" />
              </div>
              <div className="space-y-1 flex-1 min-w-32">
                <Label className="text-xs">Rôle (ex. technicien)</Label>
                <Input value={newRole} onChange={e => setNewRole(e.target.value)}
                  placeholder="Technicien" className="h-9" />
              </div>
              <Button onClick={handleInlineAdd} disabled={addingInline || !newName.trim()}
                className="h-9 gap-1.5">
                <UserPlus className="h-4 w-4" /> Ajouter
              </Button>
            </div>
          </div>

          {/* Member list */}
          {membersLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : members.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Aucun membre — ajoutez-en un ci-dessus.
            </div>
          ) : (
            <AnimatePresence>
              {members.map(m => {
                const meta = AVAIL_META[m.availability] ?? AVAIL_META.DISPONIBLE;
                const Icon = meta.icon;
                return (
                  <motion.div key={m.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-0">
                    <div className="h-9 w-9 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-semibold text-sidebar-primary shrink-0">
                      {m.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-foreground">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.role}</div>
                    </div>
                    <span className={cn('inline-flex items-center gap-1 text-xs font-medium shrink-0', meta.color)}>
                      <Icon className="h-3.5 w-3.5" /> {meta.label}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditing(m); setDialogOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setToDelete(m)} className="text-destructive focus:text-destructive">
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* ── Absences ── */}
        <AbsencesSection members={members} absences={absences} />
      </div>

      {/* Edit dialog */}
      <MemberDialog
        open={dialogOpen} onOpenChange={setDialogOpen} member={editing}
        affaires={affaires}
        onSaved={() => { qc.invalidateQueries({ queryKey: ['equipe'] }); qc.invalidateQueries({ queryKey: ['equipe-plannings'] }); }}
      />

      <AlertDialog open={!!toDelete} onOpenChange={v => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer {toDelete?.name} ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
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

// ── Edit/Create dialog (retained from original) ───────────────────────────
type Affaire = { id: string; label: string };

function MemberDialog({ open, onOpenChange, member, affaires, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; member: TeamMember | null;
  affaires: Affaire[]; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [role, setRole] = useState('Collaborateur');
  const [email, setEmail] = useState('');
  const [availability, setAvailability] = useState<'DISPONIBLE' | 'PARTIEL' | 'ABSENT'>('DISPONIBLE');
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(DAYS.map(day => ({ day, affaireId: null })));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (member) {
        setName(member.name); setRole(member.role); setEmail(member.email ?? '');
        setAvailability(member.availability);
        setSchedule(DAYS.map(day => member.schedule.find(s => s.day === day) ?? { day, affaireId: null }));
      } else {
        setName(''); setRole('Collaborateur'); setEmail(''); setAvailability('DISPONIBLE');
        setSchedule(DAYS.map(day => ({ day, affaireId: null })));
      }
    }
  }, [open, member]);

  const setSlotAffaire = (day: string, affaireId: string | null) =>
    setSchedule(s => s.map(slot => slot.day === day ? { ...slot, affaireId } : slot));

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const url = member ? `${API}/equipe/${member.id}` : `${API}/equipe`;
      const payload: Record<string, unknown> = { name, role, availability, schedule };
      if (email.trim()) payload.email = email.trim();
      const res = await apiFetch(url, {
        method: member ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: 'Erreur', description: (err as any).error ?? 'Impossible d\'enregistrer', variant: 'destructive' });
        return;
      }
      onSaved(); onOpenChange(false);
      toast({ title: member ? 'Membre mis à jour' : 'Membre ajouté' });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{member ? `Modifier ${member.name}` : 'Nouveau membre'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Nom *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Prénom Nom" />
            </div>
            <div className="space-y-1.5">
              <Label>Rôle</Label>
              <Input value={role} onChange={e => setRole(e.target.value)} placeholder="Technicien..." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="prenom@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Disponibilité</Label>
              <Select value={availability} onValueChange={v => setAvailability(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DISPONIBLE">Disponible</SelectItem>
                  <SelectItem value="PARTIEL">Partiel</SelectItem>
                  <SelectItem value="ABSENT">Absent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Planning hebdomadaire</Label>
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-7 divide-x divide-border border-b border-border bg-muted/20">
                {DAYS.map(day => (
                  <div key={day} className="text-center py-2 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                    {DAY_LABELS[day]}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 divide-x divide-border">
                {schedule.map(slot => (
                  <div key={slot.day} className="p-1.5">
                    <Select value={slot.affaireId ?? '__none__'} onValueChange={v => setSlotAffaire(slot.day, v === '__none__' ? null : v)}>
                      <SelectTrigger className="h-8 text-[11px] px-2"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        {affaires.slice(0, 20).map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.label.slice(0, 20)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Enregistrement...' : member ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
