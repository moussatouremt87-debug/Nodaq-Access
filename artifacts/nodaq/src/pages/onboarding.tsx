/**
 * Onboarding 4.8 — Profil d'entreprise.
 *
 * Quatre écrans non bloquants :
 *   Écran 0 : Secteur d'activité (US-A1.1) — LA question fondatrice : sans
 *             elle, tout le vocabulaire qui suit (« chantier », « devis »)
 *             présume du bâtiment pour un secteur qui n'en est pas.
 *   Écran 1 : Recherche SIRET / nom → confirmation → détection de pack
 *             + formulaire manuel si l'API est indisponible ou renvoie aucun résultat
 *   Écran 2 : Dépôt ancienne facture (stub OCR honnête) + bouton "Plus tard"
 *   Écran 3 : Décennale + table équipe + taux horaire
 *
 * Règles :
 * - Aucun écran n'est bloquant (bouton "Plus tard" partout), y compris le
 *   secteur — sauter revient au vocabulaire BTP historique (le défaut
 *   serveur), pas à une valeur devinée.
 * - La détection métier est affichée, jamais gardée silencieuse.
 * - Le stub OCR dit explicitement "non branché" — pas de simulation.
 * - Formulaire manuel disponible dès que la recherche échoue ou renvoie aucun résultat.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Building2, Check, ArrowRight, Upload, FileText,
  Users, Clock, Shield, ChevronRight, PenLine, Plus, Trash2, Briefcase,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';
import { useLocation } from 'wouter';
import { useUpdateVerticalMutation, secteursOnboarding } from '@/hooks/use-vertical';
import type { Vertical } from '@nodaq/shared';

const API = '/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface EntrepriseResult {
  siret: string;
  siren: string;
  raisonSociale: string;
  formeJuridique: string;
  adresse: string;
  codePostal: string;
  commune: string;
  codeNaf: string;
  libelleNaf: string;
  trancheEffectif: string | null;
  dateCreation: string | null;
  etatAdministratif: string;
  tvaIntracom?: string;
}

interface SearchResponse {
  results: EntrepriseResult[];
  rateLimited?: boolean;
  fromCache?: boolean;
}

interface TeamRow {
  name: string;
  typeLien: 'SALARIE' | 'SOUS_TRAITANT' | 'APPRENTI';
  joursParSemaine: number;
}

const PACK_LABELS: Record<string, string> = {
  batiment: 'Bâtiment & travaux',
  generique: 'Artisan / TPE',
};

// ── Utilitaire NAF → pack ──────────────────────────────────────────────────

function derivePack(codeNaf: string): string {
  if (!codeNaf) return 'generique';
  const cleaned = codeNaf.replace(/\s/g, '').toUpperCase();
  const normalized = cleaned.match(/^\d{2}\.\d{2}/)
    ? cleaned
    : cleaned.replace(/^(\d{2})(\d{2})/, '$1.$2');
  const BATIMENT = ['41.1', '41.2', '42.1', '42.2', '42.9', '43.1', '43.2', '43.3', '43.9'];
  return BATIMENT.some(p => normalized.startsWith(p)) ? 'batiment' : 'generique';
}

// ── Formulaire manuel ──────────────────────────────────────────────────────

function FormulaireManuel({
  initial,
  onConfirm,
  onCancel,
}: {
  initial?: Partial<EntrepriseResult>;
  onConfirm: (e: EntrepriseResult) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<EntrepriseResult>({
    siret: initial?.siret ?? '',
    siren: initial?.siren ?? '',
    raisonSociale: initial?.raisonSociale ?? '',
    formeJuridique: initial?.formeJuridique ?? '',
    adresse: initial?.adresse ?? '',
    codePostal: initial?.codePostal ?? '',
    commune: initial?.commune ?? '',
    codeNaf: initial?.codeNaf ?? '',
    libelleNaf: initial?.libelleNaf ?? '',
    trancheEffectif: null,
    dateCreation: null,
    etatAdministratif: 'A',
    tvaIntracom: initial?.tvaIntracom ?? '',
  });

  const set = (field: keyof EntrepriseResult, value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = () => {
    if (!form.siret.trim() || !form.raisonSociale.trim()) {
      toast({ title: 'SIRET et raison sociale sont requis', variant: 'destructive' });
      return;
    }
    if (!/^\d{14}$/.test(form.siret.replace(/\s/g, ''))) {
      toast({ title: 'SIRET invalide', description: 'Le SIRET doit contenir 14 chiffres.', variant: 'destructive' });
      return;
    }
    onConfirm({ ...form, siret: form.siret.replace(/\s/g, '') });
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <PenLine className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Saisie manuelle</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Raison sociale *</Label>
          <Input placeholder="ex. SAS Dupont Bâtiment" value={form.raisonSociale}
            onChange={e => set('raisonSociale', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">SIRET * (14 chiffres)</Label>
          <Input placeholder="ex. 12345678901234" value={form.siret}
            onChange={e => set('siret', e.target.value)} maxLength={14} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">TVA intracommunautaire</Label>
          <Input placeholder="ex. FR12345678901" value={form.tvaIntracom ?? ''}
            onChange={e => set('tvaIntracom', e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Adresse</Label>
          <Input placeholder="ex. 1 rue de la Paix" value={form.adresse}
            onChange={e => set('adresse', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Code postal</Label>
          <Input placeholder="ex. 75001" value={form.codePostal}
            onChange={e => set('codePostal', e.target.value)} maxLength={5} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Commune</Label>
          <Input placeholder="ex. Paris" value={form.commune}
            onChange={e => set('commune', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Code NAF</Label>
          <Input placeholder="ex. 43.12Z" value={form.codeNaf}
            onChange={e => set('codeNaf', e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Forme juridique</Label>
          <Input placeholder="ex. SARL" value={form.formeJuridique}
            onChange={e => set('formeJuridique', e.target.value)} />
        </div>
      </div>

      {form.codeNaf && (
        <div className="rounded-md bg-background border border-border px-3 py-2 flex items-center gap-2 text-sm">
          <Building2 className="h-4 w-4 text-primary shrink-0" />
          <span className="text-muted-foreground">Pack détecté : </span>
          <span className="font-medium text-foreground">
            {PACK_LABELS[derivePack(form.codeNaf)] ?? PACK_LABELS.generique}
          </span>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button onClick={handleSubmit} className="gap-1.5">
          <Check className="h-4 w-4" /> Confirmer
        </Button>
        <Button variant="ghost" onClick={onCancel} className="text-muted-foreground">
          Retour à la recherche
        </Button>
      </div>
    </div>
  );
}

// ── Écran 0 — Secteur d'activité (US-A1.1) ─────────────────────────────────

function EcranSecteur({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Vertical | null>(null);
  const { updateVertical, isPending } = useUpdateVerticalMutation();
  const secteurs = secteursOnboarding();

  const handleContinue = () => {
    if (!selected) { onNext(); return; }
    updateVertical(selected, {
      onSuccess: onNext,
      onError: () => {
        toast({ title: 'Secteur non enregistré', description: 'Vous pourrez le régler depuis "Votre métier".', variant: 'destructive' });
        onNext();
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Quel est votre secteur d'activité ?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Le vocabulaire de l'application (devis, chantier, mission…) s'adapte à votre métier.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {secteurs.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSelected(s.id)}
            className={`flex items-center gap-2.5 rounded-xl border p-3.5 text-left text-sm transition-colors ${
              selected === s.id
                ? 'border-primary bg-primary/5 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40'
            }`}
            data-testid={`option-secteur-${s.id}`}
          >
            <Briefcase className="h-4 w-4 shrink-0" />
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={handleContinue} disabled={isPending} className="gap-1.5">
          <ArrowRight className="h-4 w-4" />
          {isPending ? 'Enregistrement…' : 'Continuer'}
        </Button>
        <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
          Plus tard
        </Button>
      </div>
    </div>
  );
}

// ── Écran 1 — Recherche SIRET + fallback manuel ────────────────────────────

function EcranRecherche({
  onConfirm,
  onSkip,
}: {
  onConfirm: (e: EntrepriseResult) => void;
  onSkip: () => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EntrepriseResult[]>([]);
  const [selected, setSelected] = useState<EntrepriseResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setResults([]);
    setSelected(null);
    setShowManual(false);
    try {
      const res = await apiFetch(`${API}/entreprises/recherche`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query.trim() }),
      });
      if (!res.ok) {
        // API indisponible → proposer formulaire manuel
        setRateLimited(false);
        setSearched(true);
        toast({ title: 'API indisponible', description: 'Vous pouvez saisir vos informations manuellement.', variant: 'destructive' });
        return;
      }
      const data: SearchResponse = await res.json();
      if (data.rateLimited) {
        setRateLimited(true);
        setSearched(true);
        toast({ title: 'API temporairement indisponible', description: 'Réessayez dans quelques secondes, ou saisissez manuellement.', variant: 'destructive' });
      } else {
        setRateLimited(false);
        setSearched(true);
        setResults(data.results ?? []);
      }
    } catch {
      setSearched(true);
      toast({ title: 'Erreur réseau', description: 'L\'API n\'est pas joignable. Vous pouvez saisir manuellement.', variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  const packLabel = selected
    ? (PACK_LABELS[derivePack(selected.codeNaf)] ?? PACK_LABELS.generique)
    : '';

  if (showManual) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Votre entreprise</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Renseignez vos informations directement.
          </p>
        </div>
        <FormulaireManuel
          onConfirm={onConfirm}
          onCancel={() => setShowManual(false)}
        />
        <div className="pt-2 border-t border-border">
          <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground underline">
            Passer cette étape — je renseignerai mon SIRET plus tard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Votre entreprise</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Entrez votre SIRET ou le nom de votre entreprise — on remplit la fiche automatiquement.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="SIRET (14 chiffres) ou nom de l'entreprise"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="flex-1"
          data-testid="input-siret"
        />
        <Button onClick={handleSearch} disabled={searching || !query.trim()}>
          <Search className="h-4 w-4 mr-1.5" />
          {searching ? 'Recherche…' : 'Chercher'}
        </Button>
      </div>

      {results.length > 0 && !selected && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{results.length} résultat{results.length > 1 ? 's' : ''} — sélectionnez votre entreprise</p>
          {results.map(r => (
            <button
              key={r.siret}
              onClick={() => setSelected(r)}
              className="w-full text-left rounded-lg border border-card-border bg-card hover:border-primary/50 p-3 transition-colors"
            >
              <div className="font-medium text-foreground">{r.raisonSociale}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                SIRET {r.siret} · {r.commune} ({r.codePostal}) · {r.libelleNaf || r.codeNaf}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Aucun résultat après recherche → proposer saisie manuelle */}
      {searched && results.length === 0 && !selected && !rateLimited && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Aucun résultat trouvé.{' '}
          <button
            onClick={() => setShowManual(true)}
            className="text-primary underline font-medium"
            data-testid="btn-saisie-manuelle"
          >
            Saisir manuellement
          </button>
        </div>
      )}

      {/* API rate-limitée → proposer saisie manuelle */}
      {rateLimited && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          L'API gouvernementale est temporairement indisponible.{' '}
          <button
            onClick={() => setShowManual(true)}
            className="underline font-medium"
            data-testid="btn-saisie-manuelle-rate-limit"
          >
            Saisir manuellement mes informations
          </button>
        </div>
      )}

      {selected && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-foreground">{selected.raisonSociale}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {selected.formeJuridique} · SIRET {selected.siret}
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs text-muted-foreground hover:text-foreground underline shrink-0">
              Changer
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Adresse</span><br /><span className="text-foreground">{selected.adresse}, {selected.codePostal} {selected.commune}</span></div>
            <div><span className="text-muted-foreground">Activité (NAF)</span><br /><span className="text-foreground">{selected.codeNaf} — {selected.libelleNaf || PACK_LABELS[derivePack(selected.codeNaf)]}</span></div>
            {selected.tvaIntracom && (
              <div><span className="text-muted-foreground">TVA intracommunautaire</span><br /><span className="text-foreground">{selected.tvaIntracom}</span></div>
            )}
            {selected.dateCreation && (
              <div><span className="text-muted-foreground">Création</span><br /><span className="text-foreground">{selected.dateCreation}</span></div>
            )}
          </div>

          <div className="rounded-md bg-background border border-border px-3 py-2 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm">
              <span className="text-muted-foreground">Pack détecté : </span>
              <span className="font-medium text-foreground">{packLabel}</span>
            </span>
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={() => onConfirm(selected)} className="flex-1 gap-1.5">
              <Check className="h-4 w-4" /> Confirmer ces informations
            </Button>
          </div>
        </motion.div>
      )}

      {/* Toujours accessible : bouton saisie manuelle directe */}
      <div className="pt-2 border-t border-border flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
        <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground underline">
          Passer cette étape — je renseignerai mon SIRET plus tard
        </button>
        <span className="hidden sm:inline text-border">|</span>
        <button
          onClick={() => setShowManual(true)}
          className="text-sm text-muted-foreground hover:text-foreground underline"
          data-testid="btn-saisie-manuelle-direct"
        >
          Saisir manuellement sans rechercher
        </button>
      </div>
    </div>
  );
}

