/**
 * Les liens de paiement émis, dans le cockpit — ticket 4.19, lot E.
 *
 * La carte ne s'affiche QUE s'il existe au moins un lien : un artisan qui
 * n'utilise pas la relance vocale n'a pas à voir un bloc vide qui lui demande
 * ce qu'il a raté.
 *
 * Le statut porte la couleur, pas la décoration : réglé en vert, émis en
 * neutre, échec et expiration en avertissement. Et « Renvoyer » n'apparaît que
 * sur un lien encore actif — le serveur refuse les autres de toute façon,
 * l'écran se contente de ne pas proposer un geste voué au 409.
 */
import { RefreshCw, Check, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { fmtEUR, fmtRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useLiensPaiement,
  useRenvoyerLienPaiement,
  type LienPaiement,
  type StatutLienPaiement,
} from '@/hooks/use-liens-paiement';

const ALLURE: Record<
  StatutLienPaiement,
  { libelle: string; classe: string; Icone: typeof Check }
> = {
  PAYE: { libelle: 'Réglé', classe: 'text-emerald-600 dark:text-emerald-400', Icone: Check },
  EMIS: { libelle: 'En attente', classe: 'text-muted-foreground', Icone: Clock },
  EXPIRE: { libelle: 'Expiré', classe: 'text-amber-600 dark:text-amber-400', Icone: AlertTriangle },
  REVOQUE: { libelle: 'Annulé', classe: 'text-muted-foreground', Icone: AlertTriangle },
  ECHEC: { libelle: 'Non émis', classe: 'text-amber-600 dark:text-amber-400', Icone: AlertTriangle },
};

function Ligne({ lien }: { lien: LienPaiement }) {
  const { toast } = useToast();
  const renvoyer = useRenvoyerLienPaiement();
  const allure = ALLURE[lien.statut];
  const Icone = allure.Icone;
  const renvoyable = lien.statut === 'EMIS' && lien.url !== null;

  return (
    <li className="flex items-center gap-3 px-5 py-3 border-b border-border last:border-0">
      <Icone className={cn('h-4 w-4 shrink-0', allure.classe)} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground truncate">
          {fmtEUR(lien.montantCents)}
          {lien.factureId ? <span className="text-muted-foreground"> — {lien.factureId}</span> : null}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {allure.libelle}
          {' · '}
          {/* « envoyé » serait faux sur un ÉCHEC : la création du lien a été
              refusée, donc aucun SMS n'est jamais parti. */}
          {lien.statut === 'PAYE' && lien.payeLe
            ? `réglé ${fmtRelative(lien.payeLe)}`
            : lien.statut === 'ECHEC'
              ? `tenté ${fmtRelative(lien.createdAt)}`
              : `envoyé ${fmtRelative(lien.createdAt)}`}
        </div>
      </div>
      {renvoyable ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs gap-1 shrink-0"
          disabled={renvoyer.isPending}
          onClick={() =>
            renvoyer.mutate(lien.id, {
              onSuccess: () => toast({ title: 'SMS renvoyé' }),
              onError: (e: Error) =>
                toast({ title: 'Renvoi impossible', description: e.message, variant: 'destructive' }),
            })
          }
          data-testid={`button-renvoyer-${lien.id}`}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Renvoyer
        </Button>
      ) : null}
    </li>
  );
}

export function LiensPaiement() {
  const { data: liens, isLoading } = useLiensPaiement();

  // Ni squelette ni bloc vide : tant qu'on ne sait pas, ou qu'il n'y a rien,
  // la carte n'existe pas. Elle apparaît le jour où un lien est émis.
  if (isLoading || !liens || liens.length === 0) return null;

  const enAttente = liens.filter((l) => l.statut === 'EMIS').length;

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <span className="text-sm font-medium">Liens de paiement</span>
        {enAttente > 0 ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {enAttente} en attente
          </span>
        ) : null}
      </div>
      <ul>
        {liens.slice(0, 8).map((lien) => (
          <Ligne key={lien.id} lien={lien} />
        ))}
      </ul>
    </div>
  );
}
