/**
 * Réglages → Abonnement — la formule, les compteurs, et les changements.
 *
 * Vocabulaire artisan (garde `vocabulaire.test.ts`) : on parle de FORMULE,
 * d'appels et d'utilisateurs — jamais de jargon financier. Les prix affichés
 * viennent tous du serveur (table `plans`) : cet écran n'en connaît aucun.
 *
 * Règles rendues visibles plutôt qu'implicites :
 *  - passer à plus grand : effet immédiat ; revenir à plus petit : à la fin
 *    de la période en cours, et l'écran l'annonce avant le clic ;
 *  - quitter Fondateurs exige une confirmation — le tarif garanti à vie et
 *    la place ne se retrouvent pas ;
 *  - activer le module vocal, c'est accepter son tarif : il est écrit sur le
 *    bouton même ;
 *  - au-delà des appels inclus, rien ne se coupe — le dépassement est compté
 *    et affiché.
 */
import { useState } from 'react';
import { BadgeCheck, PhoneCall, Users, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  useAbonnement, useChangerFormule, useBasculerModuleVocal, euros,
  type EtatAbonnement, type PlanTarif,
} from '@/hooks/use-abonnement';

const RANG: Record<string, number> = { solo: 1, equipe: 2, fondateurs: 2 };

function LibelleStatut({ etat }: { etat: EtatAbonnement }) {
  if (etat.statut === 'TRIAL') {
    const fin = etat.subscription.trialEndsAt
      ? new Date(etat.subscription.trialEndsAt).toLocaleDateString('fr-FR')
      : null;
    return (
      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
        Essai gratuit{fin ? ` — jusqu'au ${fin}` : ''}
      </span>
    );
  }
  if (etat.statut === 'EN_ATTENTE') {
    /*
     * Ni « essai terminé » ni rouge d'alerte : cette personne vient de
     * s'inscrire et n'a rien raté. L'état est neutre et le ton l'est aussi —
     * le rouge dirait qu'elle a fait une faute.
     */
    return (
      <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        Abonnement à activer — vos données sont conservées
      </span>
    );
  }
  if (etat.statut === 'READONLY') {
    return (
      <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
        Essai terminé — espace en lecture seule, données conservées
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600">
      Abonnement actif
    </span>
  );
}

function CarteFormule({
  plan, etat, onChoisir, enCours,
}: {
  plan: PlanTarif;
  etat: EtatAbonnement;
  onChoisir: (planId: string) => void;
  enCours: boolean;
}) {
  const courante = etat.statut === 'ACTIVE' && etat.plan.id === plan.id;
  const retour =
    etat.statut === 'ACTIVE' && (RANG[plan.id] ?? 0) < (RANG[etat.plan.id] ?? 0);
  const fondateursFermee = plan.id === 'fondateurs' && !etat.fondateurs.ouverte && !courante;

  const traits: string[] = [];
  if (plan.id === 'solo') {
    traits.push('1 utilisateur — le dirigeant', 'Devis, factures, chantiers, cockpit complet',
      'Relances par e-mail illimitées, WhatsApp en usage normal',
      'Une demi-heure de main-d’œuvre facturée par mois');
  } else {
    traits.push(
      `Jusqu'à ${plan.utilisateursInclus} utilisateurs inclus`,
      plan.prixUtilisateurSuppCents !== null
        ? `puis ${euros(plan.prixUtilisateurSuppCents)} € HT/mois par utilisateur en plus`
        : '',
      'Marge par chantier — aussi pour qui travaille seul',
      'Heures et plannings, accès dédié pour votre comptable',
    );
  }
  if (plan.id === 'fondateurs') {
    traits.unshift('Tout Équipe, prix de base garanti à vie');
    traits.push(`Réservée aux ${etat.fondateurs.totales} premiers — ${Math.max(0, etat.fondateurs.totales - etat.fondateurs.prises)} places restantes`);
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border p-5',
        courante ? 'border-primary bg-primary/5' : 'border-card-border bg-card',
        plan.id === 'fondateurs' && !fondateursFermee && 'ring-1 ring-primary/40',
      )}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">{plan.libelle}</h4>
        {courante && <BadgeCheck className="h-4 w-4 text-primary" />}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">
        {euros(plan.prixMensuelCents)}&nbsp;€ <span className="text-sm font-normal text-muted-foreground">HT/mois</span>
      </div>
      {plan.prixAnnuelCents !== null && (
        <div className="text-xs text-muted-foreground">
          ou {euros(plan.prixAnnuelCents)} € HT/an — deux mois offerts
        </div>
      )}
      <ul className="mt-3 flex-1 space-y-1.5 text-xs text-muted-foreground">
        {traits.filter(Boolean).map((t) => <li key={t}>• {t}</li>)}
      </ul>
      <Button
        variant={courante ? 'outline' : 'default'}
        size="sm"
        className="mt-4"
        disabled={courante || fondateursFermee || enCours}
        onClick={() => onChoisir(plan.id)}
      >
        {courante
          ? 'Votre formule'
          : fondateursFermee
            ? 'Offre complète'
            : etat.statut === 'ACTIVE'
              ? retour ? 'Revenir à cette formule à la fin de la période' : `Passer à ${plan.libelle}`
              : `Choisir ${plan.libelle}`}
      </Button>
    </div>
  );
}

