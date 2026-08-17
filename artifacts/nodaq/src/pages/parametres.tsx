import { useState, useEffect } from 'react';
import { ObjectifsParametres } from '@/components/objectifs-parametres';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Bell, Puzzle, Save, UserCog, Mail, Trash2, Clock } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useListMembres,
  useInviterMembre,
  useChangerRoleMembre,
  useRevoquerMembre,
  getListMembresQueryKey,
} from '@workspace/api-client-react';
import type { Membre } from '@workspace/api-client-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useVertical } from '@/hooks/use-vertical';
import { cn } from '@/lib/utils';

import { apiFetch } from '@/lib/auth';
const API = '/api';

type Settings = Record<string, string>;

const TABS = [
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'modules',       label: 'Modules',       icon: Puzzle },
  { id: 'membres',       label: 'Membres & accès', icon: UserCog },
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

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Propriétaire',
  MEMBER: 'Membre',
  ACCOUNTANT: 'Comptable',
};

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant={role === 'OWNER' ? 'default' : 'secondary'}>
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );
}

function InviteForm() {
  const { toast } = useToast();
  const { words } = useVertical();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'OWNER' | 'MEMBER' | 'ACCOUNTANT'>('MEMBER');
  const [libelle, setLibelle] = useState('');
  const inviter = useInviterMembre({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMembresQueryKey() });
        setEmail('');
        setLibelle('');
        toast({ title: 'Invitation envoyée', description: `Un e-mail a été envoyé à ${email.trim()}.` });
      },
      onError: (err: Error) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
    },
  });

  const handleInvite = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    inviter.mutate({ data: { email: trimmed, role, ...(libelle.trim() ? { libelle: libelle.trim() } : {}) } });
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-4">
        <Mail className="h-4 w-4 text-muted-foreground" /> Inviter un collaborateur
      </h3>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="invite-email">Adresse e-mail</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="collegue@exemple.fr"
            autoComplete="email"
          />
        </div>
        <div className="space-y-1.5 sm:w-48">
          <Label>Rôle</Label>
          <Select value={role} onValueChange={v => setRole(v as 'OWNER' | 'MEMBER' | 'ACCOUNTANT')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MEMBER">Membre</SelectItem>
              <SelectItem value="ACCOUNTANT">Comptable — accès financier</SelectItem>
              <SelectItem value="OWNER">Copropriétaire — même autorité que vous</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:self-end">
          <Button
            onClick={handleInvite}
            disabled={!email.trim() || inviter.isPending}
            className="w-full sm:w-auto gap-1.5"
          >
            <Mail className="h-3.5 w-3.5" />
            {inviter.isPending ? 'Envoi...' : 'Inviter'}
          </Button>
        </div>
      </div>
      <div className="mt-3 space-y-1.5 sm:max-w-xs">
        <Label htmlFor="invite-libelle">Fonction (facultatif)</Label>
        <Input
          id="invite-libelle"
          value={libelle}
          onChange={e => setLibelle(e.target.value)}
          placeholder="ex. Conjoint collaborateur, Associé fondateur"
        />
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Un membre voit les {words.plural}, devis et contrats sans les montants. Un comptable voit également les données financières (factures, marge, échéancier fiscal). Un copropriétaire a l'accès complet, à égalité — jamais de hiérarchie entre propriétaires.
      </p>
    </div>
  );
}

function MembresTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useListMembres();
  const [toRevoke, setToRevoke] = useState<Membre | null>(null);

  const changerRole = useChangerRoleMembre({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMembresQueryKey() });
        toast({ title: 'Rôle mis à jour' });
      },
      onError: (err: Error) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
    },
  });

  const revoquer = useRevoquerMembre({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMembresQueryKey() });
        toast({ title: 'Accès révoqué' });
      },
      onError: (err: Error) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
      onSettled: () => setToRevoke(null),
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  const membres = data?.membres ?? [];
  const invitations = data?.invitationsEnAttente ?? [];
  // US-A5.1 — plusieurs OWNER peuvent coexister à égalité ; seul LE DERNIER
  // reste protégé. Ce compte, recalculé à chaque rendu depuis la liste déjà
  // chargée, évite d'exposer un bouton de révocation qui échouerait à coup
  // sûr (le 403 backend reste la garde réelle, ceci n'évite qu'une erreur
  // inutile).
  const nbOwners = membres.filter(m => m.role === 'OWNER').length;

  const commitLibelle = (m: Membre, libelle: string) => {
    const trimmed = libelle.trim();
    if ((m.libelle ?? '') === trimmed) return;
    changerRole.mutate({ id: m.id, data: { role: m.role as 'OWNER' | 'MEMBER' | 'ACCOUNTANT', libelle: trimmed || null } });
  };

  return (
    <div className="max-w-2xl space-y-5">
      <InviteForm />

      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 px-5 pt-5 pb-3">
          <UserCog className="h-4 w-4 text-muted-foreground" /> Membres ({membres.length})
        </h3>
        <AnimatePresence>
          {membres.map(m => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 px-5 py-3 border-t border-border"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{m.nom}</div>
                <div className="text-xs text-muted-foreground truncate">{m.email}</div>
              </div>
              <Input
                key={m.id}
                defaultValue={m.libelle ?? ''}
                onBlur={e => commitLibelle(m, e.target.value)}
                placeholder="Fonction (facultatif)"
                className="h-8 w-44 text-xs shrink-0"
              />
              {m.role === 'OWNER' ? (
                <>
                  <RoleBadge role={m.role} />
                  {nbOwners > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive"
                      onClick={() => setToRevoke(m)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Select
                    value={m.role}
                    onValueChange={v => changerRole.mutate({ id: m.id, data: { role: v as 'MEMBER' | 'ACCOUNTANT' } })}
                  >
                    <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MEMBER">Membre</SelectItem>
                      <SelectItem value="ACCOUNTANT">Comptable</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive"
                    onClick={() => setToRevoke(m)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {invitations.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 px-5 pt-5 pb-3">
            <Clock className="h-4 w-4 text-muted-foreground" /> Invitations en attente ({invitations.length})
          </h3>
          {invitations.map(inv => (
            <div key={inv.id} className="flex items-center gap-3 px-5 py-3 border-t border-border">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{inv.email}</div>
                <div className="text-xs text-muted-foreground">
                  {inv.libelle ? `${inv.libelle} — ` : ''}
                  Expire le {new Date(inv.expiresAt).toLocaleDateString('fr-FR', { dateStyle: 'medium' })}
                </div>
              </div>
              <RoleBadge role={inv.role} />
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!toRevoke} onOpenChange={v => !v && setToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Révoquer l'accès de {toRevoke?.nom} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette personne ne pourra plus se connecter à cet espace. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toRevoke && revoquer.mutate({ id: toRevoke.id })}
              className="bg-destructive text-destructive-foreground"
            >
              Révoquer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ParametresPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { words } = useVertical();
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
                  description={`Analyse de la rentabilité par ${words.singular} et par période`}
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

            {activeTab === 'membres' && <MembresTab />}
          </motion.div>
        )}
      </div>
    </div>
  );
}
