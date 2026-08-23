import { useState, useEffect } from 'react';
import { ObjectifsParametres } from '@/components/objectifs-parametres';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Bell, Puzzle, PhoneCall, Save, UserCog, Mail, Trash2, Clock, ShieldCheck } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useListMembres,
  useInviterMembre,
  useChangerRoleMembre,
  useRevoquerMembre,
  useProgrammerEcheanceMembre,
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
import { toDateString } from '@/lib/format';
import { useVertical } from '@/hooks/use-vertical';
import { cn } from '@/lib/utils';

import { apiFetch } from '@/lib/auth';
import { useModules, useBasculerModule, type ModuleResolu } from '@/hooks/use-modules';
import { useRegleRelance, useEnregistrerRegleRelance } from '@/hooks/use-regles-relance';
import {
  BORNES_REGLE_RELANCE,
  formaterIban,
  normaliserIban,
  verifierIban,
  messageRefusIban,
  type RegleRelance,
} from '@nodaq/shared';
const API = '/api';

type Settings = Record<string, string>;

const TABS = [
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'modules',       label: 'Modules',       icon: Puzzle },
  { id: 'relance',       label: 'Règles de relance', icon: PhoneCall },
  { id: 'membres',       label: 'Membres & accès', icon: UserCog },
];

type RoleInvitable = 'OWNER' | 'MEMBER' | 'ACCOUNTANT' | 'VIEWER';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Propriétaire',
  MEMBER: 'Membre',
  ACCOUNTANT: 'Comptable',
  VIEWER: 'Tiers — lecture seule',
};

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

/**
 * L'IBAN qui encaisse — liens de paiement (4.19) ET QR de facture (4.21).
 *
 * ── Pourquoi il a quitté la bascule qui le contenait ──────────────────────
 * Il vivait sous « Autoriser l'envoi d'un lien de paiement », dans les
 * réglages de relance téléphonique : invisible tant que cette bascule était
 * éteinte. Depuis le ticket 4.21, le même IBAN imprime aussi le QR de virement
 * sur chaque facture — un artisan qui ne fait aucune relance par téléphone n'a
 * alors AUCUN endroit où le saisir, et le QR n'apparaît jamais sans que
 * personne sache pourquoi.
 *
 * La validation de la clé de contrôle appartient à la route — cet écran se
 * contente d'afficher son refus, et de formater la saisie par groupes de 4
 * pour qu'une relecture à l'œil soit possible.
 */
function IbanEncaissement() {
  const { data } = useSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [saisie, setSaisie] = useState<string | null>(null);
  const enregistre = data?.['company.iban'] ?? '';
  const valeur = saisie ?? (enregistre ? formaterIban(enregistre) : '');

  const enregistrer = useMutation({
    mutationFn: async (iban: string) => {
      const res = await apiFetch(`${API}/parametres`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'company.iban': iban }),
      });
      const corps = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((corps as { error?: string }).error ?? 'Enregistrement refusé');
      return corps;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parametres'] });
      setSaisie(null);
      toast({ title: 'IBAN enregistré' });
    },
    onError: (e: Error) => toast({ title: 'IBAN refusé', description: e.message, variant: 'destructive' }),
  });

  const refus = valeur.trim() === '' ? null : verifierIban(valeur);

  return (
    <div className="space-y-1.5 border-l-2 border-card-border ml-1 pl-4">
      <Label htmlFor="relance-iban" className="text-xs">IBAN d'encaissement</Label>
      <div className="flex gap-2">
        <Input
          id="relance-iban"
          value={valeur}
          placeholder="FR76 3000 1007 9412 3456 7890 185"
          onChange={e => setSaisie(formaterIban(e.target.value))}
          className="h-9 font-mono text-xs max-w-md"
        />
        <Button
          variant="outline"
          className="h-9"
          disabled={refus !== null || saisie === null || enregistrer.isPending}
          onClick={() => enregistrer.mutate(normaliserIban(valeur))}
        >
          Enregistrer
        </Button>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {refus
          ? messageRefusIban(refus)
          : "Le compte qui recevra les virements. C'est le vôtre : l'argent ne transite jamais par nous. Il sert aussi à imprimer le QR de paiement sur vos factures."}
      </div>
    </div>
  );
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
      {/* `role="switch"` + `aria-checked` + nom accessible : l'interrupteur
          n'était qu'un `<button>` contenant une pastille. Un lecteur d'écran
          annonçait « bouton », sans dire de quel réglage il s'agissait ni s'il
          était activé — donc un réglage impossible à lire comme à modifier
          (US-A8.2, WCAG 4.1.2). Le libellé affiché sert de nom : il est déjà
          exact, il n'y a pas de raison d'en écrire un second. */}
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
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