// ── Écran 2 — Dépôt ancienne facture ──────────────────────────────────────

function EcranClasseur({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [file, setFile] = useState<File | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    // Aucun upload effectué — le fichier reste en mémoire locale uniquement.
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Ancienne facture</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Déposez une ancienne facture pour retrouver votre numérotation habituelle.
          Elle sera rangée dans votre classeur.
        </p>
      </div>

      <label className="block rounded-xl border-2 border-dashed border-border bg-card hover:border-primary/50 cursor-pointer transition-colors p-8 text-center">
        <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg"
          onChange={handleFile} />
        <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <div className="text-sm font-medium text-foreground">Déposer un PDF ou une image</div>
        <div className="text-xs text-muted-foreground mt-1">PDF, PNG, JPG — max 10 Mo</div>
      </label>

      {file && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border px-3 py-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="truncate text-foreground">{file.name}</span>
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            Sélectionné
          </span>
        </div>
      )}

      {/* Message honnête : upload et OCR non disponibles */}
      <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        L'upload de fichiers et l'extraction automatique (OCR) ne sont pas encore disponibles.
        Cliquez sur "Continuer" — vous saisirez votre numérotation directement dans vos futurs devis.
      </div>

      <div className="flex gap-2">
        <Button onClick={onNext} className="gap-1.5">
          <ArrowRight className="h-4 w-4" />
          {file ? 'Continuer' : 'Continuer sans facture'}
        </Button>
        <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
          Plus tard
        </Button>
      </div>
    </div>
  );
}

