/**
 * Reprise de l'existant 4.9 — Six blocs non bloquants.
 *
 * Ordre fixe :
 *   ① Chantiers en cours      ② Factures impayées
 *   ③ Devis en attente        ④ CA YTD (2 champs)
 *   ⑤ Équipe + congés          ⑥ Planning déduit
 *
 * Règles :
 * - Chaque bloc peut être passé avec le bouton "Passer".
 * - Seuil de silence : si l'API renvoie { donneesInsuffisantes: true },
 *   aucun chiffre calculé n'est affiché.
 * - Sous-traitant : coût inclus, capacité exclue (calculé côté serveur).
 * - Aucune barre de progression. Message contextuel si donnée manquante.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, SkipForward, Plus, Trash2, Users, Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useVertical } from '@/hooks/use-vertical';
import { compteDansCapacite } from '@nodaq/shared';
import { apiFetch } from '@/lib/auth';
import { fmtEUR } from '@/lib/format';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const API = '/api';

// ── Types ──────────────────────────────────────────────────────────────────

// Pas d'entrée `chantiers` ici : son libellé est TOUJOURS résolu par
// `useVertical()` dans BlocCard ci-dessous (mot adapté au secteur), jamais
// depuis cette table statique.
const BLOC_LABELS: Record<string, string> = {
  'impayés': 'Factures impayées',
  devis: 'Devis en attente',
  ca_ytd: 'Chiffre d\'affaires YTD',
  equipe: 'Équipe',
  planning: 'Planning déduit',
};

const BLOCS = ['chantiers', 'impayés', 'devis', 'ca_ytd', 'equipe', 'planning'] as const;
type BlocId = typeof BLOCS[number];

// ── Hook : état de la reprise ──────────────────────────────────────────────

function useReprise() {
  return useQuery({
    queryKey: ['reprise-blocs'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/reprise/blocs`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<{ blocs: BlocId[]; blocs_passes: string[] }>;
    },
  });
}

// ── Composant BlocCard ─────────────────────────────────────────────────────

function BlocCard({
  bloc,
  passe,
  onPass,
  onValidate,
  children,
}: {
  bloc: BlocId;
  passe: boolean;
  onPass: () => void;
  onValidate: (data: Record<string, unknown>) => void;
  children: (props: { onValidate: (data: Record<string, unknown>) => void }) => React.ReactNode;
}) {
  const { words } = useVertical();
  const label = bloc === 'chantiers' ? `${capitalize(words.plural)} en cours` : (BLOC_LABELS[bloc] ?? bloc);

  if (passe) {
    return (
      <div className="rounded-xl border border-border bg-card/50 p-4 flex items-center gap-3 opacity-60">
        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Check className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <span className="text-sm text-muted-foreground">{label} — passé</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <button onClick={onPass}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <SkipForward className="h-3.5 w-3.5" /> Passer
        </button>
      </div>
      <div className="p-5">
        {children({ onValidate })}
      </div>
    </div>
  );
}

// ── Blocs spécifiques ──────────────────────────────────────────────────────

interface ChantierRow {
  id: string;
  label: string;
  client: string;
  montantHt: string;
  avancement: string;
  dateFinPrevue: string;
}

function BlocChantiers({ onValidate }: { onValidate: (data: Record<string, unknown>) => void }) {
  const { words } = useVertical();
  const [rows, setRows] = useState<ChantierRow[]>([
    { id: crypto.randomUUID(), label: '', client: '', montantHt: '', avancement: '', dateFinPrevue: '' },
  ]);

  const addRow = () => setRows(r => [...r, {
    id: crypto.randomUUID(), label: '', client: '', montantHt: '', avancement: '', dateFinPrevue: '',
  }]);
  const removeRow = (id: string) => setRows(r => r.filter(x => x.id !== id));
  const update = (id: string, field: keyof ChantierRow, val: string) =>
    setRows(r => r.map(x => x.id === id ? { ...x, [field]: val } : x));

  const handleValidate = () => {
    const chantiers = rows
      .filter(r => r.label.trim())
      .map(r => ({
        label: r.label,
        client: r.client,
        montantVenduHt: r.montantHt ? Math.round(Number(r.montantHt) * 100) : null,
        avancementPct: r.avancement ? Number(r.avancement) : null,
        dateFinPrevue: r.dateFinPrevue || null,
      }));
    onValidate({ chantiers });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
              <th className="pb-2 text-left font-medium">{capitalize(words.singular)}</th>
              <th className="pb-2 text-left font-medium px-2">Client</th>
              <th className="pb-2 text-right font-medium px-2">Montant HT (€)</th>
              <th className="pb-2 text-right font-medium px-2">Avancement (%)</th>
              <th className="pb-2 text-left font-medium px-2">Fin prévue</th>
              <th className="pb-2 w-6" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-2">
                  <Input value={row.label} onChange={e => update(row.id, 'label', e.target.value)}
                    placeholder={`${capitalize(words.singular)} ${i + 1}`}
                    className="h-8 text-sm border-0 bg-transparent px-0 focus-visible:ring-0"
                    onKeyDown={e => e.key === 'Tab' && i === rows.length - 1 && (e.preventDefault(), addRow())} />
                </td>
                <td className="py-1.5 px-2">
                  <Input value={row.client} onChange={e => update(row.id, 'client', e.target.value)}
                    placeholder="Client" className="h-8 text-sm border-0 bg-transparent px-0 focus-visible:ring-0" />
                </td>
                <td className="py-1.5 px-2">
                  <Input type="number" value={row.montantHt}
                    onChange={e => update(row.id, 'montantHt', e.target.value)}
                    placeholder="0" className="h-8 text-sm text-right border-0 bg-transparent px-0 focus-visible:ring-0" min={0} />
                </td>
                <td className="py-1.5 px-2">
                  <Input type="number" value={row.avancement}
                    onChange={e => update(row.id, 'avancement', e.target.value)}
                    placeholder="0" className="h-8 text-sm text-right border-0 bg-transparent px-0 focus-visible:ring-0" min={0} max={100} />
                </td>
                <td className="py-1.5 px-2">
                  <Input type="date" value={row.dateFinPrevue}
                    onChange={e => update(row.id, 'dateFinPrevue', e.target.value)}
                    className="h-8 text-sm border-0 bg-transparent px-0 focus-visible:ring-0" />
                </td>
                <td className="py-1.5">
                  {rows.length > 1 && (
                    <button onClick={() => removeRow(row.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="ghost" size="sm" onClick={addRow} className="h-7 gap-1 text-xs">
        <Plus className="h-3.5 w-3.5" /> Ajouter {words.indefinite}
      </Button>
      <Button onClick={handleValidate} size="sm" className="gap-1.5">
        <Check className="h-3.5 w-3.5" /> Valider
      </Button>
    </div>
  );
}

function BlocImpayés({ onValidate }: { onValidate: (data: Record<string, unknown>) => void }) {
  const [rows, setRows] = useState([
    { id: crypto.randomUUID(), client: '', montant: '', dateFacture: '' },
  ]);

  const addRow = () => setRows(r => [...r, { id: crypto.randomUUID(), client: '', montant: '', dateFacture: '' }]);
  const removeRow = (id: string) => setRows(r => r.filter(x => x.id !== id));
  const update = (id: string, field: 'client' | 'montant' | 'dateFacture', val: string) =>
    setRows(r => r.map(x => x.id === id ? { ...x, [field]: val } : x));

  const today = new Date();
  const totalCents = rows.reduce((s, r) => s + (Number(r.montant) * 100 || 0), 0);

  const getJoursRetard = (dateFacture: string) => {
    if (!dateFacture) return null;
    const d = new Date(dateFacture);
    const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
    return diff > 0 ? diff : null;
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Factures émises non encore réglées à ce jour.</p>
      <div className="space-y-2">
        {rows.map(row => {
          const jours = getJoursRetard(row.dateFacture);
          return (
            <div key={row.id} className="grid grid-cols-[1fr_120px_120px_auto] gap-2 items-center">
              <Input value={row.client} onChange={e => update(row.id, 'client', e.target.value)}
                placeholder="Nom du client" className="h-8 text-sm" />
              <Input type="number" value={row.montant}
                onChange={e => update(row.id, 'montant', e.target.value)}
                placeholder="Montant (€)" className="h-8 text-sm text-right" min={0} />
              <Input type="date" value={row.dateFacture}
                onChange={e => update(row.id, 'dateFacture', e.target.value)}
                className="h-8 text-sm" />
              <button onClick={() => removeRow(row.id)} className="text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {jours !== null && row.montant && (
                <div className="col-span-4 text-xs text-amber-600 dark:text-amber-400 -mt-1">
                  {fmtEUR(Number(row.montant) * 100)} — en retard depuis {jours} jour{jours > 1 ? 's' : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={addRow} className="h-7 gap-1 text-xs">
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </Button>
        {totalCents > 0 && (
          <span className="text-xs text-muted-foreground">
            Total impayé : <strong>{fmtEUR(totalCents)}</strong>
          </span>
        )}
      </div>
      <Button size="sm" onClick={() => onValidate({ impayés: rows.filter(r => r.client && r.montant) })} className="gap-1.5">
        <Check className="h-3.5 w-3.5" /> Valider
      </Button>
    </div>
  );
}

function BlocDevis({ onValidate }: { onValidate: (data: Record<string, unknown>) => void }) {
  const [rows, setRows] = useState([
    { id: crypto.randomUUID(), client: '', montant: '', dateEnvoi: '' },
  ]);
  const addRow = () => setRows(r => [...r, { id: crypto.randomUUID(), client: '', montant: '', dateEnvoi: '' }]);
  const update = (id: string, field: 'client' | 'montant' | 'dateEnvoi', val: string) =>
    setRows(r => r.map(x => x.id === id ? { ...x, [field]: val } : x));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Devis envoyés, en attente de réponse.</p>
      {rows.map(row => (
        <div key={row.id} className="grid grid-cols-[1fr_120px_120px] gap-2">
          <Input value={row.client} onChange={e => update(row.id, 'client', e.target.value)}
            placeholder="Client" className="h-8 text-sm" />
          <Input type="number" value={row.montant}
            onChange={e => update(row.id, 'montant', e.target.value)}
            placeholder="Montant HT (€)" className="h-8 text-sm text-right" min={0} />
          <Input type="date" value={row.dateEnvoi}
            onChange={e => update(row.id, 'dateEnvoi', e.target.value)}
            className="h-8 text-sm" />
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={addRow} className="h-7 gap-1 text-xs">
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </Button>
      <Button size="sm" onClick={() => onValidate({ devis: rows.filter(r => r.client) })} className="gap-1.5">
        <Check className="h-3.5 w-3.5" /> Valider
      </Button>
    </div>
  );
}

function BlocCaYtd({ onValidate }: { onValidate: (data: Record<string, unknown>) => void }) {
  const [caFacture, setCaFacture] = useState('');
  const [caEncaisse, setCaEncaisse] = useState('');
  const [dateDebut, setDateDebut] = useState('');

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Depuis le début de l'exercice en cours.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">CA facturé (€)</Label>
          <Input type="number" value={caFacture} onChange={e => setCaFacture(e.target.value)}
            placeholder="ex. 85000" min={0} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">CA encaissé (€)</Label>
          <Input type="number" value={caEncaisse} onChange={e => setCaEncaisse(e.target.value)}
            placeholder="ex. 72000" min={0} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Début de l'exercice</Label>
          <Input type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)} />
        </div>
      </div>
      <Button size="sm" onClick={() => onValidate({
        ca_facture_ytd: caFacture ? Number(caFacture) : undefined,
        ca_encaisse_ytd: caEncaisse ? Number(caEncaisse) : undefined,
        date_debut_exercice: dateDebut || undefined,
      })} className="gap-1.5">
        <Check className="h-3.5 w-3.5" /> Valider
      </Button>
    </div>
  );
}

function BlocEquipe({ onValidate }: { onValidate: (data: Record<string, unknown>) => void }) {
  const { externalWorkerWords } = useVertical();
  const [rows, setRows] = useState([
    { id: crypto.randomUUID(), name: '', typeLien: 'SALARIE', joursParSemaine: '5', coutMensuel: '' },
  ]);
  const addRow = () => setRows(r => [...r, {
    id: crypto.randomUUID(), name: '', typeLien: 'SALARIE', joursParSemaine: '5', coutMensuel: '',
  }]);
  const update = (id: string, field: string, val: string) =>
    setRows(r => r.map(x => x.id === id ? { ...x, [field]: val } : x));

  const totalCout = rows.reduce((s, r) => s + (Number(r.coutMensuel) || 0), 0);
  const capacite = rows
    .filter(r => compteDansCapacite(r.typeLien))
    .reduce((s, r) => s + (Number(r.joursParSemaine) || 5), 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Les {externalWorkerWords.plural} sont inclus dans le coût mais pas dans la capacité de production.
      </p>
      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.id} className="grid grid-cols-[1fr_130px_80px_120px] gap-2 items-center">
            <Input value={row.name} onChange={e => update(row.id, 'name', e.target.value)}
              placeholder="Prénom" className="h-8 text-sm" />
            <select value={row.typeLien} onChange={e => update(row.id, 'typeLien', e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm">
              <option value="SALARIE">Salarié</option>
              <option value="SOUS_TRAITANT">
                {externalWorkerWords.singular.charAt(0).toUpperCase() + externalWorkerWords.singular.slice(1)}
              </option>
              <option value="APPRENTI">Apprenti</option>
            </select>
            <Input type="number" value={row.joursParSemaine}
              onChange={e => update(row.id, 'joursParSemaine', e.target.value)}
              title="Jours/semaine" placeholder="5j" className="h-8 text-sm text-right" min={1} max={7} />
            <Input type="number" value={row.coutMensuel}
              onChange={e => update(row.id, 'coutMensuel', e.target.value)}
              title="Coût mensuel chargé (€)" placeholder="Coût mensuel €" className="h-8 text-sm text-right" min={0} />
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={addRow} className="h-7 gap-1 text-xs">
        <Plus className="h-3.5 w-3.5" /> Ajouter un membre
      </Button>
      {rows.some(r => r.name) && (
        <div className="text-xs text-muted-foreground flex gap-4">
          <span><Users className="h-3 w-3 inline mr-1" />{capacite} j/sem de capacité</span>
          {totalCout > 0 && <span><Calculator className="h-3 w-3 inline mr-1" />{fmtEUR(totalCout * 100)}/mois</span>}
        </div>
      )}
      <Button size="sm" onClick={() => onValidate({ equipe: rows.filter(r => r.name) })} className="gap-1.5">
        <Check className="h-3.5 w-3.5" /> Valider
      </Button>
    </div>
  );
}

function BlocPlanning({ onValidate, donneesInsuffisantes }: {
  onValidate: (data: Record<string, unknown>) => void;
  donneesInsuffisantes?: boolean;
}) {
  const { words } = useVertical();
  // `indefinite` ("un chantier"/"une mission") est le seul endroit où le genre
  // du mot est explicite dans `AffaireWords` — s'en servir ici pour accorder
  // "enregistré(e)s", plutôt que de figer un accord féminin hérité d'« affaires ».
  const feminin = words.indefinite.startsWith('une ');
  if (donneesInsuffisantes) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg bg-muted/50 border border-border p-3 text-sm text-muted-foreground">
          Avec moins de 3 {words.plural} enregistré{feminin ? 'es' : 's'}, le planning déduit ne peut pas encore être calculé.
          Ajoutez d'abord vos {words.plural} en cours.
        </div>
        <Button size="sm" onClick={() => onValidate({})} className="gap-1.5">
          <Check className="h-3.5 w-3.5" /> Continuer
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Le planning est déduit de vos {words.plural} et de votre équipe.
        Vous pouvez corriger la répartition de la semaine en cours.
      </p>
      <Button size="sm" onClick={() => onValidate({})} className="gap-1.5">
        <Check className="h-3.5 w-3.5" /> Valider le planning déduit
      </Button>
    </div>
  );
}

// ── Page principale ────────────────────────────────────────────────────────

export default function ReprisePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useReprise();
  const [donneesInsuffisantes, setDonneesInsuffisantes] = useState(false);

  const passerMut = useMutation({
    mutationFn: async ({ bloc, data: payload }: { bloc: BlocId; data?: Record<string, unknown> }) => {
      const res = await apiFetch(`${API}/reprise/blocs/${bloc}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ? { data: payload } : { passer: true }),
      });
      if (!res.ok) throw new Error('Erreur');
      return res.json() as Promise<{ donneesInsuffisantes?: boolean }>;
    },
    onSuccess: (result) => {
      if (result.donneesInsuffisantes) setDonneesInsuffisantes(true);
      qc.invalidateQueries({ queryKey: ['reprise-blocs'] });
    },
    onError: () => toast({ title: 'Erreur', variant: 'destructive' }),
  });

  const blocs_passes = new Set(data?.blocs_passes ?? []);
  const allDone = BLOCS.every(b => blocs_passes.has(b));

  if (isLoading) return <div className="p-8 text-center text-sm text-muted-foreground">Chargement…</div>;

  if (allDone) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-4">
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Check className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Reprise terminée</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Vos données de départ sont enregistrées. Vous pouvez les affiner à tout moment.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-16">
      <div className="px-5 md:px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground">Reprise de l'existant</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Saisissez l'état actuel de votre activité. Chaque bloc peut être passé si vous n'avez pas l'information sous la main.
        </p>
      </div>

      <div className="px-5 md:px-8 space-y-4">
        <AnimatePresence>
          {BLOCS.map(bloc => (
            <motion.div key={bloc}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: BLOCS.indexOf(bloc) * 0.05 }}>
              <BlocCard
                bloc={bloc}
                passe={blocs_passes.has(bloc)}
                onPass={() => passerMut.mutate({ bloc, data: undefined })}
                onValidate={d => passerMut.mutate({ bloc, data: d })}
              >
                {({ onValidate }) => {
                  if (bloc === 'chantiers') return <BlocChantiers onValidate={onValidate} />;
                  if (bloc === 'impayés') return <BlocImpayés onValidate={onValidate} />;
                  if (bloc === 'devis') return <BlocDevis onValidate={onValidate} />;
                  if (bloc === 'ca_ytd') return <BlocCaYtd onValidate={onValidate} />;
                  if (bloc === 'equipe') return <BlocEquipe onValidate={onValidate} />;
                  if (bloc === 'planning') return <BlocPlanning onValidate={onValidate} donneesInsuffisantes={donneesInsuffisantes} />;
                  return null;
                }}
              </BlocCard>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
