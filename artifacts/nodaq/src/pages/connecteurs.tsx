import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2, XCircle, AlertCircle, Link2, Link2Off,
  Building2, Calculator, CreditCard, HardDrive, MessageSquare, Zap,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

import { apiFetch } from '@/lib/auth';
const API = '/api';

type Connector = {
  id: string; type: string; label: string; description?: string | null;
  status: 'NON_CONNECTE' | 'CONNECTE' | 'ERREUR'; config: Record<string, string>;
  lastSyncAt?: string | null; createdAt: string;
};
type ConnectorsResponse = { connectors: Connector[]; connected: number; withError: number; total: number };

const CONNECTOR_ICONS: Record<string, React.ElementType> = {
  BANQUE: Building2,
  PENNYLANE: Calculator,
  STRIPE: CreditCard,
  GOOGLE_DRIVE: HardDrive,
  SLACK: MessageSquare,
  ZAPIER: Zap,
};

// BANQUE n'a plus d'entrée ici : la connexion passe par le funnel hébergé
// Bridge Connect (redirection), pas une clé API saisie à la main — voir
// handleConnecterBanque().
const CONNECTOR_FIELDS: Record<string, { key: string; label: string; placeholder: string; type?: string }[]> = {
  PENNYLANE:    [{ key: 'apiKey', label: 'Clé API Pennylane', placeholder: 'pyl_••••••••', type: 'password' }],
  STRIPE:       [{ key: 'secretKey', label: 'Secret key Stripe', placeholder: 'sk_live_••••••••', type: 'password' }, { key: 'webhookSecret', label: 'Webhook secret', placeholder: 'whsec_••••••••', type: 'password' }],
  GOOGLE_DRIVE: [{ key: 'clientId', label: 'Client ID', placeholder: 'xxx.apps.googleusercontent.com' }, { key: 'clientSecret', label: 'Client secret', placeholder: 'GOCSPX-••••••••', type: 'password' }],
  SLACK:        [{ key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/...', type: 'password' }],
  ZAPIER:       [{ key: 'webhookUrl', label: 'Webhook URL Zapier', placeholder: 'https://hooks.zapier.com/...', type: 'password' }],
};

/**
 * Ce que chaque connexion APPORTE, dit du point de vue de l'artisan.
 *
 * ── Pourquoi ce texte est ici et pas en base ──────────────────────────────
 * « Beaucoup trop compliqué pour des artisans d'intégrer leurs outils de cette
 * manière. » Les descriptions stockées décrivent la MÉCANIQUE
 * (« Synchronisation des transactions bancaires », « Automatisation de
 * workflows ») : elles disent ce que le logiciel fait, pas ce que
 * l'utilisateur y gagne.
 *
 * Un libellé est de la présentation. Le mettre ici plutôt qu'en base le rend
 * corrigeable sans migration, et l'applique aux tenants existants — dont les
 * lignes portent déjà l'ancien texte, qu'aucun changement de valeur par défaut
 * ne réécrira.
 */
const BENEFICES: Record<string, string> = {
  BANQUE: "Vos paiements reçus se pointent tout seuls sur vos factures.",
  PENNYLANE: "Votre comptable reçoit vos factures sans que vous les lui envoyiez.",
  STRIPE: "Encaissez par carte, et voyez le règlement arriver sur la facture.",
  GOOGLE_DRIVE: "Vos devis et factures sauvegardés dans votre Drive, automatiquement.",
  SLACK: "Votre équipe prévenue quand un devis est accepté ou un paiement reçu.",
  ZAPIER: "Reliez nodaq aux autres outils que vous utilisez déjà.",
};

/**
 * Où trouver chaque identifiant demandé.
 *
 * « Pourquoi ces messages d'erreur ? Il faut connecter quoi ? » Demander une
 * « Secret key » sans dire où elle se trouve, c'est demander à quelqu'un de
 * chercher un objet qu'il n'a jamais vu.
 */
const OU_TROUVER: Record<string, string> = {
  PENNYLANE: "Dans Pennylane : Paramètres → API → Créer une clé.",
  STRIPE: "Dans Stripe : Développeurs → Clés API. Prenez la clé secrète, pas la publique.",
  GOOGLE_DRIVE: "Dans Google Cloud : APIs et services → Identifiants → ID client OAuth.",
  SLACK: "Dans Slack : Paramètres de l'espace → Applications → Webhooks entrants.",
  ZAPIER: "Dans Zapier : créez un Zap déclenché par « Webhooks », puis copiez son adresse.",
};

const STATUS_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  CONNECTE:      { label: 'Connecté',       color: 'text-primary',      icon: CheckCircle2 },
  NON_CONNECTE:  { label: 'Non connecté',   color: 'text-muted-foreground', icon: Link2Off },
  ERREUR:        { label: 'Erreur',          color: 'text-destructive',  icon: AlertCircle },
};

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(d));
}

