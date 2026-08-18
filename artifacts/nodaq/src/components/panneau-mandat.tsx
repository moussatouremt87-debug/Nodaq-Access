/**
 * Panneau « Ce que l'agent peut accorder » — ticket 4.18, US-1.
 *
 * S'affiche sous la liste d'appels, dans l'écran de validation du cockpit. Il
 * clôt l'US-1 : le dirigeant voit, au moment même où il approuve, la liste des
 * appels ET la marge de manœuvre qu'il donne à l'agent.
 *
 * ── Il ne propose que ce que la règle autorise ───────────────────────────
 * Les commandes fermées par la règle du tenant s'affichent DÉSACTIVÉES, avec
 * la raison, plutôt que masquées. C'est ce que demande l'US-3 branche 3 : dire
 * au dirigeant que sa règle l'interdit, et où la changer — jamais depuis
 * l'appel. Masquer laisserait croire que la fonction n'existe pas.
 *
 * Le serveur applique de toute façon l'invariant : cet écran ne peut pas
 * élargir un mandat, même en essayant. Ce qu'il fait ici, c'est éviter de
 * proposer un geste qui serait ramené en silence.
 */
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { fmtEUR } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useCampagnePourAction,
  useResserrerMandat,
  useExclureAppel,
} from '@/hooks/use-campagne-relance';
import type { RegleRelance } from '@nodaq/shared';

export function PanneauMandat({ pendingActionId }: { pendingActionId: string }) {
  const { toast } = useToast();
  const { data, isLoading, isError } = useCampagnePourAction(pendingActionId, true);
  const resserrer = useResserrerMandat(pendingActionId);
  const exclure = useExclureAppel(pendingActionId);

  if (isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement du mandat…
      </div>
    );
  }
  if (isError || !data) return null;

  const { campagne, regle } = data;
  const gele = campagne.statut !== 'PROPOSEE';

  const basculer = (champ: keyof RegleRelance, valeur: boolean) =>
    resserrer.mutate(
      { campagneId: campagne.id, mandat: { ...campagne.mandat, [champ]: valeur } },
      {
        onError: (e: Error) =>
          toast({ title: 'Mandat inchangé', description: e.message, variant: 'destructive' }),
      },
    );

  /** Une concession : cochable seulement si la règle du tenant l'autorise. */
  const concession = (
    champ: 'echelonnementAutorise' | 'lienPaiementAutorise' | 'remiseAutorisee',
    libelle: string,
  ) => {
    const ouvertParLaRegle = regle[champ];
    const actif = campagne.mandat[champ];
    return (
      <label
        key={champ}
        className={cn(
          'flex items-start gap-2 text-xs',
          !ouvertParLaRegle && 'opacity-55',
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5"
          checked={actif}
          disabled={!ouvertParLaRegle || gele || resserrer.isPending}
          onChange={(e) => basculer(champ, e.target.checked)}
          data-testid={`mandat-${champ}`}
        />
        <span>
          {libelle}
          {!ouvertParLaRegle && (
            <span className="block text-[11px] text-muted-foreground">
              Fermé par vos règles de relance. Ouvrez-le dans Paramètres si vous le souhaitez.
            </span>
          )}
        </span>
      </label>
    );
  };

  return (
    <div className="mt-2 rounded-lg border border-card-border bg-background/40 p-3 space-y-3">
      {/* La liste — on valide des appels vers des personnes nommées. */}
      <div className="space-y-1">
        {campagne.appels.map((appel) => (
          <div
            key={appel.factureId}
            className="flex items-center gap-2 text-xs"
            data-testid={`appel-${appel.factureId}`}
          >
            <span className="flex-1 min-w-0 truncate text-foreground">{appel.clientNom}</span>
            <span className="font-mono-nums tabular-nums text-muted-foreground">
              {fmtEUR(appel.montantCents)}
            </span>
            {!gele && (
              <button
                aria-label={`Retirer ${appel.clientNom} de la campagne`}
                className="text-muted-foreground hover:text-destructive shrink-0"
                disabled={exclure.isPending}
                onClick={() =>
                  exclure.mutate(
                    { campagneId: campagne.id, factureId: appel.factureId },
                    {
                      onError: (e: Error) =>
                        toast({ title: 'Erreur', description: e.message, variant: 'destructive' }),
                    },
                  )
                }
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-card-border pt-2.5 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Ce que l'agent peut accorder
        </div>

        {concession('echelonnementAutorise', 'Proposer un échelonnement')}
        {concession('lienPaiementAutorise', 'Envoyer un lien de paiement pendant l’appel')}
        {concession('remiseAutorisee', 'Accorder une remise')}

        <div className="text-[11px] text-muted-foreground">
          Règlement accepté jusqu'à {campagne.mandat.retardMaxJours} jours après l'échéance.
          {data.restreintLaRegle && (
            <span className="block text-foreground/80">
              Cette campagne est plus stricte que vos règles habituelles.
            </span>
          )}
        </div>

        {gele && (
          <div className="text-[11px] text-muted-foreground">
            Mandat figé à la validation
            {campagne.regleVersion ? ` (règles version ${campagne.regleVersion})` : ''}. Le
            modifier demande une nouvelle campagne.
          </div>
        )}
      </div>
    </div>
  );
}

/** Le bouton d'accès rapide aux règles, pour ne pas chercher dans Paramètres. */
export function LienReglesRelance() {
  return (
    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" asChild>
      <a href="/parametres">Modifier mes règles de relance</a>
    </Button>
  );
}
