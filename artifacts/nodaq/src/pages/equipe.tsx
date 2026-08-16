import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { listContainerVariants, itemVariants } from '@/lib/motion-variants';
import {
  Users, MoreVertical, Pencil, Trash2, CheckCircle2,
  Clock, AlertCircle, UserPlus, Mic, Settings, CalendarOff,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel,
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
import { useVertical } from '@/hooks/use-vertical';
import type { AffaireWords } from '@nodaq/shared';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/auth';
import { toDateString } from '@/lib/format';

const API = '/api';

// ── Types ─────────────────────────────────────────────────────────────────
// Rattachement EXCLUSIF (US-A4.1) : un créneau pointe soit sur une affaire,
// soit directement sur un client (métier sans "chantier"), jamais les deux —
// même contrainte que côté moteur (migration 032).
type ScheduleSlot = { day: string; affaireId: string | null; clientId: string | null };
type TeamMember = {
  id: string; name: string; role: string; email?: string | null;
  availability: 'DISPONIBLE' | 'PARTIEL' | 'ABSENT'; schedule: ScheduleSlot[];
  createdAt: string; updatedAt: string;
};
type Absence = {
  id: string; membreId: string; type: string; dateDebut: string; dateFin: string;
};
type ChantierItem = { id: string; label: string };
type SemaineData = {
  dateDebut: string; label: string;
  type: 'plein' | 'partiel' | 'libre';
  fillPct: number; chantiers: ChantierItem[]; absentsNoms: string[];
  joursLibres: number; joursDisponibles: number; joursVendus: number;
};
type JourneesResult = {
  etat: 'COMPLET' | 'INCOMPLET' | 'SANS_DONNEES' | 'PARAMETRES_MANQUANTS';
  moisLabel: string; incompletRaison?: string;
  joursFactures?: number; joursPaies?: number;
  objectif?: number; ecartEuros?: number; coutDemiJournee?: number;
};
type PlanningData = {
  etat: 'OK' | 'PARAMETRES_MANQUANTS';
  horizon: string | null; horizonPhrase: string; horizonSous: string;
  activeCount: number; semaines: SemaineData[];
  devisEnAttente: { count: number; semainesPotentielles: number };
  journees: JourneesResult;
  tauxJourFacture: number; coutJourCharge: number;
};
type Affaire = { id: string; label: string; status?: string };
type Client = { id: string; nom: string };

const DAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const DAY_LABELS: Record<string, string> = {
  LUN: 'Lun', MAR: 'Mar', MER: 'Mer', JEU: 'Jeu', VEN: 'Ven', SAM: 'Sam', DIM: 'Dim',
};
const TODAY_DAY_CODE = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'][new Date().getDay()]!;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Client-side simulateur ────────────────────────────────────────────────
// `words` vient de useVertical() (US-A1.1) — cette fonction reste pure, donc
// appelée avec le vocabulaire déjà résolu plutôt que d'appeler le hook
// elle-même (elle n'est pas un composant).
function simulerChantier(
  joursNecessaires: number,
  personnesNecessaires: number,
  semaines: SemaineData[],
  activeCount: number,
  words: AffaireWords,
): { possible: boolean; dateDebutLabel: string; detail: string; decalage: boolean } {
  if (activeCount === 0) return { possible: false, dateDebutLabel: '', detail: "Votre équipe est vide.", decalage: false };
  const pers = Math.max(1, personnesNecessaires);
  if (pers > activeCount) {
    return {
      possible: false,
      dateDebutLabel: '',
      detail: `${capitalize(words.definite)} nécessite ${pers} personne${pers > 1 ? 's' : ''} mais votre équipe n'en compte que ${activeCount}.`,
      decalage: false,
    };
  }
  // Conservative per-person check: assume free days are evenly distributed.
  // We need each assignee to have on average >= joursNecessaires free days.
  // (Rejects weeks where free days are concentrated in fewer people than needed.)
  for (const sem of semaines) {
    const freePerPersonAvg = activeCount > 0 ? sem.joursLibres / activeCount : 0;
    if (freePerPersonAvg >= joursNecessaires) {
      const d = new Date(sem.dateDebut + 'T00:00:00Z');
      const label = `${d.getUTCDate()} ${['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][d.getUTCMonth()]}`;
      const avgStr = (sem.joursLibres / activeCount).toFixed(1);
      // Accord du participe passé sur le genre du mot vertical — « décalé »
      // (chantier, événement, dossier) vs « décalée » (mission, intervention,
      // prestation, affaire). Dérivé de `indefinite` ("un"/"une"), seule
      // source de genre exposée par `AffaireWords`.
      const feminin = words.indefinite.startsWith('une ');
      return {
        possible: true,
        dateDebutLabel: label,
        detail: `En moyenne ${avgStr} jour${Number(avgStr) > 1 ? 's' : ''} libre${Number(avgStr) > 1 ? 's' : ''} par personne sur cette semaine. ${words.noneLabel} en cours n'est décalé${feminin ? 'e' : ''}.`,
        decalage: false,
      };
    }
  }
  return {
    possible: false,
    dateDebutLabel: '',
    detail: `Aucun créneau disponible dans les ${semaines.length} prochaines semaines (${joursNecessaires} j/personne × ${pers} personne${pers > 1 ? 's' : ''}).`,
    decalage: true,
  };
}

// ── Data hooks ────────────────────────────────────────────────────────────
function useTeam() {
  return useQuery<TeamMember[]>({
    queryKey: ['equipe'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/equipe`);
      if (!r.ok) throw new Error('Fetch failed');
      return r.json();
    },
  });
}

function usePlannings() {
  return useQuery<PlanningData>({
    queryKey: ['equipe-plannings'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/equipe/plannings`);
      if (!r.ok) throw new Error('Fetch failed');
      return r.json();
    },
  });
}