function useConnectors() {
  return useQuery<ConnectorsResponse>({
    queryKey: ['connecteurs'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/connecteurs`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json();
    },
  });
}

export default function ConnecteursPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useConnectors();
  const connectors = data?.connectors ?? [];

  const [configOpen, setConfigOpen] = useState(false);
  const [selected, setSelected] = useState<Connector | null>(null);

  const disconnectMut = useMutation({
    mutationFn: async (type: string) => {
      const res = await apiFetch(`${API}/connecteurs/${type}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'NON_CONNECTE', config: {} }),
      });
      if (!res.ok) throw new Error('Déconnexion échouée');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connecteurs'] });
      toast({
        title: 'Déconnecté',
        description: "Vos données restent dans nodaq ; c'est l'échange automatique qui s'arrête.",
      });
    },
    onError: (err: Error) =>
      toast({
        title: "La déconnexion n'a pas abouti",
        description: `${err.message} Réessayez dans un instant ; rien n'a été modifié.`,
        variant: 'destructive',
      }),
  });

  const openConfig = (c: Connector) => { setSelected(c); setConfigOpen(true); };

  const connecterBanqueMut = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`${API}/connecteurs/banque/session`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Connexion bancaire impossible');
      }
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      // Redirection PLEINE PAGE, pas une popup : le funnel Bridge Connect
      // est un webview hébergé, l'utilisateur y saisit ses identifiants
      // bancaires — jamais dans un iframe NODAQ.
      window.location.href = url;
    },
    onError: (err: Error) =>
      toast({
        title: "La connexion à votre banque n'a pas pu démarrer",
        description: `${err.message} Si cela persiste, votre banque n'est peut-être pas encore disponible — écrivez-nous, on regarde.`,
        variant: 'destructive',
      }),
  });

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Plateforme"
        title="Connecteurs"
        description="Intégrez vos outils métier pour synchroniser données et workflows."
      />

      <div className="px-5 md:px-8 pt-6 space-y-6">
        {/* Global status bar */}
        <div className="rounded-xl border border-card-border bg-card p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className={`absolute inline-flex h-full w-full rounded-full ${(data?.connected ?? 0) > 0 ? 'animate-pulse bg-primary' : 'bg-muted'}`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${(data?.connected ?? 0) > 0 ? 'bg-primary' : 'bg-muted'}`} />
            </span>
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">{data?.connected ?? 0}</span> connecteur{(data?.connected ?? 0) !== 1 ? 's' : ''} actif{(data?.connected ?? 0) !== 1 ? 's' : ''}
            </span>
          </div>
          {(data?.withError ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 text-destructive font-medium">
              <AlertCircle className="h-4 w-4" />
              {data?.withError} erreur{(data?.withError ?? 0) !== 1 ? 's' : ''} de synchronisation
            </div>
          )}
          <div className="ml-auto text-xs text-muted-foreground">
            {data?.total ?? 0} connecteurs disponibles
          </div>
        </div>

        {/* Connector grid */}
        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
          </div>
        ) : (
          <motion.div variants={containerVariants} initial="hidden" animate="visible"
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {connectors.map(c => {
              const Icon = CONNECTOR_ICONS[c.type] ?? Link2;
              const meta = STATUS_META[c.status] ?? STATUS_META.NON_CONNECTE;
              const StatusIcon = meta.icon;
              const isConnected = c.status === 'CONNECTE';
              return (
                <motion.div key={c.id} variants={itemVariants}
                  className={`rounded-xl border p-5 flex flex-col gap-4 transition-colors ${
                    isConnected ? 'border-primary/25 bg-primary/5' : 'border-card-border bg-card'
                  }`}>
                  <div className="flex items-start justify-between">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                      isConnected ? 'bg-primary text-primary-foreground' : 'bg-sidebar-accent text-sidebar-foreground'
                    }`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    {/* Rien à afficher tant que l'utilisateur n'a rien tenté :
                        une intégration non connectée est un état NORMAL, et
                        l'annoncer sur chaque tuile transforme six choix
                        possibles en six manques. Le bouton « Connecter » dit
                        déjà où on en est. */}
                    {c.status !== 'NON_CONNECTE' && (
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.color}`}>
                        <StatusIcon className="h-3.5 w-3.5" /> {meta.label}
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">{c.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {BENEFICES[c.type] ?? c.description}
                    </div>
                    {isConnected && c.lastSyncAt && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Sync. {fmtDate(c.lastSyncAt)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 mt-auto">
                    {isConnected ? (
                      <Button variant="outline" size="sm" className="flex-1 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => disconnectMut.mutate(c.type)}
                        disabled={disconnectMut.isPending}>
                        <Link2Off className="h-3.5 w-3.5" /> Déconnecter
                      </Button>
                    ) : c.type === 'BANQUE' ? (
                      <Button
                        size="sm"
                        className="flex-1 gap-1"
                        onClick={() => connecterBanqueMut.mutate()}
                        disabled={connecterBanqueMut.isPending}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {connecterBanqueMut.isPending ? 'Redirection...' : 'Connecter'}
                      </Button>
                    ) : (
                      <Button size="sm" className="flex-1 gap-1" onClick={() => openConfig(c)}>
                        <Link2 className="h-3.5 w-3.5" /> Connecter
                      </Button>
                    )}
                    {c.status === 'ERREUR' && (
                      <Button size="sm" variant="outline" onClick={() => openConfig(c)}
                        className="gap-1 border-destructive/30 text-destructive">
                        Reconfigurer
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      <ConnectorConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        connector={selected}
        onSaved={() => qc.invalidateQueries({ queryKey: ['connecteurs'] })}
      />
    </div>
  );
}

function ConnectorConfigDialog({ open, onOpenChange, connector, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  connector: Connector | null; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const configFields = connector ? (CONNECTOR_FIELDS[connector.type] ?? []) : [];

  useEffect(() => {
    if (open && connector) {
      // Never preload server-side values — they are redacted (***).
      // Start every session with empty fields so the user enters real credentials.
      const empty: Record<string, string> = {};
      configFields.forEach(f => { empty[f.key] = ''; });
      setFields(empty);
    }
  }, [open, connector]);

  const handleConnect = async () => {
    if (!connector) return;
    // Require at least the first field to be filled
    const firstField = configFields[0];
    if (firstField && !fields[firstField.key]?.trim()) {
      toast({ title: 'Champ requis', description: `Veuillez renseigner ${firstField.label}`, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`${API}/connecteurs/${connector.type}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CONNECTE', config: fields }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        // Un message d'erreur dit QUOI FAIRE, pas seulement ce qui a raté.
        // « Erreur » tout court laisse l'utilisateur devant un mur.
        toast({
          title: `${connector.label} n'a pas pu être connecté`,
          description:
            (err.error ?? "La clé a été refusée.") +
            " Vérifiez que vous avez copié la clé en entier, sans espace avant ni après.",
          variant: 'destructive',
        });
        return;
      }
      onSaved();
      onOpenChange(false);
      toast({
        title: `${connector.label} connecté`,
        description: BENEFICES[connector.type] ?? 'La synchronisation est activée.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!connector) return null;
  const Icon = CONNECTOR_ICONS[connector.type] ?? Link2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" /> Configurer {connector.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {BENEFICES[connector.type] ?? connector.description}
          </p>
          {/* Où trouver ce qu'on demande. Réclamer une « Secret key » sans dire
              où elle se trouve, c'est demander de chercher un objet qu'on n'a
              jamais vu. */}
          {OU_TROUVER[connector.type] && (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {OU_TROUVER[connector.type]}
            </p>
          )}
          {configFields.map(f => (
            <div key={f.key} className="space-y-1.5">
              <Label>{f.label}</Label>
              <Input
                type={f.type ?? 'text'}
                value={fields[f.key] ?? ''}
                onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
              />
            </div>
          ))}
          {configFields.length === 0 && (
            <p className="text-sm text-muted-foreground italic">Ce connecteur ne nécessite pas de configuration manuelle.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={handleConnect} disabled={saving} className="gap-1">
            <Link2 className="h-3.5 w-3.5" />
            {saving ? 'Connexion...' : 'Connecter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
