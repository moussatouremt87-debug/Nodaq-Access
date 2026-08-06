import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Users, MoreVertical, Pencil, Trash2, CheckCircle2,
  Clock, AlertCircle, Briefcase,
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
import { useQuery as useAffairesQuery } from '@tanstack/react-query';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

import { apiFetch } from '@/lib/auth';
const API = '/api';

type ScheduleSlot = { day: string; affaireId: string | null };
type TeamMember = {
  id: string; name: string; role: string; email?: string | null;
  availability: 'DISPONIBLE' | 'PARTIEL' | 'ABSENT'; schedule: ScheduleSlot[];
  createdAt: string; updatedAt: string;
};
type Affaire = { id: string; label: string; clientName?: string | null; status: string };

const DAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const DAY_LABELS: Record<string, string> = {
  LUN: 'Lun', MAR: 'Mar', MER: 'Mer', JEU: 'Jeu', VEN: 'Ven', SAM: 'Sam', DIM: 'Dim',
};

const AVAIL_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  DISPONIBLE: { label: 'Disponible', color: 'text-primary', icon: CheckCircle2 },
  PARTIEL:    { label: 'Partiel',    color: 'text-yellow-400', icon: Clock },
  ABSENT:     { label: 'Absent',     color: 'text-destructive', icon: AlertCircle },
};

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
  return useAffairesQuery<{ affaires: Affaire[] }>({
    queryKey: ['affaires'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/affaires`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json();
    },
    staleTime: 60_000,
  });
}

export default function EquipePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: members = [], isLoading } = useTeam();
  const { data: affairesData } = useAffaires();
  const affaires = affairesData?.affaires ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [toDelete, setToDelete] = useState<TeamMember | null>(null);

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`${API}/equipe/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Suppression échouée');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipe'] });
      toast({ title: 'Membre supprimé' });
      setToDelete(null);
    },
    onError: (err: Error) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const openEdit = (m: TeamMember) => { setEditing(m); setDialogOpen(true); };
  const openCreate = () => { setEditing(null); setDialogOpen(true); };

  // Load count of assigned affaires per member
  const assignedCount = (m: TeamMember) => m.schedule.filter(s => s.affaireId).length;

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Plateforme"
        title="Équipe & plannings"
        description="Gérez vos collaborateurs et assignez-les aux affaires par créneau hebdomadaire."
        actions={
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> Ajouter un membre
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {/* Summary cards */}
        <motion.div variants={containerVariants} initial="hidden" animate="visible"
          className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Membres', value: members.length, icon: Users },
            { label: 'Disponibles', value: members.filter(m => m.availability === 'DISPONIBLE').length, icon: CheckCircle2 },
            { label: 'Partiels', value: members.filter(m => m.availability === 'PARTIEL').length, icon: Clock },
            { label: 'Absents', value: members.filter(m => m.availability === 'ABSENT').length, icon: AlertCircle },
          ].map((stat, i) => {
            const Icon = stat.icon;
            return (
              <motion.div key={i} variants={itemVariants}
                className="rounded-xl border border-card-border bg-card p-4 flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" /> {stat.label}
                </div>
                <div className="text-2xl font-semibold font-mono-nums">{stat.value}</div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Members list */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center">
            <Users className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">Aucun membre dans l'équipe.</p>
            <Button className="mt-4" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Ajouter</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {members.map(m => {
                const meta = AVAIL_META[m.availability] ?? AVAIL_META.DISPONIBLE;
                const Icon = meta.icon;
                return (
                  <motion.div key={m.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
                    {/* Member header */}
                    <div className="flex items-center gap-4 px-5 py-4">
                      <div className="h-10 w-10 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-semibold text-sidebar-primary shrink-0">
                        {m.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground">{m.name}</div>
                        <div className="text-xs text-muted-foreground">{m.role}{m.email && ` · ${m.email}`}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.color}`}>
                          <Icon className="h-3.5 w-3.5" /> {meta.label}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          <Briefcase className="h-3 w-3" /> {assignedCount(m)} affaire{assignedCount(m) !== 1 ? 's' : ''}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(m)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setToDelete(m)}
                              className="text-destructive focus:text-destructive">
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    {/* Weekly schedule grid */}
                    <div className="border-t border-border grid grid-cols-7 divide-x divide-border">
                      {DAYS.map(day => {
                        const slot = m.schedule.find(s => s.day === day);
                        const aff = slot?.affaireId
                          ? affaires.find(a => a.id === slot.affaireId)
                          : null;
                        return (
                          <button key={day}
                            onClick={() => openEdit({ ...m, _focusDay: day } as any)}
                            className="flex flex-col items-center py-2 px-1 hover:bg-muted/30 transition-colors group">
                            <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-medium mb-1">
                              {DAY_LABELS[day]}
                            </span>
                            {aff ? (
                              <span className="w-full text-center text-[10px] font-medium text-primary bg-primary/10 rounded px-1 py-0.5 truncate">
                                {aff.label.slice(0, 10)}
                              </span>
                            ) : (
                              <span className="w-8 h-5 rounded border border-dashed border-border/50 group-hover:border-primary/40 transition-colors" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <MemberDialog open={dialogOpen} onOpenChange={setDialogOpen} member={editing}
        affaires={affaires}
        onSaved={() => qc.invalidateQueries({ queryKey: ['equipe'] })} />

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

function MemberDialog({ open, onOpenChange, member, affaires, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; member: TeamMember | null;
  affaires: Affaire[]; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [role, setRole] = useState('Collaborateur');
  const [email, setEmail] = useState('');
  const [availability, setAvailability] = useState<'DISPONIBLE' | 'PARTIEL' | 'ABSENT'>('DISPONIBLE');
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(
    DAYS.map(day => ({ day, affaireId: null }))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (member) {
        setName(member.name);
        setRole(member.role);
        setEmail(member.email ?? '');
        setAvailability(member.availability);
        const sch = DAYS.map(day => member.schedule.find(s => s.day === day) ?? { day, affaireId: null });
        setSchedule(sch);
      } else {
        setName(''); setRole('Collaborateur'); setEmail('');
        setAvailability('DISPONIBLE');
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
      const method = member ? 'PATCH' : 'POST';
      const payload: Record<string, unknown> = {
        name, role, availability, schedule,
      };
      if (email.trim()) payload.email = email.trim();
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: 'Erreur', description: (err as any).error ?? 'Impossible d\'enregistrer', variant: 'destructive' });
        return;
      }
      onSaved();
      onOpenChange(false);
      toast({ title: member ? 'Membre mis à jour' : 'Membre ajouté' });
    } finally {
      setSaving(false);
    }
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
              <Input value={role} onChange={e => setRole(e.target.value)} placeholder="Développeur, Designer..." />
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

          {/* Weekly schedule */}
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
                      <SelectTrigger className="h-8 text-[11px] px-2">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
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