// ── Écran 3 — Décennale + équipe + taux horaire ────────────────────────────

function EcranMetier({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const { toast } = useToast();
  const [decennale, setDecennale] = useState({ assureur: '', numero: '', couverture: '' });
  const [tauxHoraire, setTauxHoraire] = useState('');
  const [saving, setSaving] = useState(false);

  // Table équipe
  const [equipe, setEquipe] = useState<TeamRow[]>([]);
  const addMembre = () =>
    setEquipe(e => [...e, { name: '', typeLien: 'SALARIE', joursParSemaine: 5 }]);
  const removeMembre = (i: number) => setEquipe(e => e.filter((_, j) => j !== i));
  const updateMembre = (i: number, patch: Partial<TeamRow>) =>
    setEquipe(e => e.map((m, j) => j === i ? { ...m, ...patch } : m));

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, string> = {};
      if (decennale.assureur) updates['company.decennale_assureur'] = decennale.assureur;
      if (decennale.numero) updates['company.decennale_numero'] = decennale.numero;
      if (decennale.couverture) updates['company.decennale_couverture'] = decennale.couverture;
      if (tauxHoraire) updates['company.taux_horaire_reel'] = tauxHoraire;

      // Sauvegarder les champs libres du profil
      if (Object.keys(updates).length > 0) {
        const r = await apiFetch(`${API}/onboarding/profil`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (!r.ok) throw new Error('Sauvegarde profil échouée');
      }

      // Sauvegarder les membres de l'équipe via le bloc de reprise équipe
      const validMembers = equipe.filter(m => m.name.trim());
      if (validMembers.length > 0) {
        const r = await apiFetch(`${API}/reprise/blocs/equipe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: {
              equipe: validMembers.map(m => ({
                name: m.name.trim(),
                typeLien: m.typeLien,
                joursParSemaine: m.joursParSemaine,
              })),
            },
          }),
        });
        if (!r.ok) throw new Error('Sauvegarde équipe échouée');
      }

      onDone();
    } catch {
      toast({ title: 'Erreur de sauvegarde', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Votre métier</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Ces informations apparaîtront sur vos devis et factures.
        </p>
      </div>

      {/* Décennale */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Assurance décennale</span>
          <span className="text-xs text-muted-foreground">(mention légale obligatoire)</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Assureur</Label>
            <Input placeholder="ex. MAAF Pro" value={decennale.assureur}
              onChange={e => setDecennale(d => ({ ...d, assureur: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Numéro de contrat</Label>
            <Input placeholder="ex. 12345678" value={decennale.numero}
              onChange={e => setDecennale(d => ({ ...d, numero: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Zone couverte</Label>
            <Input placeholder="ex. France entière" value={decennale.couverture}
              onChange={e => setDecennale(d => ({ ...d, couverture: e.target.value }))} />
          </div>
        </div>
        {!decennale.assureur && (
          <p className="text-xs text-muted-foreground">
            Il manque l'assurance décennale. Sans elle, vos devis ne peuvent pas afficher la mention légale obligatoire.
          </p>
        )}
      </div>

      {/* Taux horaire */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <Label className="text-sm font-medium">Taux horaire réel (€/h)</Label>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            type="number"
            placeholder="ex. 55"
            value={tauxHoraire}
            onChange={e => setTauxHoraire(e.target.value)}
            className="w-32"
            min={0}
          />
          <span className="text-sm text-muted-foreground">€/h</span>
        </div>
      </div>

      {/* Équipe */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Votre équipe</span>
            <span className="text-xs text-muted-foreground">(facultatif)</span>
          </div>
          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={addMembre}>
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        </div>

        {equipe.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ajoutez vos salariés, apprentis et sous-traitants habituels pour que le planning soit pré-rempli.
          </p>
        )}

        {equipe.map((m, i) => (
          <div key={i} className="grid grid-cols-[1fr_140px_80px_32px] gap-2 items-end">
            <div className="space-y-1">
              {i === 0 && <Label className="text-xs">Prénom / nom</Label>}
              <Input
                placeholder="ex. Jean Martin"
                value={m.name}
                onChange={e => updateMembre(i, { name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              {i === 0 && <Label className="text-xs">Type</Label>}
              <select
                value={m.typeLien}
                onChange={e => updateMembre(i, { typeLien: e.target.value as TeamRow['typeLien'] })}
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="SALARIE">Salarié</option>
                <option value="APPRENTI">Apprenti</option>
                <option value="SOUS_TRAITANT">Sous-traitant</option>
              </select>
            </div>
            <div className="space-y-1">
              {i === 0 && <Label className="text-xs">J/sem</Label>}
              <Input
                type="number"
                min={1}
                max={7}
                value={m.joursParSemaine}
                onChange={e => updateMembre(i, { joursParSemaine: Number(e.target.value) })}
                className="w-full"
              />
            </div>
            <div className={i === 0 ? 'pt-5' : ''}>
              <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => removeMembre(i)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}

        {equipe.some(m => m.typeLien === 'SOUS_TRAITANT') && (
          <p className="text-xs text-muted-foreground">
            Les sous-traitants sont inclus dans votre coût mensuel mais exclus du calcul de capacité.
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          <Check className="h-4 w-4" />
          {saving ? 'Sauvegarde…' : 'Enregistrer et terminer'}
        </Button>
        <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
          Plus tard
        </Button>
      </div>
    </div>
  );
}

// ── Page principale ────────────────────────────────────────────────────────

type Screen = 'secteur' | 'recherche' | 'classeur' | 'metier' | 'done';

export default function OnboardingPage() {
  const [screen, setScreen] = useState<Screen>('secteur');
  const [_, navigate] = useLocation();
  const { toast } = useToast();

  const confirmMut = useMutation({
    mutationFn: async (entreprise: EntrepriseResult) => {
      const res = await apiFetch(`${API}/onboarding/profil/confirmer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siret: entreprise.siret,
          siren: entreprise.siren,
          raison_sociale: entreprise.raisonSociale,
          forme_juridique: entreprise.formeJuridique,
          adresse: entreprise.adresse,
          code_postal: entreprise.codePostal,
          commune: entreprise.commune,
          code_naf: entreprise.codeNaf,
          libelle_naf: entreprise.libelleNaf,
          tranche_effectif: entreprise.trancheEffectif ?? undefined,
          date_creation: entreprise.dateCreation ?? undefined,
          tva_intracom: entreprise.tvaIntracom ?? undefined,
          pack_metier: derivePack(entreprise.codeNaf),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'Confirmation échouée');
      }
    },
    onSuccess: () => setScreen('classeur'),
    onError: (e: Error) => toast({ title: e.message || 'Erreur de confirmation', variant: 'destructive' }),
  });

  const STEPS: { id: Screen; label: string }[] = [
    { id: 'secteur', label: 'Secteur' },
    { id: 'recherche', label: 'Entreprise' },
    { id: 'classeur', label: 'Documents' },
    { id: 'metier', label: 'Métier' },
  ];
  const currentIdx = STEPS.findIndex(s => s.id === screen);

  if (screen === 'done') {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center px-4">
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Check className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Votre profil est enregistré</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Vous pouvez compléter ces informations à tout moment depuis "Profil entreprise" dans le menu.
        </p>
        <Button onClick={() => navigate('/')}>Accéder au cockpit</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            {STEPS.map((step, i) => (
              <span key={step.id} className="flex items-center gap-2">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
                <span className={i === currentIdx ? 'text-foreground font-medium' : ''}>
                  {step.label}
                </span>
              </span>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={screen}
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
            {screen === 'secteur' && (
              <EcranSecteur
                onNext={() => setScreen('recherche')}
                onSkip={() => setScreen('recherche')}
              />
            )}
            {screen === 'recherche' && (
              <EcranRecherche
                onConfirm={e => confirmMut.mutate(e)}
                onSkip={() => setScreen('classeur')}
              />
            )}
            {screen === 'classeur' && (
              <EcranClasseur
                onNext={() => setScreen('metier')}
                onSkip={() => setScreen('metier')}
              />
            )}
            {screen === 'metier' && (
              <EcranMetier
                onDone={() => setScreen('done')}
                onSkip={() => setScreen('done')}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
