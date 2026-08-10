/**
 * Bloc « objectifs » du cockpit.
 *
 * Le REGISTRE vient du serveur (`ton`), il n'est pas déduit ici : deux écrans
 * qui déduiraient chacun leur ton finiraient par se contredire sur le même
 * écart.
 *
 * Le ton « loin » ne reçoit ni couleur d'encouragement, ni emoji, ni
 * félicitation. Un artisan qui n'y est pas n'a pas besoin qu'on l'applaudisse.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Target, Settings2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/auth';
import { fmtEUR } from '@/lib/format';

const API = '/api';

type Ton = 'atteint' | 'a_portee' | 'loin';

type Objectif = {
  id: 'exercice_precedent' | 'seuil_rentabilite';
  configurable?: boolean;
  ton?: Ton;
  titre?: string;
  message?: string;
  action?: string | null;
  ecartCents?: number;
  seuilCents?: number;
  caExerciceCents?: number;
  avanceSurMemePeriodeCents?: number;
};

type Reponse = { exercice?: number; objectifs: Objectif[] };

/** Aucun vert pour « loin » : la couleur ne doit pas rassurer à tort. */
const CADRE: Record<Ton, string> = {
  atteint: 'border-primary/25 bg-primary/5',
  a_portee: 'border-card-border bg-card',
  loin: 'border-card-border bg-card',
};

export function ObjectifsCockpit() {
  const { data, isLoading } = useQuery<Reponse>({
    queryKey: ['cockpit-objectifs'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/cockpit/objectifs`);
      if (!r.ok) throw new Error('Chargement impossible');
      return r.json();
    },
  });

  if (isLoading) return <Skeleton className="h-28 w-full" />;

  // Corps vide : soit le bloc est désactivé, soit le rôle n'y a pas droit.
  // Dans les deux cas, on n'affiche rien du tout.
  const objectifs = data?.objectifs ?? [];
  if (objectifs.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Target className="h-3.5 w-3.5" /> Vos objectifs {data?.exercice ?? ''}
      </div>

      {objectifs.map((o) => {
        if (o.configurable) {
          return (
            <div key={o.id} className="rounded-xl border border-card-border bg-card p-4">
              <div className="mb-1 text-sm font-medium">Seuil de rentabilité</div>
              <p className="mb-3 text-sm text-muted-foreground">
                Nous ne le calculons pas à votre place : il dépend de vos charges fixes et de
                votre marge, que vous seul connaissez.
              </p>
              <Link href="/parametres">
                <Button variant="outline" size="sm">
                  <Settings2 className="mr-2 h-3.5 w-3.5" /> Le renseigner
                </Button>
              </Link>
            </div>
          );
        }

        const ton = o.ton ?? 'loin';
        return (
          <div key={o.id} className={`rounded-xl border p-4 ${CADRE[ton]}`}>
            <div className="mb-1 text-sm font-medium">{o.titre}</div>
            <p className="text-sm text-muted-foreground">{o.message}</p>

            {o.id === 'exercice_precedent' && o.avanceSurMemePeriodeCents !== undefined && (
              <p className="mt-2 text-xs text-muted-foreground">
                À la même date l'an dernier :{' '}
                {o.avanceSurMemePeriodeCents >= 0 ? 'en avance de ' : 'en retard de '}
                {fmtEUR(Math.abs(o.avanceSurMemePeriodeCents))}
              </p>
            )}

            {o.action && (
              <Link href="/prospects">
                <Button variant="outline" size="sm" className="mt-3">
                  {o.action}
                </Button>
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
