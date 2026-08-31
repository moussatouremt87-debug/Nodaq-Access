import { useEffect, useState, type ElementType } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Building2,
  Calculator,
  CheckCircle2,
  Copy,
  CreditCard,
  HardDrive,
  Link2,
  Link2Off,
  Mail,
  MessageSquare,
  Settings2,
  Zap,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getListMembresQueryKey } from '@workspace/api-client-react';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type OAuthConnectorType = 'PENNYLANE' | 'STRIPE' | 'GOOGLE_DRIVE' | 'SLACK';
type AdvancedConnectorType = 'PENNYLANE' | 'ZAPIER';
type RecipeState = 'A_CONNECTER' | 'PRETE' | 'ACTIVE';

type Connector = {
  id: string;
  type: string;
  label: string;
  description?: string | null;
  status: 'NON_CONNECTE' | 'CONNECTE' | 'ERREUR';
  config: Record<string, string | boolean>;
  lastSyncAt?: string | null;
  createdAt: string;
  connectionMode?: 'OAUTH' | 'ADVANCED';
  available?: boolean;
  /**
   * Réservé au jour où le serveur saura confirmer qu'une recette tourne.
   * Une simple autorisation OAuth ne pose jamais cette valeur.
   */
  automationStatus?: 'ACTIVE';
};

type ConnectorsResponse = {
  connectors: Connector[];
  connected: number;
  withError: number;
  total: number;
};

type InvitationResponse = {
  envoye: boolean;
  motifEchec?: string | null;
  lienInvitation?: string | null;
  supplementInvitation: { prixMensuelCents: number } | null;
};

type InvitationResult = {
  delivery: 'SENT' | 'NOT_SENT';
  recipient: string;
  fallbackLink: string | null;
  supplement: { prixMensuelCents: number } | null;
};

type DisconnectResponse = {
  externalActionRequired?: boolean;
  config?: Record<string, string | boolean>;
};

type DisconnectRequest = {
  type: string;
  intent: 'DISCONNECT' | 'RESET' | 'ACKNOWLEDGE';
  externalRevocationId?: string;
  connectionId?: string;
};

const CONNECTOR_ICONS: Record<string, ElementType> = {
  BANQUE: Building2,
  PENNYLANE: Calculator,
  STRIPE: CreditCard,
  GOOGLE_DRIVE: HardDrive,
  SLACK: MessageSquare,
  ZAPIER: Zap,
};

const OAUTH_CONNECTORS = new Set<OAuthConnectorType>([
  'PENNYLANE',
  'STRIPE',
  'GOOGLE_DRIVE',
  'SLACK',
]);

/** Une intention métier d'abord, le nom du logiciel ensuite. */
const RECIPES: Record<string, { title: string; benefit: string }> = {
  PENNYLANE: {
    title: 'Transmettre mes factures au comptable',
    benefit: "Une fois cette recette disponible et activée, Pennylane pourra recevoir vos factures sans pièce jointe manuelle.",
  },
  STRIPE: {
    title: 'Encaisser mes clients par carte',
    benefit: 'Une fois cette recette disponible et activée, Stripe pourra rapprocher le paiement de la facture concernée.',
  },
  GOOGLE_DRIVE: {
    title: 'Sauvegarder mes documents',
    benefit: 'Une fois cette recette disponible et activée, Google Drive pourra garder une copie de vos devis et factures.',
  },
  SLACK: {
    title: 'Prévenir mon équipe',
    benefit: 'Une fois cette recette disponible et activée, Slack pourra prévenir votre équipe lors des événements importants.',
  },
  ZAPIER: {
    title: 'Relier un autre outil',
    benefit: 'Une future recette Zapier pourrait relier un outil qui ne figure pas encore ici.',
  },
};

const BANK_BENEFIT = 'Vos paiements reçus se pointent tout seuls sur vos factures.';