function EcheanceEditable({
  membreId,
  expiresAt,
  onErreur,
}: {
  membreId: string;
  expiresAt: string | null;
  onErreur: (message: string) => void;
}) {
  const qc = useQueryClient();
  const programmer = useProgrammerEcheanceMembre({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListMembresQueryKey() }),
      onError: (err: Error) => onErreur(err.message),
    },
  });

  // Un `input[type=date]` veut « AAAA-MM-JJ » en composantes LOCALES : passer
  // par `toISOString()` décalerait d'un jour le soir en France.
  const valeur = expiresAt ? toDateString(new Date(expiresAt)) : '';
  const expire = expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();

  return (
    <div className="flex items-center gap-1 shrink-0">
      <Input
        type="date"
        value={valeur}
        min={toDateString(new Date(Date.now() + 86_400_000))}
        disabled={programmer.isPending}
        className={`h-8 w-36 text-xs ${expire ? 'border-destructive text-destructive' : ''}`}
        title={expire ? 'Accès expiré' : "Fin d'accès programmée"}
        onChange={e => {
          const v = e.target.value;
          programmer.mutate({
            id: membreId,
            // Fin de JOURNÉE : « jusqu'au 31 » doit inclure le 31.
            data: { expiresAt: v ? new Date(`${v}T23:59:59`).toISOString() : null },
          });
        }}
      />
    </div>
  );
}

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
  const [role, setRole] = useState<RoleInvitable>('MEMBER');
  const [libelle, setLibelle] = useState('');
  // US-A5.4 — obligatoire pour un tiers de confiance, refusée pour les
  // autres rôles (le serveur rejette les deux écarts).
  const [accesExpireAt, setAccesExpireAt] = useState('');
  /**
   * Le lien de la dernière invitation créée, quand l'e-mail n'est PAS parti.
   *
   * Il n'est disponible qu'une fois : la base ne conserve que le condensat
   * SHA-256 du jeton. On le garde donc à l'écran tant que la personne ne l'a
   * pas copié, au lieu de le laisser filer dans un toast qui s'efface.
   */
  const [lienDeSecours, setLienDeSecours] = useState<string | null>(null);

  const inviter = useInviterMembre({
    mutation: {
      onSuccess: (reponse) => {
        qc.invalidateQueries({ queryKey: getListMembresQueryKey() });
        const destinataire = email.trim();
        setEmail('');
        setLibelle('');
        setAccesExpireAt('');

        // Le défaut d'origine : ce message s'affichait TOUJOURS, sans regarder
        // si le courrier était parti. Aucun SMTP n'étant configuré sur ce
        // déploiement, l'invitation était annoncée « envoyée » et le comptable
        // attendait un e-mail qui ne partirait jamais.
        if (reponse?.envoye) {
          setLienDeSecours(null);
          toast({ title: 'Invitation envoyée', description: `Un e-mail a été envoyé à ${destinataire}.` });
          return;
        }
        setLienDeSecours(reponse?.lienInvitation ?? null);
        toast({
          title: "L'invitation est créée, mais l'e-mail n'est pas parti",
          description: reponse?.motifEchec
            ? `${reponse.motifEchec} — copiez le lien ci-dessous et transmettez-le vous-même.`
            : "Copiez le lien ci-dessous et transmettez-le vous-même.",
          variant: 'destructive',
        });
      },
      onError: (err: Error) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
    },
  });

  const estTiers = role === 'VIEWER';
  // Une date seule (`YYYY-MM-DD`) désigne minuit : l'accès se fermerait au
  // début du jour choisi, pas à sa fin. On vise la fin de journée, qui est ce
  // que « jusqu'au 31 » veut dire pour la personne qui le saisit.
  const echeanceIso = accesExpireAt ? new Date(`${accesExpireAt}T23:59:59`).toISOString() : null;

  const handleInvite = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    if (estTiers && !echeanceIso) return;
    inviter.mutate({
      data: {
        email: trimmed,
        role,
        ...(libelle.trim() ? { libelle: libelle.trim() } : {}),
        ...(echeanceIso ? { accesExpireAt: echeanceIso } : {}),
      },
    });
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
          <Select value={role} onValueChange={v => setRole(v as RoleInvitable)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MEMBER">Membre</SelectItem>
              <SelectItem value="ACCOUNTANT">Comptable — accès financier</SelectItem>
              <SelectItem value="OWNER">Copropriétaire — même autorité que vous</SelectItem>
              <SelectItem value="VIEWER">Tiers de confiance — lecture seule, daté</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:self-end">
          <Button
            onClick={handleInvite}
            disabled={!email.trim() || inviter.isPending || (estTiers && !accesExpireAt)}
            className="w-full sm:w-auto gap-1.5"
          >
            <Mail className="h-3.5 w-3.5" />
            {inviter.isPending ? 'Envoi...' : 'Inviter'}
          </Button>
        </div>
      </div>
      {/* Le lien de secours. Visible tant qu'il n'a pas servi : il n'existe
          qu'une fois, la base ne gardant que son condensat. */}
      {lienDeSecours && (
        <div
          className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
          data-testid="lien-invitation-secours"
        >
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            L'e-mail n'est pas parti — transmettez ce lien vous-même
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Il n'est affiché qu'une fois, et il expire dans 7 jours.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={lienDeSecours} className="flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="secondary"
              className="gap-1.5"
              onClick={() => {
                void navigator.clipboard?.writeText(lienDeSecours);
                toast({ title: 'Lien copié' });
              }}
            >
              Copier
            </Button>
            <Button type="button" variant="ghost" onClick={() => setLienDeSecours(null)}>
              Terminé
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col sm:flex-row gap-3">
        <div className="space-y-1.5 sm:max-w-xs flex-1">
          <Label htmlFor="invite-libelle">Fonction (facultatif)</Label>
          <Input
            id="invite-libelle"
            value={libelle}
            onChange={e => setLibelle(e.target.value)}
            placeholder="ex. Conjoint collaborateur, Associé fondateur"
          />
        </div>
        {/* US-A7.3 — proposé pour TOUS les rôles : une fin de contrat
            saisonnier se connaît d'avance et se programme dès l'invitation.
            Obligatoire pour le seul tiers de confiance (US-A5.4) ; ailleurs le
            libellé dit « facultatif », pour ne pas donner l'impression d'une
            étape de plus (AC1). */}
        <div className="space-y-1.5 sm:w-56">
          <Label htmlFor="invite-echeance">
            Accès jusqu'au{estTiers ? '' : ' (facultatif)'}
          </Label>
          <Input
              id="invite-echeance"
              type="date"
              value={accesExpireAt}
              /* `toDateString` (composantes LOCALES), pas `toISOString()` :
                 « demain » est un jour du calendrier de l'utilisateur. Passé
                 minuit en France, l'heure UTC est encore la veille — le
                 plancher aurait autorisé une date déjà refusée par le
                 serveur. Une garde de la suite attrape ce cas. */
              min={toDateString(new Date(Date.now() + 86_400_000))}
              onChange={e => setAccesExpireAt(e.target.value)}
            />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Un membre voit les {words.plural}, devis et contrats sans les montants. Un comptable voit également les données financières (factures, marge, échéancier fiscal). Un copropriétaire a l'accès complet, à égalité — jamais de hiérarchie entre propriétaires.
      </p>
      {estTiers && (
        <p className="text-xs text-muted-foreground mt-2">
          Un tiers de confiance — votre banquier pour un dossier de prêt, par exemple —
          consulte le dossier financier et rien d'autre : cockpit, compte de résultat,
          factures, marge, rapports, échéancier, prévisionnel. Il ne peut rien modifier,
          et son accès se ferme tout seul à la date choisie.
        </p>
      )}
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
                  {/* Le dernier propriétaire ne se voit proposer ni révocation
                      ni programmation : le serveur refuse les deux, et offrir
                      un contrôle qui échouera n'aide personne. Même condition
                      que le bouton de révocation, déjà en place. */}
                  {nbOwners > 1 && (
                    <EcheanceEditable
                      membreId={m.id}
                      expiresAt={m.expiresAt ?? null}
                      onErreur={msg => toast({ title: "Échéance refusée", description: msg, variant: 'destructive' })}
                    />
                  )}
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
              ) : m.role === 'VIEWER' ? (
                /* US-A5.4 — pas de liste déroulante de rôle : le serveur
                   refuse de transformer un tiers en membre, et proposer le
                   geste ici ne ferait qu'offrir une erreur. Reste
                   l'essentiel : jusqu'à quand court l'accès, et de quoi le
                   fermer tout de suite. */
                <>
                  <EcheanceEditable
                    membreId={m.id}
                    expiresAt={m.expiresAt ?? null}
                    onErreur={msg => toast({ title: "Échéance refusée", description: msg, variant: 'destructive' })}
                  />
                  <RoleBadge role={m.role} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive"
                    onClick={() => setToRevoke(m)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  {/* US-A7.3 — LE cas de cette story : un saisonnier dont la
                      fin de contrat est connue d'avance. */}
                  <EcheanceEditable
                    membreId={m.id}
                    expiresAt={m.expiresAt ?? null}
                    onErreur={msg => toast({ title: "Échéance refusée", description: msg, variant: 'destructive' })}
                  />
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

/**
 * Attestation de souveraineté (US-A7.4) — téléchargement en un geste.
 *
 * Pourquoi un `fetch` + blob et non un `window.open` comme l'export du compte
 * de résultat : cette route REFUSE d'émettre quand la configuration ne
 * correspond plus à ce que le registre déclare, et le message de refus est
 * l'essentiel du dispositif. Ouvert dans un onglet, il s'afficherait en JSON
 * brut — la seule fois où l'utilisateur a vraiment besoin de comprendre.
 */
function SouveraineteCard() {
  const { toast } = useToast();
  const [enCours, setEnCours] = useState(false);

  const telecharger = async () => {
    setEnCours(true);
    try {
      const res = await apiFetch(`${API}/souverainete/attestation`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: "Attestation non produite",
          description: (err as { error?: string }).error ?? 'Téléchargement impossible.',
          variant: 'destructive',
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'attestation-souverainete.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Souveraineté des données
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Le document à joindre à une réponse de marché public comportant une clause de
        souveraineté : où sont hébergées vos données, quels sous-traitants interviennent, et
        ce qui a été vérifié au moment de l'émission. Généré à la demande, daté du jour.
      </p>
      <Button variant="outline" onClick={telecharger} disabled={enCours} className="gap-1.5">
        <ShieldCheck className="h-4 w-4" />
        {enCours ? 'Génération…' : "Télécharger l'attestation"}
      </Button>
    </div>
  );
}

/**
 * Modules du compte (registre 3.11) — la liste vient du SERVEUR, résolue pour
 * le secteur du tenant.
 *
 * Cet onglet remplace trois bascules `modules.classeur` / `modules.marge` /
 * `modules.rapport` qui étaient écrites en base et lues par personne, sous une
 * phrase qui promettait le contraire. Ici, éteindre un module retire sa page
 * du menu et ses outils de l'agent — et l'écran le DIT, plutôt que de laisser
 * croire à un masquage de données qui n'a jamais existé.
 */
function ModulesTab() {
  const { toast } = useToast();
  const { data: modules, isLoading } = useModules();
  const basculer = useBasculerModule();

  const onChange = (m: ModuleResolu, actif: boolean) => {
    basculer.mutate(
      { [m.id]: actif },
      {
        onSuccess: () =>
          toast({ title: actif ? `${m.title} activé` : `${m.title} désactivé` }),
        onError: (e: Error) =>
          toast({ title: 'Erreur', description: e.message, variant: 'destructive' }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Un module désactivé disparaît de la navigation et ses outils sont retirés de
        l'assistant. Aucune donnée n'est supprimée : le réactiver rétablit tout à
        l'identique.
      </p>
      {(modules ?? []).map(m => (
        <div
          key={m.id}
          className="rounded-xl border border-card-border bg-card p-4 flex items-start gap-4"
          data-testid={`module-${m.id}`}
        >
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground text-sm">{m.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{m.description}</div>
            {/* La SOURCE de l'état, comme l'impose la doctrine du registre :
                un module ne doit jamais paraître allumé ou éteint sans qu'on
                puisse dire pourquoi. */}
            <div className="text-[11px] text-muted-foreground/70 mt-1.5">
              {m.source === 'choix'
                ? 'Choix enregistré pour ce compte'
                : m.source === 'hors_socle'
                  ? 'Désactivé par défaut — activable à tout moment'
                  : 'Activé par défaut pour votre secteur'}
            </div>
          </div>
          <button
            role="switch"
            aria-checked={m.active}
            aria-label={m.title}
            disabled={basculer.isPending}
            onClick={() => onChange(m, !m.active)}
            className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 mt-0.5',
              m.active ? 'bg-primary' : 'bg-muted',
            )}
          >
            <span className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
              m.active ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Règles de relance (ticket 4.18, US-9) — ce que l'agent vocal a le droit
 * d'accorder pendant un appel, décidé UNE FOIS et à froid.
 *
 * L'écran dit deux choses que le dirigeant doit savoir avant de cliquer :
 * la règle est VERSIONNÉE (une campagne déjà validée garde la version sous
 * laquelle elle l'a été), et le résumé rendu par le serveur décrit exactement
 * ce que l'agent pourra concéder — une seule formulation, partagée avec le
 * futur panneau de validation de campagne.
 */
function RelanceTab() {
  const { toast } = useToast();
  const { data: courante, isLoading } = useRegleRelance();
  const enregistrer = useEnregistrerRegleRelance();
  const [brouillon, setBrouillon] = useState<RegleRelance | null>(null);

  useEffect(() => {
    if (courante && brouillon === null) {
      const { version, poseeParEmail, poseeLe, resume, ...regle } = courante;
      setBrouillon(regle);
    }
  }, [courante, brouillon]);

  if (isLoading || !brouillon || !courante) {
    return (
      <div className="max-w-2xl space-y-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  const maj = <K extends keyof RegleRelance>(champ: K, valeur: RegleRelance[K]) =>
    setBrouillon(prec => (prec ? { ...prec, [champ]: valeur } : prec));

  const nombre = (
    champ: 'maxVersements' | 'delaiMaxPremierVersementJours' | 'retardMaxJours',
    label: string,
    aide: string,
    desactive = false,
  ) => {
    const bornes = BORNES_REGLE_RELANCE[champ];
    return (
      <div className={cn('space-y-1.5', desactive && 'opacity-45')}>
        <Label htmlFor={`relance-${champ}`} className="text-xs">{label}</Label>
        <Input
          id={`relance-${champ}`}
          type="number"
          min={bornes.min}
          max={bornes.max}
          disabled={desactive}
          value={brouillon[champ]}
          onChange={e => maj(champ, Number(e.target.value))}
          className="h-9 w-28"
        />
        <div className="text-[11px] text-muted-foreground">{aide}</div>
      </div>
    );
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="text-sm text-foreground">{courante.resume}</div>
        <div className="text-[11px] text-muted-foreground mt-2">
          {courante.version === 0
            ? "Aucune règle enregistrée : ce sont les valeurs prudentes par défaut."
            : `Version ${courante.version}${courante.poseeParEmail ? ` — enregistrée par ${courante.poseeParEmail}` : ''}. Les campagnes déjà validées gardent la version sous laquelle elles l'ont été.`}
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-5 space-y-5">
        <Toggle
          checked={brouillon.echelonnementAutorise}
          onChange={v => maj('echelonnementAutorise', v)}
          label="Autoriser un échelonnement"
          description="L'agent peut proposer de lui-même un paiement en plusieurs fois, dans les limites ci-dessous."
        />
        <div className="grid grid-cols-2 gap-4">
          {nombre('maxVersements', 'Versements maximum', 'Au moins 2 pour un échelonnement.', !brouillon.echelonnementAutorise)}
          {nombre('delaiMaxPremierVersementJours', 'Premier versement sous', 'En jours.', !brouillon.echelonnementAutorise)}
        </div>

        {nombre('retardMaxJours', 'Retard maximal accepté', "En jours après l'échéance de la facture. S'applique toujours.")}

        <Toggle
          checked={brouillon.lienPaiementAutorise}
          onChange={v => maj('lienPaiementAutorise', v)}
          label="Autoriser l'envoi d'un lien de paiement"
          description="Par SMS, pendant l'appel, si cela débloque la conversation."
        />
        {/* Plus de second champ ici : l'IBAN se règle en haut de cette page,
            parce qu'il sert aussi aux factures. Deux champs liés à la même
            clé se contrediraient à l'écran au premier enregistrement. */}
        {brouillon.lienPaiementAutorise && (
          <p className="ml-1 border-l-2 border-card-border pl-4 text-[11px] text-muted-foreground">
            L'IBAN d'encaissement se règle en haut de cette page.
          </p>
        )}
        <Toggle
          checked={brouillon.remiseAutorisee}
          onChange={v => maj('remiseAutorisee', v)}
          label="Autoriser une remise"
          description="Désactivé par défaut. L'agent ne peut jamais accorder de remise tant que ce réglage est fermé."
        />
      </div>

      <Button
        onClick={() =>
          enregistrer.mutate(brouillon, {
            onSuccess: r => toast({ title: `Règle enregistrée (version ${r.version})` }),
            onError: (e: Error) =>
              toast({ title: 'Règle refusée', description: e.message, variant: 'destructive' }),
          })
        }
        disabled={enregistrer.isPending}
        className="gap-1.5"
      >
        <Save className="h-4 w-4" />
        {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer une nouvelle version'}
      </Button>
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

  // Populate form from server
  useEffect(() => {
    if (data) {
      setNotifFact(data['notif.nouvelleFact'] !== 'false');
      setNotifAction(data['notif.actionAvalider'] !== 'false');
      setNotifProspect(data['notif.prospectQualifie'] === 'true');
      setNotifEcheance(data['notif.echeanceFiscale'] !== 'false');
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

        {/* IBAN — hors onglets depuis le ticket 4.21 : il conditionne à la
            fois les liens de paiement et le QR imprimé sur chaque facture.
            Rangé dans un onglet, il redeviendrait introuvable pour qui ne
            cherche pas ce qu'il ne sait pas exister. */}
        <div className="mb-6 max-w-2xl rounded-xl border border-card-border p-4">
          <div className="mb-2 text-sm font-medium text-foreground">
            Comment vos clients vous paient
          </div>
          <IbanEncaissement />
        </div>

        {/* Souveraineté — hors onglets pour la même raison que le seuil de
            rentabilité : c'est une action ponctuelle, cherchée le jour où un
            donneur d'ordre la réclame, pas un réglage qu'on visite. */}
        <div className="mb-6 max-w-2xl">
          <SouveraineteCard />
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

            {activeTab === 'modules' && <ModulesTab />}

            {activeTab === 'relance' && <RelanceTab />}

            {activeTab === 'membres' && <MembresTab />}
          </motion.div>
        )}
      </div>
    </div>
  );
}
