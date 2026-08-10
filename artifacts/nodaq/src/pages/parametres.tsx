import { useState, useEffect } from 'react';
import { ObjectifsParametres } from '@/components/objectifs-parametres';
import { motion } from 'framer-motion';
import { Building2, Bell, Puzzle, Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

import { apiFetch } from '@/lib/auth';
const API = '/api';

type Settings = Record<string, string>;

const TABS = [
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'modules',       label: 'Modules',       icon: Puzzle },
];

function useSettings() {
  return useQuery<Settings>({
    queryKey: ['parametres'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/parametres`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json();
    },
  });
}

function Toggle({ checked, onChange, label, description }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )} />
      </button>
    </div>
  );
}

function ModuleCard({ icon: Icon, label, description, enabled, onChange }: {
  icon: React.ElementType; label: string; description: string;
  enabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-4 flex items-start gap-4 transition-colors',
      enabled ? 'border-primary/25 bg-primary/5' : 'border-card-border bg-card',
    )}>
      <div className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
        enabled ? 'bg-primary text-primary-foreground' : 'bg-sidebar-accent text-sidebar-foreground',
      )}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground text-sm">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 mt-0.5',
          enabled ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          enabled ? 'translate-x-6' : 'translate-x-1',
        )} />
      </button>
    </div>
  );
}

export default function ParametresPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useSettings();
  const [activeTab, setActiveTab] = useState('notifications');

  // Form state
  const [notifFact, setNotifFact] = useState(true);
  const [notifAction, setNotifAction] = useState(true);
  const [notifProspect, setNotifProspect] = useState(false);
  const [notifEcheance, setNotifEcheance] = useState(true);
  const [modClasseur, setModClasseur] = useState(true);
  const [modMarge, setModMarge] = useState(true);
  const [modRapport, setModRapport] = useState(true);

  // Populate form from server
  useEffect(() => {
    if (data) {
      setNotifFact(data['notif.nouvelleFact'] !== 'false');
      setNotifAction(data['notif.actionAvalider'] !== 'false');
      setNotifProspect(data['notif.prospectQualifie'] === 'true');
      setNotifEcheance(data['notif.echeanceFiscale'] !== 'false');
      setModClasseur(data['modules.classeur'] !== 'false');
      setModMarge(data['modules.marge'] !== 'false');
      setModRapport(data['modules.rapport'] !== 'false');
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async (payload: Settings) => {
      const res = await apiFetch(`${API}/parametres`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? 'Sauvegarde échouée');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parametres'] });
      toast({ title: 'Paramètres sauvegardés' });
    },
    onError: (err: Error) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const handleSave = () => {
    const payload: Settings = {
      'notif.nouvelleFact': String(notifFact),
      'notif.actionAvalider': String(notifAction),
      'notif.prospectQualifie': String(notifProspect),
      'notif.echeanceFiscale': String(notifEcheance),
      'modules.classeur': String(modClasseur),
      'modules.marge': String(modMarge),
      'modules.rapport': String(modRapport),
    };
    saveMut.mutate(payload);
  };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Plateforme"
        title="Paramètres"
        description="Configurez les notifications et les modules actifs."
        actions={
          <Button onClick={handleSave} disabled={saveMut.isPending} className="gap-1.5">
            <Save className="h-4 w-4" />
            {saveMut.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6">
        {/* Seuil de rentabilité — hors onglets, parce que c'est la seule
            valeur de cette page que le produit ne peut PAS deviner, et qu'un
            objectif non renseigné ne s'affiche nulle part ailleurs. */}
        <div className="mb-6 max-w-2xl">
          <ObjectifsParametres />
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl bg-muted p-1 w-fit mb-6">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}>

            {activeTab === 'notifications' && (
              <div className="max-w-xl">
                <div className="rounded-xl border border-card-border bg-card p-5">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
                    <Bell className="h-4 w-4 text-muted-foreground" /> Alertes et notifications
                  </h3>
                  <Toggle
                    checked={notifFact} onChange={setNotifFact}
                    label="Nouvelle facture émise"
                    description="Notifier à chaque création d'une facture dans le système"
                  />
                  <Toggle
                    checked={notifAction} onChange={setNotifAction}
                    label="Action à valider"
                    description="Alerter quand l'Agent IA propose une action à approuver"
                  />
                  <Toggle
                    checked={notifProspect} onChange={setNotifProspect}
                    label="Prospect qualifié"
                    description="Notifier quand un prospect passe en statut 'Qualifié'"
                  />
                  <Toggle
                    checked={notifEcheance} onChange={setNotifEcheance}
                    label="Échéance fiscale proche"
                    description="Rappel 30 jours avant chaque échéance fiscale"
                  />
                </div>
              </div>
            )}

            {activeTab === 'modules' && (
              <div className="max-w-2xl space-y-4">
                <p className="text-sm text-muted-foreground mb-2">
                  Activez ou désactivez les modules de votre plateforme. Les modules désactivés restent disponibles dans la navigation mais leurs données sont masquées.
                </p>
                <ModuleCard
                  icon={Building2}
                  label="Classeur"
                  description="Gestion et organisation des documents par catégorie"
                  enabled={modClasseur}
                  onChange={setModClasseur}
                />
                <ModuleCard
                  icon={Building2}
                  label="Marge"
                  description="Analyse de la rentabilité par affaire et par période"
                  enabled={modMarge}
                  onChange={setModMarge}
                />
                <ModuleCard
                  icon={Building2}
                  label="Rapport mensuel"
                  description="Vue d'ensemble mensuelle de l'activité commerciale et financière"
                  enabled={modRapport}
                  onChange={setModRapport}
                />
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