const RECIPE_STATE_META: Record<RecipeState, { label: string; className: string }> = {
  A_CONNECTER: { label: 'À connecter', className: 'bg-muted text-muted-foreground' },
  PRETE: { label: 'Prête', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  ACTIVE: { label: 'Active', className: 'bg-primary/10 text-primary' },
};

const BANK_STATUS_META: Record<Connector['status'], { label: string; color: string; icon: ElementType }> = {
  CONNECTE: { label: 'Connecté', color: 'text-primary', icon: CheckCircle2 },
  NON_CONNECTE: { label: 'Non connecté', color: 'text-muted-foreground', icon: Link2Off },
  ERREUR: { label: 'Erreur', color: 'text-destructive', icon: AlertCircle },
};

const ADVANCED_CONFIGURATION: Record<AdvancedConnectorType, {
  title: string;
  fieldLabel: string;
  placeholder: string;
  help: string;
  bodyKey: 'apiToken' | 'webhookUrl';
}> = {
  PENNYLANE: {
    title: 'Connexion Pennylane avancée',
    fieldLabel: "Jeton d'accès Pennylane",
    placeholder: 'pyl_••••••••',
    help: "Utilisez ce repli seulement si l'équipe Pennylane ou le support nodaq vous a remis un jeton.",
    bodyKey: 'apiToken',
  },
  ZAPIER: {
    title: 'Connexion Zapier avancée',
    fieldLabel: 'Adresse de liaison Zapier',
    placeholder: 'https://hooks.zapier.com/…',
    help: "Dans Zapier, préparez une automatisation avec le déclencheur Webhooks, puis copiez ici l'adresse fournie.",
    bodyKey: 'webhookUrl',
  },
};

function recipeState(connector: Connector): RecipeState {
  if (connector.automationStatus === 'ACTIVE') return 'ACTIVE';
  if (connector.status === 'CONNECTE') return 'PRETE';
  return 'A_CONNECTER';
}

function formatMonthlyPrice(priceCents: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);
}

function useConnectors() {
  return useQuery<ConnectorsResponse>({
    queryKey: ['connecteurs'],
    queryFn: async () => {
      const response = await apiFetch(`${API}/connecteurs`);
      if (!response.ok) throw new Error("Impossible de charger les outils proposés.");
      return response.json();
    },
  });
}

