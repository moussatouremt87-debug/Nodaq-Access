/**
 * « Ce que nodaq a fait ce mois-ci » — le panneau de valeur.
 *
 * Il existe pour le moment où l'artisan pense « je paie quand même 29 € par
 * mois ». La réponse doit être sous ses yeux, chiffrée, et VRAIE.
 *
 * ── CE QUE CE PANNEAU NE FAIT PAS ───────────────────────────────────────────
 *
 * Il ne s'attribue rien. « nodaq vous a récupéré 4 850 € » serait une
 * revendication de cause : une facture relancée puis payée l'aurait peut-être
 * été de toute façon, et rien en base ne permet de trancher. On écrit donc
 * « Factures relancées, puis encaissées » — un fait, vérifiable ligne à ligne.
 *
 * Il n'affiche aucun temps gagné. « 7 h 42 économisées » ne se dérive d'aucune
 * table ; il faudrait poser « une relance = X minutes », c'est-à-dire
 * l'inventer. Un chiffre fabriqué posé à côté de montants réels les contamine
 * tous — le jour où l'artisan attrape l'exagération, il cesse de croire le
 * reste.
 *
 * ── ET IL NE SE MONTRE PAS À VIDE ───────────────────────────────────────────
 *
 * Un mois sans rien à dire n'affiche pas six zéros. Une colonne de zéros n'est
 * pas neutre : elle donne l'impression d'un produit qui ne sert à rien, juste
 * avant l'échéance de l'abonnement.
 */
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Send, CheckCheck, Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/auth';
import { fmtEUR } from '@/lib/format';

const API = '/api';

type Valeur = {
  periode: { debut: string; fin: string };
  relanceesPuisEncaissees: { nombre: number; montantCents: number };
  encaissementsAVenirCents: number;
  impayes: { nombre: number; montantCents: number };
  documentsEnvoyes: number;
  actionsValidees: number;
  abonnementCents: number;
};

function Ligne({
  Icone, libelle, valeur, precision,
}: {
  Icone: typeof TrendingUp;
  libelle: string;
  valeur: string;
  precision?: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <Icone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium tabular-nums">{valeur}</p>
        <p className="text-xs text-muted-foreground">
          {libelle}
          {precision ? <span className="block">{precision}</span> : null}
        </p>
      </div>
    </li>
  );
}

export function ValeurProduite() {
  const { data, isLoading, error } = useQuery<Valeur>({
    queryKey: ['cockpit-valeur'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/cockpit/valeur`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<Valeur>;
    },
    retry: false,
  });

  // 403 pour un salarié : le panneau n'existe pas pour lui, il ne s'affiche
  // pas en erreur. Un message d'échec laisserait croire à une panne.
  if (error) return null;
  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;

  /*
   * La FORME est vérifiée, pas seulement la présence.
   *
   * `data!` suffisait tant que la réponse arrivait complète. L'audit
   * d'accessibilité rend le Cockpit avec des requêtes simulées : `data` était
   * défini mais vide, et le panneau plantait sur `.nombre` — emportant tout
   * l'écran, pas seulement lui.
   *
   * Un bloc secondaire ne doit JAMAIS pouvoir casser la page qui l'héberge.
   * Quand il ne comprend pas ce qu'on lui donne, il se retire.
   */
  const v = data as Valeur | undefined;
  if (!v?.relanceesPuisEncaissees || !v.impayes) return null;
  const rienADire =
    v.relanceesPuisEncaissees.nombre === 0
    && v.documentsEnvoyes === 0
    && v.actionsValidees === 0
    && v.encaissementsAVenirCents === 0;
  if (rienADire) return null;

  return (
    <section className="rounded-lg border p-4" aria-labelledby="valeur-titre">
      <h2 id="valeur-titre" className="text-sm font-semibold">
        Ce que nodaq a fait ce mois-ci
      </h2>

      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {v.relanceesPuisEncaissees.nombre > 0 && (
          <Ligne
            Icone={TrendingUp}
            valeur={fmtEUR(v.relanceesPuisEncaissees.montantCents / 100)}
            libelle="Factures relancées, puis encaissées"
            precision={`${v.relanceesPuisEncaissees.nombre} facture${v.relanceesPuisEncaissees.nombre > 1 ? 's' : ''}`}
          />
        )}
        {v.encaissementsAVenirCents > 0 && (
          <Ligne
            Icone={Clock}
            valeur={fmtEUR(v.encaissementsAVenirCents / 100)}
            libelle="Facturé, pas encore échu"
          />
        )}
        {v.documentsEnvoyes > 0 && (
          <Ligne
            Icone={Send}
            valeur={String(v.documentsEnvoyes)}
            libelle="Devis, factures et avoirs envoyés"
          />
        )}
        {v.actionsValidees > 0 && (
          <Ligne
            Icone={CheckCheck}
            valeur={String(v.actionsValidees)}
            libelle="Propositions validées en un clic"
          />
        )}
      </ul>

      {v.impayes.nombre > 0 && (
        /*
         * Les impayés figurent ici SANS couleur d'alarme. Ce panneau parle de
         * ce que le produit a fait ; le retard est un fait de gestion, pas un
         * reproche. L'écran Factures porte déjà l'urgence quand il y en a une.
         */
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          {v.impayes.nombre} facture{v.impayes.nombre > 1 ? 's' : ''} en retard,
          {' '}{fmtEUR(v.impayes.montantCents / 100)} à recouvrer.
        </p>
      )}

      {v.abonnementCents > 0 && (
        /*
         * Le coût est affiché SANS calcul de rapport. « 12 fois votre
         * abonnement » serait une mise en scène, et elle se retournerait le
         * mois où le rapport est mauvais. Les deux nombres côte à côte
         * suffisent : l'artisan fait sa propre division, et il la croit.
         */
        <p className="mt-2 text-xs text-muted-foreground">
          Votre abonnement ce mois-ci : {fmtEUR(v.abonnementCents / 100)} HT.
        </p>
      )}
    </section>
  );
}