export function AbonnementTab() {
  const { toast } = useToast();
  const { data: etat, isLoading } = useAbonnement();
  const changer = useChangerFormule();
  const basculerModule = useBasculerModuleVocal();
  const [confirmationFondateurs, setConfirmationFondateurs] = useState<string | null>(null);

  if (isLoading || !etat) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  }

  const choisir = (planId: string, confirme = false) => {
    changer.mutate(
      { planId, ...(confirme ? { confirmeAbandonFondateurs: true } : {}) },
      {
        onSuccess: (nouvel) => {
          setConfirmationFondateurs(null);
          toast({
            title:
              nouvel.subscription.planSuivant
                ? `Retour programmé pour la fin de la période`
                : 'Formule enregistrée',
          });
        },
        onError: (e: Error & { confirmationRequise?: string }) => {
          if (e.confirmationRequise === 'confirmeAbandonFondateurs') {
            setConfirmationFondateurs(planId);
            return;
          }
          toast({ title: 'Changement refusé', description: e.message, variant: 'destructive' });
        },
      },
    );
  };

  const dossiers = etat.dossiers;
  const alerte = dossiers && dossiers.inclus > 0 && dossiers.utilises * 100 >= 80 * dossiers.inclus;
  const module = etat.plans.find((p) => p.id === 'module_vocal');

  return (
    <div className="max-w-4xl space-y-6">
      {/* Demande de carte — à partir du jour 10 de l'essai, jamais avant
          (4.43 §5). Un message de continuité, pas une menace : le formulaire
          de carte arrivera avec l'encaissement (ticket Stripe séparé). */}
      {etat.essai?.demanderCarte && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground">
          Votre essai se termine dans {etat.essai.joursRestants} jour{etat.essai.joursRestants > 1 ? 's' : ''}.
          Ajoutez votre carte pour que vos relances en cours continuent de tourner — et si vous ne
          faites rien, votre espace passera simplement en lecture seule, sans aucune perte de données.
        </div>
      )}

      {/* Formule courante */}
      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">
            Formule {etat.plan.libelle} — {euros(etat.plan.prixMensuelCents)} € HT/mois
          </h3>
          <LibelleStatut etat={etat} />
          {etat.subscription.priceLockedAt && (
            <span className="text-xs text-muted-foreground">
              Tarif garanti à vie depuis le {new Date(etat.subscription.priceLockedAt).toLocaleDateString('fr-FR')}
            </span>
          )}
        </div>
        {etat.subscription.planSuivant && etat.subscription.echeance && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Retour vers {etat.plans.find((p) => p.id === etat.subscription.planSuivant)?.libelle ?? etat.subscription.planSuivant} le{' '}
            {new Date(etat.subscription.echeance).toLocaleDateString('fr-FR')} — rien ne change d'ici là.
          </p>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          {etat.utilisateurs.actifs} utilisateur{etat.utilisateurs.actifs > 1 ? 's' : ''} sur{' '}
          {etat.utilisateurs.inclus} inclus
          {etat.utilisateurs.supplementaires > 0 && etat.utilisateurs.prixSupplementaireCents !== null && (
            <> — {etat.utilisateurs.supplementaires} en plus, facturé{etat.utilisateurs.supplementaires > 1 ? 's' : ''}{' '}
            {euros(etat.utilisateurs.prixSupplementaireCents)} € HT/mois chacun</>
          )}
        </p>
      </div>

      {/* Module Relance vocale */}
      {module && (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PhoneCall className="h-4 w-4 text-muted-foreground" />
              Module Relance vocale — {euros(module.prixMensuelCents)} € HT/mois
            </h3>
            <Button
              size="sm"
              variant={etat.subscription.moduleVocal ? 'outline' : 'default'}
              disabled={basculerModule.isPending}
              onClick={() =>
                basculerModule.mutate(!etat.subscription.moduleVocal, {
                  onSuccess: () => toast({ title: etat.subscription.moduleVocal ? 'Module désactivé' : 'Module activé' }),
                  onError: (e: Error) =>
                    toast({ title: 'Changement refusé', description: e.message, variant: 'destructive' }),
                })
              }
            >
              {etat.subscription.moduleVocal
                ? 'Désactiver le module'
                : `Activer — ${euros(module.prixMensuelCents)} € HT/mois, ${module.dossiersInclus} dossiers inclus`}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {module.dossiersInclus} dossiers de relance inclus par mois, puis{' '}
            {euros(module.prixDossierSuppCents ?? 0)} € HT par dossier. Un dossier, c'est un impayé
            relancé dans le mois — trois rappels sur la même facture ne comptent qu'une fois.
            Jamais de coupure en cours de mois : au-delà, les dossiers sont comptés, pas bloqués.
            Activer le module vaut acceptation de ce tarif.
          </p>
          {etat.subscription.moduleVocal && dossiers && (
            <div className="mt-3">
              <div className={cn('text-sm font-medium', alerte ? 'text-amber-600' : 'text-foreground')}>
                {dossiers.utilises}/{dossiers.inclus} dossiers ce mois-ci
                {dossiers.depassement > 0 && (
                  <> — {dossiers.depassement} en dépassement ({euros(dossiers.depassement * dossiers.prixDepassementCents)} € HT)</>
                )}
              </div>
              <div className="mt-1.5 h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', alerte ? 'bg-amber-500' : 'bg-primary')}
                  style={{ width: `${Math.min(100, (dossiers.utilises / Math.max(1, dossiers.inclus)) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Les formules */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Changer de formule</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {etat.plans
            .filter((p) => p.id !== 'module_vocal')
            .filter((p) => p.id !== 'fondateurs' || etat.fondateurs.ouverte || etat.plan.id === 'fondateurs')
            .map((p) => (
              <CarteFormule key={p.id} plan={p} etat={etat} onChoisir={choisir} enCours={changer.isPending} />
            ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Passer à une formule plus grande prend effet tout de suite. Revenir à une formule plus
          petite prend effet à la fin de la période en cours — rien ne se coupe en cours de mois.
          L'essai de 14 jours donne toutes les fonctionnalités, aux limites d'Équipe, sans carte
          bancaire ; à son terme, l'espace passe en lecture seule et aucune donnée n'est supprimée.
        </p>
      </div>

      {/* Confirmation : quitter Fondateurs */}
      <AlertDialog
        open={confirmationFondateurs !== null}
        onOpenChange={(v) => !v && setConfirmationFondateurs(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitter l'offre Fondateurs ?</AlertDialogTitle>
            <AlertDialogDescription>
              Votre tarif Fondateurs est garanti à vie tant que vous le gardez. Le quitter est
              définitif : l'offre est réservée aux {etat.fondateurs.totales} premiers inscrits,
              votre place ne vous sera pas réservée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Garder Fondateurs</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmationFondateurs && choisir(confirmationFondateurs, true)}
            >
              Quitter et changer de formule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