export default function ConnecteursPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useConnectors();
  const connectors = data?.connectors ?? [];
  const bankConnector = connectors.find((connector) => connector.type === 'BANQUE');
  const recipeConnectors = connectors.filter((connector) => connector.type !== 'BANQUE');

  const [advancedType, setAdvancedType] = useState<AdvancedConnectorType | null>(null);
  const [accountantOpen, setAccountantOpen] = useState(false);

  const disconnectMutation = useMutation({
    mutationFn: async ({ type, intent, externalRevocationId, connectionId }: DisconnectRequest) => {
      const response = await apiFetch(`${API}/connecteurs/${type}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'NON_CONNECTE',
          config: {},
          ...(intent === 'ACKNOWLEDGE' ? {
            externalRevocationConfirmed: true,
            externalRevocationId,
          } : (connectionId ? { connectionId } : {})),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'La déconnexion a échoué.');
      }
      return response.json() as Promise<DisconnectResponse>;
    },
    onSuccess: (result, request) => {
      void queryClient.invalidateQueries({ queryKey: ['connecteurs'] });
      if (request.intent === 'ACKNOWLEDGE') {
        const finalizing = result.config?.['connectionInProgress'] === true;
        toast(finalizing
          ? {
              title: 'Retrait enregistré',
              description: 'Nodaq attend la fin de la vérification déjà lancée avant toute nouvelle connexion.',
            }
          : {
              title: 'Retrait confirmé',
              description: "Vous pouvez maintenant reconnecter cet outil à nodaq.",
            });
        return;
      }
      if (request.intent === 'RESET') {
        toast({
          title: 'Connexion réinitialisée',
          description: "La connexion a été remise à zéro dans nodaq. Vérifiez aussi les autorisations dans les réglages du fournisseur.",
        });
        return;
      }
      toast({
        title: 'Outil déconnecté',
        description: result.externalActionRequired
          ? "La connexion a été remise à zéro dans nodaq. Pour couper aussi l'accès chez le fournisseur, ouvrez ses réglages de connexions."
          : "Vos données restent dans nodaq ; l'autorisation externe a aussi été retirée.",
      });
    },
    onError: (error: Error) => {
      void queryClient.invalidateQueries({ queryKey: ['connecteurs'] });
      toast({
        title: 'Résultat de déconnexion non confirmé',
        description: `${error.message} Actualisez la carte et vérifiez le fournisseur avant de recommencer.`,
        variant: 'destructive',
      });
    },
  });

  const authorizeMutation = useMutation({
    mutationFn: async (connector: Connector) => {
      const response = await apiFetch(`${API}/connecteurs/${connector.type}/autorisation`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Cette connexion ne peut pas démarrer pour le moment.');
      }
      return response.json() as Promise<{ url: string }>;
    },
    onSuccess: ({ url }) => {
      // Le fournisseur affiche lui-même son écran de consentement. Nodaq ne
      // demande ni identifiant ni secret de plateforme à l'artisan.
      window.location.href = url;
    },
    onError: (error: Error) => {
      void queryClient.invalidateQueries({ queryKey: ['connecteurs'] });
      toast({
        title: "La connexion n'a pas pu démarrer",
        description: `${error.message} Actualisez l'état de l'outil avant de réessayer.`,
        variant: 'destructive',
      });
    },
  });

  // BANQUE reste sur son funnel hébergé et sa route existante. Cette mutation
  // est volontairement séparée des autorisations des autres outils.
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
      window.location.href = url;
    },
    onError: (err: Error) => toast({
      title: "La connexion à votre banque n'a pas pu démarrer",
      description: `${err.message} Si cela persiste, votre banque n'est peut-être pas encore disponible — écrivez-nous, on regarde.`,
      variant: 'destructive',
    }),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorType = params.get('erreur');
    if (errorType) {
      toast(errorType === 'AUTORISATION_A_RETIRER'
        ? {
            title: "La connexion n'a pas été enregistrée",
            description: "Rien n'a été enregistré dans nodaq. Retirez l'accès depuis les réglages du fournisseur avant de réessayer.",
            variant: 'destructive',
          }
        : {
            title: "La connexion n'a pas abouti",
            description: "Rien n'a été enregistré dans nodaq. Vérifiez les connexions autorisées dans les réglages du fournisseur avant de réessayer.",
            variant: 'destructive',
          });
      // Ne pas conserver un résultat contradictoire si un fournisseur rendait
      // par erreur les deux paramètres dans la même adresse.
      params.delete('erreur');
      params.delete('connexion');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
      return;
    }

    const connectedType = params.get('connexion');
    if (!connectedType || !OAUTH_CONNECTORS.has(connectedType as OAuthConnectorType)) return;
    // Attendre la liste permet d'afficher « Pennylane » plutôt que son code
    // interne sans laisser le paramètre déclencher plusieurs messages.
    if (!data) return;

    const label = connectors.find((connector) => connector.type === connectedType)?.label ?? connectedType;
    toast({
      title: 'Autorisation accordée',
      description: `${label} est connecté. La recette restera « Prête » jusqu'à ce qu'une automatisation réelle soit activée.`,
    });
    params.delete('connexion');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    void queryClient.invalidateQueries({ queryKey: ['connecteurs'] });
  }, [connectors, data, queryClient, toast]);

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Plateforme"
        title="Connecter mes outils"
        description="Choisissez ce que vous voulez simplifier. Nodaq vous conduit ensuite sur l'écran sécurisé de l'outil."
        actions={(
          <Button className="gap-1.5" onClick={() => setAccountantOpen(true)}>
            <Mail className="h-4 w-4" /> Inviter mon comptable
          </Button>
        )}
      />

      <div className="px-5 pt-6 md:px-8 space-y-8">
        <section aria-labelledby="recipes-title" className="space-y-4">
          <div>
            <h2 id="recipes-title" className="text-lg font-semibold text-foreground">
              Que voulez-vous automatiser ?
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Vous autorisez l'accès chez le fournisseur. Aucun mot de passe ni réglage technique ne vous sera demandé par nodaq.
            </p>
          </div>

          <div className="rounded-xl border border-card-border bg-card p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className={`relative inline-flex h-2 w-2 rounded-full ${(data?.connected ?? 0) > 0 ? 'bg-primary' : 'bg-muted'}`} />
              </span>
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{data?.connected ?? 0}</span>{' '}
                outil{(data?.connected ?? 0) !== 1 ? 's' : ''} autorisé{(data?.connected ?? 0) !== 1 ? 's' : ''}
              </span>
            </div>
            {(data?.withError ?? 0) > 0 && (
              <div className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertCircle className="h-4 w-4" />
                {data?.withError} connexion{(data?.withError ?? 0) !== 1 ? 's' : ''} à reprendre
              </div>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              {data?.total ?? 0} outils proposés
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-56" />)}
            </div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
            >
              {recipeConnectors.map((connector) => (
                <RecipeCard
                  key={connector.id}
                  connector={connector}
                  onAuthorize={() => authorizeMutation.mutate(connector)}
                  onAdvanced={(type) => setAdvancedType(type)}
                  onDisconnect={(intent) => disconnectMutation.mutate({
                    type: connector.type,
                    intent,
                    ...(intent === 'ACKNOWLEDGE' && typeof connector.config['externalRevocationId'] === 'string'
                      ? { externalRevocationId: connector.config['externalRevocationId'] }
                      : {}),
                    ...(intent !== 'ACKNOWLEDGE' && typeof connector.config['connectionId'] === 'string'
                      ? { connectionId: connector.config['connectionId'] }
                      : {}),
                  })}
                  authorizing={authorizeMutation.isPending && authorizeMutation.variables?.type === connector.type}
                  disconnecting={disconnectMutation.isPending && disconnectMutation.variables?.type === connector.type}
                />
              ))}
            </motion.div>
          )}
        </section>

        {!isLoading && bankConnector && (
          <section aria-labelledby="bank-title" className="space-y-3">
            <div>
              <h2 id="bank-title" className="text-base font-semibold text-foreground">Banque</h2>
              <p className="mt-1 text-sm text-muted-foreground">La connexion bancaire conserve son parcours sécurisé séparé.</p>
            </div>
            <BankConnectorCard
              connector={bankConnector}
              onConnect={() => connecterBanqueMut.mutate()}
              connecting={connecterBanqueMut.isPending}
            />
          </section>
        )}

        <details className="rounded-xl border border-card-border bg-card p-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground">
            <Settings2 className="h-4 w-4 text-muted-foreground" /> Options avancées
          </summary>
          <div className="mt-3 border-t border-border pt-3">
            <p className="max-w-2xl text-sm text-muted-foreground">
              Ces options sont réservées aux personnes accompagnées par leur fournisseur ou par le support nodaq.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setAdvancedType('PENNYLANE')}>
                Utiliser un jeton Pennylane
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAdvancedType('ZAPIER')}>
                Configurer Zapier
              </Button>
            </div>
          </div>
        </details>
      </div>

      <AdvancedConnectorDialog
        type={advancedType}
        open={advancedType !== null}
        onOpenChange={(open) => { if (!open) setAdvancedType(null); }}
        onSaved={() => { void queryClient.invalidateQueries({ queryKey: ['connecteurs'] }); }}
      />
      <AccountantInvitationDialog open={accountantOpen} onOpenChange={setAccountantOpen} />
    </div>
  );
}