function useAbsences() {
  return useQuery<Absence[]>({
    queryKey: ['equipe-absences'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/equipe/absences`);
      if (!r.ok) throw new Error('Fetch failed');
      return r.json();
    },
  });
}

function useAffaires() {
  return useQuery<{ affaires: Affaire[] }>({
    queryKey: ['affaires'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/affaires`);
      if (!r.ok) throw new Error('Fetch failed');
      return r.json();
    },
    staleTime: 60_000,
  });
}

/** Clients actifs — pour le rattachement direct sans affaire (US-A4.1). */
function useClients() {
  return useQuery<{ clients: Client[] }>({
    queryKey: ['clients'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/clients`);
      if (!r.ok) throw new Error('Fetch failed');
      return r.json();
    },
    staleTime: 60_000,
  });
}

// ── HorizonBlock ──────────────────────────────────────────────────────────
function HorizonBlock({ planning, loading }: { planning?: PlanningData; loading: boolean }) {
  if (loading) return <Skeleton className="h-24 w-full rounded-2xl" />;
  if (!planning) return null;

  const { horizonPhrase, horizonSous } = planning;

  // Highlight the date part (everything after "jusqu'au " or end keyword)
  const highlightDate = (phrase: string) => {
    const match = phrase.match(/jusqu'au (.+)\.$/);
    if (!match) return <span>{phrase}</span>;
    const before = phrase.slice(0, phrase.indexOf('jusqu\'au '));
    const after = match[1];
    return (
      <>
        <span>{before}jusqu'au </span>
        <span className="border-b-4 border-amber-500 pb-0.5 font-bold">{after}.</span>
      </>
    );
  };

  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Aujourd'hui · {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
      <h1 className="font-serif text-3xl leading-tight font-semibold tracking-tight text-foreground">
        {highlightDate(horizonPhrase)}
      </h1>
      {horizonSous && (
        <p className="mt-2.5 text-[15px] text-muted-foreground">{horizonSous}</p>
      )}
    </div>
  );
}

// ── GanttBlock ────────────────────────────────────────────────────────────
// Rows = affaires, columns = weeks. Each bar is clickable → /affaires/:id.
function GanttBlock({ semaines, devisEnAttente }: {
  semaines: SemaineData[];
  devisEnAttente: { count: number; semainesPotentielles: number };
}) {
  const [, setLocation] = useLocation();
  const reducedMotion = useReducedMotion();
  const { words } = useVertical();

  // Derive one row per unique affaire, in the order they first appear.
  const affaireRows = useMemo(() => {
    const map = new Map<string, { id: string; label: string; activeWeekIndices: Set<number> }>();
    semaines.forEach((sem, weekIdx) => {
      for (const ch of sem.chantiers) {
        if (!map.has(ch.id)) {
          map.set(ch.id, { id: ch.id, label: ch.label, activeWeekIndices: new Set() });
        }
        map.get(ch.id)!.activeWeekIndices.add(weekIdx);
      }
    });
    return [...map.values()];
  }, [semaines]);

  const hasWork = affaireRows.length > 0;
  const hasAbsents = semaines.some(s => s.absentsNoms.length > 0);

  // Column widths
  const LABEL_W = 128; // px — sticky left label column
  const COL_W   = 76;  // px — each week column

  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-border">
        <h2 className="font-serif text-xl font-semibold text-foreground">Les prochaines semaines</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">Qui travaille où, et où sont les trous.</p>
      </div>

      {!hasWork ? (
        <div className="px-5 py-5 text-[13px] text-muted-foreground italic">
          {words.noneLabel} planifié{words.indefinite.startsWith('une ') ? 'e' : ''} sur les prochaines semaines.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: `${LABEL_W + semaines.length * COL_W}px` }}>

            {/* ── Week header row ──────────────────────────────────────── */}
            <div className="flex border-b border-border bg-muted/20">
              {/* Sticky label spacer */}
              <div
                className="shrink-0 sticky left-0 z-10 bg-muted/20 border-r border-border"
                style={{ width: LABEL_W }}
              />
              {semaines.map(sem => (
                <div
                  key={sem.dateDebut}
                  className="shrink-0 flex flex-col items-center justify-center py-2 border-r border-border last:border-r-0"
                  style={{ width: COL_W }}
                >
                  <span className="text-[11px] font-semibold text-muted-foreground leading-tight">
                    {sem.label}
                  </span>
                  {sem.joursLibres > 0 ? (
                    <span className="mt-0.5 text-[10px] font-medium text-amber-500">
                      {sem.joursLibres}j lib.
                    </span>
                  ) : sem.type === 'libre' ? (
                    <span className="mt-0.5 text-[10px] text-muted-foreground/60">libre</span>
                  ) : (
                    <span className="mt-0.5 text-[10px] text-primary/70">complet</span>
                  )}
                </div>
              ))}
            </div>

            {/* ── Affaire rows — staggered entrance ────────────────── */}
            <motion.div
              variants={reducedMotion ? undefined : listContainerVariants}
              initial={reducedMotion ? false : 'hidden'}
              animate="visible"
            >
            {affaireRows.map((aff, rowIdx) => (
              <motion.div
                key={aff.id}
                variants={reducedMotion ? undefined : itemVariants}
                className={cn(
                  'flex items-center border-b border-border last:border-b-0',
                  rowIdx % 2 === 1 && 'bg-muted/10',
                )}
              >
                {/* Sticky affaire label */}
                <div
                  className={cn(
                    'shrink-0 sticky left-0 z-10 border-r border-border px-3 py-2',
                    rowIdx % 2 === 1 ? 'bg-card' : 'bg-card',
                  )}
                  style={{ width: LABEL_W }}
                >
                  <span
                    className="text-[11.5px] font-semibold text-foreground block truncate"
                    title={aff.label}
                  >
                    {aff.label}
                  </span>
                </div>

                {/* Week cells */}
                {semaines.map((sem, weekIdx) => {
                  const isActive = aff.activeWeekIndices.has(weekIdx);
                  const barCls = sem.type === 'partiel'
                    ? 'bg-amber-500 hover:bg-amber-400'
                    : 'bg-primary hover:bg-primary/85';
                  return (
                    <div
                      key={sem.dateDebut}
                      className="shrink-0 px-1 py-1.5 border-r border-border last:border-r-0"
                      style={{ width: COL_W }}
                    >
                      {isActive ? (
                        <button
                          title={`${aff.label} — ${sem.label}`}
                          onClick={() => setLocation(`/affaires/${aff.id}`)}
                          className={cn(
                            'w-full h-6 rounded transition-colors cursor-pointer',
                            barCls,
                          )}
                          aria-label={`Voir ${aff.label}`}
                        />
                      ) : (
                        <div className="w-full h-6" />
                      )}
                    </div>
                  );
                })}
              </motion.div>
            ))}
            </motion.div>

            {/* ── Absents footer row (only if any absences in window) ── */}
            {hasAbsents && (
              <div className="flex border-t border-border bg-muted/10">
                <div
                  className="shrink-0 sticky left-0 z-10 bg-muted/10 border-r border-border px-3 py-2"
                  style={{ width: LABEL_W }}
                >
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    Absents
                  </span>
                </div>
                {semaines.map(sem => (
                  <div
                    key={sem.dateDebut}
                    className="shrink-0 px-1.5 py-1.5 border-r border-border last:border-r-0"
                    style={{ width: COL_W }}
                  >
                    {sem.absentsNoms.length > 0 && (
                      <p
                        className="text-[10px] leading-snug text-muted-foreground truncate"
                        title={sem.absentsNoms.join(', ')}
                      >
                        {sem.absentsNoms.join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {devisEnAttente.count > 0 && (
        <DevisActionCard devis={devisEnAttente} />
      )}
    </div>
  );
}

function DevisActionCard({ devis }: { devis: { count: number; semainesPotentielles: number } }) {
  const [, setLocation] = useLocation();
  return (
    <div className="mx-5 mb-5 mt-2 rounded-xl bg-sidebar text-sidebar-foreground p-4">
      <p className="font-serif text-[17px] leading-snug">
        <span className="text-amber-300 font-semibold">{devis.count} devis</span>{' '}
        {devis.count > 1 ? 'attendent' : 'attend'} une réponse. Ensemble, ils rempliraient{' '}
        <span className="text-amber-300 font-semibold">{devis.semainesPotentielles} semaine{devis.semainesPotentielles > 1 ? 's' : ''}</span>.
      </p>
      <button
        onClick={() => setLocation('/affaires?statut=DEVIS_ENVOYE')}
        className="mt-3 w-full text-center py-2.5 rounded-lg bg-sidebar-foreground/10 hover:bg-sidebar-foreground/20 font-semibold text-sm transition-colors"
      >
        Voir les {devis.count} devis →
      </button>
    </div>
  );
}

// ── SimulateurBlock ───────────────────────────────────────────────────────
function SimulateurBlock({ semaines, activeCount }: { semaines: SemaineData[]; activeCount: number }) {
  const [jours, setJours] = useState(3);
  const [personnes, setPersonnes] = useState(1);
  const { words } = useVertical();

  const result = useMemo(
    () => simulerChantier(jours, personnes, semaines, activeCount, words),
    [jours, personnes, semaines, activeCount, words],
  );

  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-border">
        <h2 className="font-serif text-xl font-semibold text-foreground">Puis-je prendre {words.indefinite}&nbsp;?</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">Testez avant de répondre au client.</p>
      </div>
      <div className="p-5 space-y-4">
        <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-4">
          <p className="font-serif text-[17px] text-foreground">{capitalize(words.indefinite)} de&nbsp;…</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11.5px] text-muted-foreground mb-1.5 block">Combien de jours</Label>
              <Input
                type="number" min={1} max={100} value={jours}
                onChange={e => setJours(Math.max(1, Number(e.target.value)))}
                className="text-center font-mono tabular-nums h-10"
                inputMode="numeric"
              />
            </div>
            <div>
              <Label className="text-[11.5px] text-muted-foreground mb-1.5 block">Combien de personnes</Label>
              <Input
                type="number" min={1} max={20} value={personnes}
                onChange={e => setPersonnes(Math.max(1, Number(e.target.value)))}
                className="text-center font-mono tabular-nums h-10"
                inputMode="numeric"
              />
            </div>
          </div>
        </div>

        <div className={cn(
          'rounded-r-xl border-l-4 pl-4 pr-4 py-3.5',
          result.possible
            ? 'border-primary bg-primary/5'
            : 'border-destructive bg-destructive/5',
        )}>
          <p className="font-serif text-[16px] font-semibold text-foreground leading-snug">
            {result.possible
              ? `Oui, à partir du ${result.dateDebutLabel}.`
              : 'Pas de créneau disponible.'}
          </p>
          <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{result.detail}</p>
        </div>
      </div>
    </div>
  );
}

// ── EquipeBlock ───────────────────────────────────────────────────────────
function EquipeBlock({
  members, absences, affaires, clients, loading,
  onEdit, onDelete, onAdd, membersLoading,
}: {
  members: TeamMember[];
  absences: Absence[];
  affaires: Affaire[];
  clients: Client[];
  loading: boolean;
  membersLoading: boolean;
  onEdit: (m: TeamMember) => void;
  onDelete: (m: TeamMember) => void;
  onAdd: () => void;
}) {
  const { toast } = useToast();
  const { words } = useVertical();
  const activeCount = members.filter(m => m.availability !== 'ABSENT').length;
  const todayStr = toDateString(new Date());

  const affaireById = useMemo(
    () => new Map(affaires.map(a => [a.id, a])),
    [affaires],
  );
  const clientById = useMemo(
    () => new Map(clients.map(c => [c.id, c])),
    [clients],
  );

  // Derive what each member is doing today
  function getMemberActivity(m: TeamMember): string {
    const todayAbsence = absences.find(
      a => a.membreId === m.id && a.dateDebut <= todayStr && todayStr <= a.dateFin,
    );
    if (todayAbsence) {
      return `${todayAbsence.type.toLowerCase()} · jusqu'au ${todayAbsence.dateFin}`;
    }
    if (m.availability === 'ABSENT') return 'absent';
    const todaySlot = m.schedule.find(s => s.day === TODAY_DAY_CODE);
    if (todaySlot?.affaireId) {
      const aff = affaireById.get(todaySlot.affaireId);
      return aff ? aff.label : `${words.singular} en cours`;
    }
    if (todaySlot?.clientId) {
      const client = clientById.get(todaySlot.clientId);
      return client ? client.nom : 'client';
    }
    return 'disponible';
  }

  const isAbsentToday = (m: TeamMember) => {
    return m.availability === 'ABSENT' || absences.some(
      a => a.membreId === m.id && a.dateDebut <= todayStr && todayStr <= a.dateFin,
    );
  };

  const handleVoiceAbsence = () => {
    toast({ title: 'Dictée vocale', description: 'Fonctionnalité bientôt disponible — utilisez le formulaire ci-dessous.' });
  };

  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Votre équipe</h2>
          <p className="text-[13px] text-muted-foreground mt-0.5">{activeCount} compagnon{activeCount !== 1 ? 's' : ''} · aujourd'hui</p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd} className="gap-1.5 text-xs shrink-0">
          <UserPlus className="h-3.5 w-3.5" /> Ajouter
        </Button>
      </div>

      {membersLoading ? (
        <div className="p-5 space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : members.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Aucun membre — ajoutez-en un.
        </div>
      ) : (
        <AnimatePresence>
          {members.map(m => {
            const absent = isAbsentToday(m);
            const activity = getMemberActivity(m);
            const initials = m.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
            return (
              <motion.div key={m.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-3.5 px-5 py-3 border-b border-border last:border-0">
                <div className={cn(
                  'h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0',
                  absent ? 'bg-muted text-muted-foreground' : 'bg-sidebar-accent text-sidebar-primary',
                )}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn('text-sm font-semibold', absent && 'text-muted-foreground')}>{m.name}</div>
                  <div className="text-[12.5px] text-muted-foreground truncate">{activity}</div>
                </div>
                <div className={cn(
                  'shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full',
                  absent
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-primary/15 text-primary',
                )}>
                  {absent ? 'absent' : 'au travail'}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(m)}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDelete(m)} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}

      <div className="px-5 pb-4 pt-3 border-t border-border">
        <button
          onClick={handleVoiceAbsence}
          className="flex items-center justify-center gap-2.5 w-full py-3.5 border-[1.5px] border-dashed border-border rounded-xl text-[14.5px] font-semibold text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
        >
          <Mic className="h-4 w-4" />
          Dire une absence · « Vincent est malade »
        </button>
      </div>
    </div>
  );
}

// ── JourneesBlock ─────────────────────────────────────────────────────────
function JourneesBlock({ journees, coutJourCharge }: {
  journees: JourneesResult;
  coutJourCharge: number;
}) {
  const [, setLocation] = useLocation();

  if (journees.etat === 'PARAMETRES_MANQUANTS') {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-5">
        <h2 className="font-serif text-xl font-semibold text-foreground">Vos journées</h2>
        <div className="mt-3 rounded-xl border border-dashed border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Configurez vos réglages pour voir cette mesure.
          </p>
          <Button variant="outline" size="sm" className="mt-3 gap-1.5 text-xs" onClick={() => setLocation('/parametres')}>
            <Settings className="h-3.5 w-3.5" /> Configurer les réglages
          </Button>
        </div>
      </div>
    );
  }

  if (journees.etat === 'SANS_DONNEES') {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-5">
        <h2 className="font-serif text-xl font-semibold text-foreground">Vos journées</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">{journees.moisLabel}</p>
        <p className="mt-3 text-sm text-muted-foreground italic">pas encore de données pour ce mois</p>
      </div>
    );
  }

  if (journees.etat === 'INCOMPLET') {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-5">
        <h2 className="font-serif text-xl font-semibold text-foreground">Vos journées</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">{journees.moisLabel}</p>
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
          <span className="font-semibold text-amber-400">Données incomplètes</span>
          {journees.incompletRaison && <span className="ml-1">— {journees.incompletRaison}</span>}
        </div>
      </div>
    );
  }

  // COMPLET
  const { joursFactures = 0, joursPaies = 5, objectif = 3.5, ecartEuros = 0, coutDemiJournee = 0 } = journees;
  const fillPct = Math.min(100, Math.round((joursFactures / joursPaies) * 100));
  const objectifPct = Math.min(100, Math.round((objectif / joursPaies) * 100));
  const positif = ecartEuros >= 0;

  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-border">
        <h2 className="font-serif text-xl font-semibold text-foreground">Vos journées</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          {journees.moisLabel} — sur les journées payées, combien ont été facturées.
        </p>
      </div>
      <div className="p-5 space-y-3">
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <div className="font-serif text-[27px] font-bold tabular-nums text-foreground leading-none">
            {joursFactures.toFixed(1)}{' '}
            <span className="text-[15px] font-normal text-muted-foreground" style={{ fontFamily: 'inherit' }}>
              jours facturés sur {joursPaies} payés
            </span>
          </div>

          {/* Progress bar */}
          <div className="relative h-3 rounded-full bg-muted/40 mt-4 mb-2 overflow-visible">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
              style={{ width: `${fillPct}%` }}
            />
            {/* Target marker */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-5 bg-foreground rounded-full"
              style={{ left: `${objectifPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11.5px] text-muted-foreground">
            <span>0</span>
            <span>objectif : {objectif.toFixed(1)}</span>
            <span>{joursPaies}</span>
          </div>

          <p className="text-[13.5px] text-muted-foreground mt-3.5 leading-relaxed">
            Le reste part en déplacements, préparation, retours et intempéries.
            {coutDemiJournee > 0 && (
              <> Chaque demi-journée récupérée, c'est environ{' '}
                <strong className="text-foreground">{coutDemiJournee.toLocaleString('fr-FR')} €</strong>{' '}
                de plus par mois.
              </>
            )}
          </p>
          {ecartEuros !== 0 && (
            <div className={cn(
              'mt-3 text-xs font-medium px-3 py-1.5 rounded-lg inline-block',
              positif ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive',
            )}>
              {positif ? '+' : ''}{ecartEuros.toLocaleString('fr-FR')} € vs objectif ce mois-ci
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AbsencesSection ───────────────────────────────────────────────────────
function AbsencesSection({ members, absences }: { members: TeamMember[]; absences: Absence[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [membreId, setMembreId] = useState('__none__');
  const [type, setType] = useState<'Congés' | 'Maladie' | 'RTT' | 'Autre'>('Congés');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (membreId === '__none__' || !dateDebut || !dateFin) return;
    setSaving(true);
    try {
      const r = await apiFetch(`${API}/equipe/absences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membreId, type, dateDebut, dateFin }),
      });
      if (!r.ok) throw new Error('Échec');
      qc.invalidateQueries({ queryKey: ['equipe-absences'] });
      qc.invalidateQueries({ queryKey: ['equipe-plannings'] });
      setMembreId('__none__'); setDateDebut(''); setDateFin('');
      toast({ title: 'Absence enregistrée' });
    } catch (e: any) {
      toast({ title: 'Erreur', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      <button
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-muted/10 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <CalendarOff className="h-4 w-4 text-muted-foreground" />
          Absences
          {absences.length > 0 && (
            <span className="ml-1 text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground font-normal">
              {absences.length}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{open ? 'Fermer' : 'Gérer'}</span>
      </button>

      {open && (
        <div className="border-t border-border p-5 space-y-4">
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
            <Input type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)} />
            <Input type="date" value={dateFin} onChange={e => setDateFin(e.target.value)} />
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
                    <span className="font-mono text-xs text-muted-foreground">
                      {a.dateDebut} → {a.dateFin}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ParamètresManquantsCard ───────────────────────────────────────────────
function ParametresCard({ taux, cout, onSave }: {
  taux: number; cout: number;
  onSave: (t: number, c: number) => void;
}) {
  const [tauxVal, setTauxVal] = useState(String(Math.round(taux * 5 * 10) / 10));
  const [coutVal, setCoutVal] = useState(String(cout));
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    const t = parseFloat(tauxVal) / 5;  // convert "3.5 out of 5" to ratio 0.70
    const c = parseFloat(coutVal);
    if (!isFinite(t) || t <= 0 || t > 1 || !isFinite(c) || c <= 0) {
      toast({ title: 'Valeurs invalides', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const r = await apiFetch(`${API}/equipe/plannings/taux`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tauxJourFacture: t, coutJourCharge: c }),
      });
      if (!r.ok) throw new Error('Échec');
      onSave(t, c);
      toast({ title: 'Réglages enregistrés' });
    } catch {
      toast({ title: 'Erreur', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Configurez vos réglages pour démarrer</h3>
        <p className="text-sm text-muted-foreground mt-1">Ces données permettent de calculer votre planning et vos performances. Vous pourrez les ajuster dans Paramètres.</p>
      </div>
      <div className="space-y-3">
        <div>
          <Label className="text-sm font-medium text-foreground">
            Sur 5 jours payés à un ouvrier, combien sont réellement facturés à un client ?
          </Label>
          <div className="flex items-center gap-2 mt-1.5">
            <Input value={tauxVal} onChange={e => setTauxVal(e.target.value)} className="w-20 text-center" type="number" step="0.5" min="1" max="5" />
            <span className="text-sm text-muted-foreground">jours sur 5</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Défaut : 3,5 jours</p>
        </div>
        <div>
          <Label className="text-sm font-medium text-foreground">
            Une journée d'ouvrier vous coûte combien, charges comprises ?
          </Label>
          <div className="flex items-center gap-2 mt-1.5">
            <Input value={coutVal} onChange={e => setCoutVal(e.target.value)} className="w-28 text-center" type="number" min="1" />
            <span className="text-sm text-muted-foreground">€ / jour</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Défaut : 250 €</p>
        </div>
      </div>
      <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
        {saving ? 'Enregistrement...' : 'Enregistrer'}
      </Button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function EquipePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: members = [], isLoading: membersLoading } = useTeam();
  const { data: planning, isLoading: planningLoading } = usePlannings();
  const { data: absences = [] } = useAbsences();
  const { data: affairesData } = useAffaires();
  const affaires = affairesData?.affaires ?? [];
  const { data: clientsData } = useClients();
  const clients = clientsData?.clients ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [toDelete, setToDelete] = useState<TeamMember | null>(null);

  const handleOpenAdd = () => { setEditing(null); setDialogOpen(true); };
  const handleEdit = (m: TeamMember) => { setEditing(m); setDialogOpen(true); };

  const handleDelete = async (m: TeamMember) => {
    try {
      const r = await apiFetch(`${API}/equipe/${m.id}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 204) throw new Error('Suppression échouée');
      qc.invalidateQueries({ queryKey: ['equipe'] });
      qc.invalidateQueries({ queryKey: ['equipe-plannings'] });
      toast({ title: 'Membre supprimé' });
    } catch (err: any) {
      toast({ title: 'Erreur', description: err.message, variant: 'destructive' });
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Plateforme"
        title="Équipe & plannings"
        description="Qui travaille où, et ce que vous avez devant vous."
        withMesh
      />

      <div className="px-5 md:px-8 pt-6 space-y-5">

        {/* ── Headline horizon ── */}
        {planningLoading ? (
          <Skeleton className="h-20 w-full rounded-2xl" />
        ) : (
          <HorizonBlock planning={planning} loading={false} />
        )}

        {/* ── First-time settings prompt ── */}
        {planning?.etat === 'PARAMETRES_MANQUANTS' && (
          <ParametresCard
            taux={planning.tauxJourFacture}
            cout={planning.coutJourCharge}
            onSave={() => qc.invalidateQueries({ queryKey: ['equipe-plannings'] })}
          />
        )}

        {/* ── Frise semaines ── */}
        {planningLoading ? (
          <Skeleton className="h-72 w-full rounded-2xl" />
        ) : planning?.semaines?.length ? (
          <GanttBlock semaines={planning.semaines} devisEnAttente={planning.devisEnAttente} />
        ) : null}

        {/* ── Simulateur ── */}
        {planning?.semaines?.length ? (
          <SimulateurBlock semaines={planning.semaines} activeCount={planning.activeCount} />
        ) : null}

        {/* ── Équipe ── */}
        <EquipeBlock
          members={members}
          absences={absences}
          affaires={affaires}
          clients={clients}
          loading={planningLoading}
          membersLoading={membersLoading}
          onEdit={handleEdit}
          onDelete={m => setToDelete(m)}
          onAdd={handleOpenAdd}
        />

        {/* ── Vos journées ── */}
        {planningLoading ? (
          <Skeleton className="h-48 w-full rounded-2xl" />
        ) : planning ? (
          <JourneesBlock journees={planning.journees} coutJourCharge={planning.coutJourCharge} />
        ) : null}

        {/* ── Absences ── */}
        <AbsencesSection members={members} absences={absences} />

        {/* ── Footer ── */}
        <footer className="border-t border-border pt-4 pb-2 text-[12.5px] text-muted-foreground">
          Les calculs utilisent vos réglages : jours réellement facturés, coût d'une journée.{' '}
          <button
            onClick={() => setLocation('/parametres')}
            className="text-primary font-semibold hover:underline"
          >
            Les modifier
          </button>
        </footer>
      </div>

      {/* ── Member dialog ── */}
      <MemberDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        member={editing}
        affaires={affaires}
        clients={clients}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['equipe'] });
          qc.invalidateQueries({ queryKey: ['equipe-plannings'] });
        }}
      />

      <AlertDialog open={!!toDelete} onOpenChange={v => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer {toDelete?.name} ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toDelete && handleDelete(toDelete)}
              className="bg-destructive text-destructive-foreground"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── MemberDialog ──────────────────────────────────────────────────────────
function MemberDialog({ open, onOpenChange, member, affaires, clients, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; member: TeamMember | null;
  affaires: Affaire[]; clients: Client[]; onSaved: () => void;
}) {
  const { toast } = useToast();
  const { words } = useVertical();
  const [name, setName] = useState('');
  const [role, setRole] = useState('Collaborateur');
  const [email, setEmail] = useState('');
  const [availability, setAvailability] = useState<'DISPONIBLE' | 'PARTIEL' | 'ABSENT'>('DISPONIBLE');
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(
    DAYS.map(day => ({ day, affaireId: null, clientId: null })),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (member) {
        setName(member.name); setRole(member.role); setEmail(member.email ?? '');
        setAvailability(member.availability);
        setSchedule(DAYS.map(day =>
          member.schedule.find(s => s.day === day) ?? { day, affaireId: null, clientId: null },
        ));
      } else {
        setName(''); setRole('Collaborateur'); setEmail(''); setAvailability('DISPONIBLE');
        setSchedule(DAYS.map(day => ({ day, affaireId: null, clientId: null })));
      }
    }
  }, [open, member]);

  // Rattachement EXCLUSIF (US-A4.1) : un seul select par jour, dont la
  // valeur encode LEQUEL des deux rattachements est choisi
  // (`affaire:<id>` / `client:<id>` / `__none__`) — décodé ici en un seul
  // slot cohérent, jamais les deux à la fois.
  const setSlotRattachement = (day: string, value: string) => {
    const [kind, id] = value === '__none__' ? [null, null] : value.split(':', 2);
    setSchedule(s => s.map(slot => slot.day === day
      ? { ...slot, affaireId: kind === 'affaire' ? id! : null, clientId: kind === 'client' ? id! : null }
      : slot));
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const url = member ? `${API}/equipe/${member.id}` : `${API}/equipe`;
      const payload: Record<string, unknown> = { name, role, availability, schedule };
      if (email.trim()) payload.email = email.trim();
      const r = await apiFetch(url, {
        method: member ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
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
              <Input type="text" value={email} onChange={e => setEmail(e.target.value)} placeholder="prenom@example.com" />
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
                {schedule.map(slot => {
                  const value = slot.affaireId ? `affaire:${slot.affaireId}`
                    : slot.clientId ? `client:${slot.clientId}`
                    : '__none__';
                  return (
                    <div key={slot.day} className="p-1.5">
                      <Select value={value} onValueChange={v => setSlotRattachement(slot.day, v)}>
                        <SelectTrigger className="h-8 text-[11px] px-2"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          <SelectGroup>
                            <SelectLabel>{words.plural.charAt(0).toUpperCase() + words.plural.slice(1)} en cours</SelectLabel>
                            {affaires.slice(0, 20).map(a => (
                              <SelectItem key={a.id} value={`affaire:${a.id}`}>{a.label.slice(0, 20)}</SelectItem>
                            ))}
                          </SelectGroup>
                          <SelectGroup>
                            <SelectLabel>Clients</SelectLabel>
                            {clients.slice(0, 20).map(c => (
                              <SelectItem key={c.id} value={`client:${c.id}`}>{c.nom.slice(0, 20)}</SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
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