function RecipeCard({
  connector,
  onAuthorize,
  onAdvanced,
  onDisconnect,
  authorizing,
  disconnecting,
}: {
  connector: Connector;
  onAuthorize: () => void;
  onAdvanced: (type: AdvancedConnectorType) => void;
  onDisconnect: (intent: DisconnectRequest['intent']) => void;
  authorizing: boolean;
  disconnecting: boolean;
}) {
  const Icon = CONNECTOR_ICONS[connector.type] ?? Link2;
  const recipe = RECIPES[connector.type] ?? {
    title: connector.label,
    benefit: connector.description ?? 'Gagnez du temps avec cet outil.',
  };
  const state = recipeState(connector);
  const stateMeta = RECIPE_STATE_META[state];
  const isConnected = connector.status === 'CONNECTE';
  // Absence de descripteur = indisponible : un vieux serveur ne doit pas
  // transformer le bouton guidé en 404 après le clic.
  const isAvailable = connector.available === true;
  const isOAuth = connector.connectionMode === 'OAUTH'
    && OAUTH_CONNECTORS.has(connector.type as OAuthConnectorType);
  const connectionInProgress = connector.config['connectionInProgress'] === true;
  const connectionAttemptCancelable = connector.config['connectionAttemptCancelable'] === true;
  const externalActionRequired = connector.config['externalActionRequired'] === true;
  // Une autorisation conservée (ou un état ERREUR) fait refuser une nouvelle
  // ouverture par l'API. Elle doit d'abord être remise à zéro.
  const requiresReset = !externalActionRequired && (connector.status === 'ERREUR'
    || (!isConnected && typeof connector.config['authMode'] === 'string'));

  return (
    <motion.article
      variants={itemVariants}
      data-testid={`recette-${connector.type}`}
      className={`rounded-xl border p-5 flex flex-col gap-4 transition-colors ${
        isConnected ? 'border-primary/25 bg-primary/5' : 'border-card-border bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          isConnected ? 'bg-primary text-primary-foreground' : 'bg-sidebar-accent text-sidebar-foreground'
        }`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${stateMeta.className}`}>
          {stateMeta.label}
        </span>
      </div>

      <div className="space-y-1">
        <h3 className="font-semibold text-foreground">{recipe.title}</h3>
        <p className="text-sm text-muted-foreground">{recipe.benefit}</p>
        <p className="text-xs font-medium text-foreground">Avec {connector.label}</p>
      </div>

      {connector.status === 'ERREUR' && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          La connexion doit être reprise. Réinitialisez-la avant de recommencer et vérifiez les autorisations chez le fournisseur.
        </p>
      )}
      {externalActionRequired && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Une autorisation peut encore être active chez le fournisseur. Retirez-la dans ses réglages, puis confirmez ici.
        </p>
      )}
      {connectionInProgress && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Connexion en cours de vérification. Attendez son résultat avant de recommencer.
        </p>
      )}
      {!isAvailable && !isConnected && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Bientôt disponible</span> — nodaq termine cette connexion sécurisée.
        </p>
      )}
      {state === 'PRETE' && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          Autorisation seulement — aucun échange automatique actif
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        {connectionInProgress ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1"
            disabled={!connectionAttemptCancelable || disconnecting}
            onClick={() => onDisconnect('RESET')}
          >
            <Link2Off className="h-3.5 w-3.5" /> {connectionAttemptCancelable ? 'Annuler la vérification' : 'Finalisation en cours…'}
          </Button>
        ) : externalActionRequired ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1 border-amber-500/40 text-amber-800 hover:bg-amber-500/10 dark:text-amber-300"
            aria-label={`Confirmer le retrait de ${connector.label}`}
            onClick={() => onDisconnect('ACKNOWLEDGE')}
            disabled={disconnecting}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {disconnecting ? 'Confirmation…' : "J'ai retiré l'accès"}
          </Button>
        ) : isConnected ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => onDisconnect('DISCONNECT')}
            disabled={disconnecting}
          >
            <Link2Off className="h-3.5 w-3.5" /> {disconnecting ? 'Déconnexion…' : 'Déconnecter'}
          </Button>
        ) : requiresReset ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
            aria-label={`Réinitialiser ${connector.label}`}
            onClick={() => onDisconnect('RESET')}
            disabled={disconnecting}
          >
            <Link2Off className="h-3.5 w-3.5" /> {disconnecting ? 'Réinitialisation…' : 'Réinitialiser'}
          </Button>
        ) : isOAuth ? (
          <Button
            size="sm"
            className="flex-1 gap-1"
            aria-label={`Se connecter à ${connector.label}`}
            onClick={onAuthorize}
            disabled={!isAvailable || authorizing}
          >
            <Link2 className="h-3.5 w-3.5" /> {authorizing ? 'Ouverture…' : 'Se connecter'}
          </Button>
        ) : connector.type === 'ZAPIER' ? (
          <Button
            size="sm"
            className="flex-1 gap-1"
            aria-label="Ouvrir les options avancées Zapier"
            onClick={() => onAdvanced('ZAPIER')}
          >
            <Settings2 className="h-3.5 w-3.5" /> Préparer avec Zapier
          </Button>
        ) : null}
      </div>
    </motion.article>
  );
}

function BankConnectorCard({
  connector,
  onConnect,
  connecting,
}: {
  connector: Connector;
  onConnect: () => void;
  connecting: boolean;
}) {
  const meta = BANK_STATUS_META[connector.status];
  const StatusIcon = meta.icon;
  const isConnected = connector.status === 'CONNECTE';
  const actionLabel = connector.status === 'CONNECTE'
    ? 'Gérer la connexion bancaire'
    : connector.status === 'ERREUR'
      ? 'Reprendre la connexion bancaire'
      : 'Connecter';

  return (
    <div data-testid="connexion-BANQUE" className={`max-w-md rounded-xl border p-5 flex flex-col gap-4 ${
      isConnected ? 'border-primary/25 bg-primary/5' : 'border-card-border bg-card'
    }`}>
      <div className="flex items-start justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${
          isConnected ? 'bg-primary text-primary-foreground' : 'bg-sidebar-accent text-sidebar-foreground'
        }`}>
          <Building2 className="h-5 w-5" />
        </div>
        {connector.status !== 'NON_CONNECTE' && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.color}`}>
            <StatusIcon className="h-3.5 w-3.5" /> {meta.label}
          </span>
        )}
      </div>
      <div>
        <div className="font-semibold text-foreground">{connector.label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{BANK_BENEFIT}</div>
      </div>
      {connector.status === 'CONNECTE' && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          Les modifications et la suppression de cet accès se font dans le parcours sécurisé du partenaire bancaire.
        </p>
      )}
      {connector.status === 'ERREUR' && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Reprenez la connexion dans le parcours sécurisé du partenaire bancaire. Nodaq ne prétend pas couper cet accès ici.
        </p>
      )}
      <Button size="sm" className="gap-1" onClick={onConnect} disabled={connecting} aria-label={actionLabel}>
        <Link2 className="h-3.5 w-3.5" /> {connecting ? 'Redirection...' : actionLabel}
      </Button>
    </div>
  );
}

function AdvancedConnectorDialog({
  type,
  open,
  onOpenChange,
  onSaved,
}: {
  type: AdvancedConnectorType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setValue('');
  }, [open, type]);

  if (!type) return null;
  const configuration = ADVANCED_CONFIGURATION[type];
  const inputId = `advanced-${type.toLowerCase()}`;

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast({
        title: 'Information manquante',
        description: `Renseignez ${configuration.fieldLabel.toLocaleLowerCase('fr-FR')}.`,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const response = await apiFetch(`${API}/connecteurs/${type}/avance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [configuration.bodyKey]: trimmed }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "L'information fournie a été refusée.");
      }
      onSaved();
      onOpenChange(false);
      toast({
        title: 'Connexion enregistrée',
        description: "L'outil est autorisé. La recette apparaît comme « Prête », pas comme active.",
      });
    } catch (error) {
      onSaved();
      toast({
        title: 'Résultat de connexion non confirmé',
        description: `${error instanceof Error ? error.message : "L'état exact n'a pas pu être lu."} Vérifiez la carte avant toute nouvelle tentative.`,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{configuration.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {configuration.help}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>{configuration.fieldLabel}</Label>
            <Input
              id={inputId}
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={configuration.placeholder}
              autoComplete="off"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button onClick={() => { void save(); }} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer cette connexion'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvitationSupplementNotice({
  supplement,
}: {
  supplement: { prixMensuelCents: number } | null;
}) {
  if (!supplement) return null;
  return (
    <div className="mt-3 rounded-md border border-amber-500/40 bg-background/70 p-3">
      <p className="text-sm font-semibold text-foreground">
        {formatMonthlyPrice(supplement.prixMensuelCents)} € HT/mois si l'invitation est acceptée
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        La création ou l'envoi du lien ne signifie pas que ce supplément est déjà accepté.
      </p>
    </div>
  );
}

function AccountantInvitationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<InvitationResult | null>(null);

  useEffect(() => {
    if (open && !result) setEmail('');
  }, [open, result]);

  const invite = async () => {
    const recipient = email.trim();
    if (!recipient) return;
    setSaving(true);
    try {
      const response = await apiFetch(`${API}/membres/inviter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recipient, role: 'ACCOUNTANT' }),
      });
      const body = await response.json().catch(() => ({})) as InvitationResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "L'invitation n'a pas pu être créée.");

      void queryClient.invalidateQueries({ queryKey: getListMembresQueryKey() });
      const supplement = body.supplementInvitation ?? null;
      if (body.envoye) {
        setEmail('');
        if (supplement) {
          setResult({
            delivery: 'SENT',
            recipient,
            fallbackLink: null,
            supplement,
          });
        } else {
          setResult(null);
          onOpenChange(false);
        }
        toast({
          title: 'Invitation envoyée',
          description: supplement
            ? `Un e-mail a été envoyé à ${recipient}. Le coût éventuel reste affiché avant de fermer.`
            : `Un e-mail a été envoyé à ${recipient}.`,
        });
        return;
      }

      setResult({
        delivery: 'NOT_SENT',
        recipient,
        fallbackLink: body.lienInvitation ?? null,
        supplement,
      });
      toast({
        title: "L'invitation est créée, mais l'e-mail n'est pas parti",
        description: body.motifEchec
          ? `${body.motifEchec} — transmettez le lien affiché à votre comptable.`
          : 'Transmettez le lien affiché à votre comptable.',
        variant: 'destructive',
      });
    } catch (error) {
      void queryClient.invalidateQueries({ queryKey: getListMembresQueryKey() });
      toast({
        title: "Résultat de l'invitation non confirmé",
        description: `${error instanceof Error ? error.message : "L'état exact n'a pas pu être lu."} Vérifiez la liste des membres avant tout nouvel envoi.`,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    setResult(null);
    setEmail('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Inviter mon comptable
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Votre comptable recevra un accès financier à votre espace. Il pourra ensuite vous accompagner dans les réglages.
          </p>

          {!result ? (
            <div className="space-y-1.5">
              <Label htmlFor="accountant-email">Adresse e-mail du comptable</Label>
              <Input
                id="accountant-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="cabinet@exemple.fr"
                autoComplete="email"
              />
            </div>
          ) : result.delivery === 'SENT' ? (
            <div
              className="rounded-lg border border-primary/30 bg-primary/5 p-3"
              data-testid="invitation-sent"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-foreground">
                Invitation envoyée à {result.recipient}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Le lien d'accès a été envoyé par e-mail. Gardez ce coût en tête avant que votre comptable ne l'accepte.
              </p>
              <InvitationSupplementNotice supplement={result.supplement} />
            </div>
          ) : (
            <div
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
              data-testid="invitation-fallback"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                L'e-mail n'est pas parti — transmettez ce lien vous-même
              </p>
              {result.fallbackLink ? (
                <>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Ce lien n'est affiché qu'une fois et expire dans 7 jours.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Input
                      readOnly
                      value={result.fallbackLink}
                      className="flex-1 font-mono text-xs"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="gap-1.5"
                      onClick={() => {
                        if (result.fallbackLink) void navigator.clipboard?.writeText(result.fallbackLink);
                        toast({ title: 'Lien copié' });
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copier le lien
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Aucun lien de secours n'a été rendu. Contactez le support avant de recommencer.
                </p>
              )}
              <InvitationSupplementNotice supplement={result.supplement} />
            </div>
          )}
        </div>
        <DialogFooter>
          {result ? (
            <Button onClick={finish}>Terminé</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
              <Button onClick={() => { void invite(); }} disabled={!email.trim() || saving}>
                {saving ? 'Création…' : "Envoyer l'invitation"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
