/**
 * Confirmation hebdomadaire des heures — pensé pour le téléphone.
 *
 * Le vendredi, l'artisan ne saisit pas : il relit une proposition pré-remplie
 * depuis le planning, ajuste ce qui a bougé, et valide. Une ligne par affaire,
 * un total, un bouton.
 *
 * Le détail par jour existe mais reste replié : sur un écran de téléphone, la
 * question utile est « combien de jours sur ce chantier cette semaine », pas
 * « combien d'heures mardi ».
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useVertical } from '@/hooks/use-vertical';
import { apiFetch } from '@/lib/auth';
import { toDateString } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

// Rattachement EXCLUSIF (US-A4.1) : une ligne pointe soit sur une affaire,
// soit directement sur un client, jamais les deux — même contrainte que
// côté moteur (migration 032).
type Ligne = {
  membreId: string;
  membreNom: string;
  affaireId: string | null;
  affaireLabel: string | null;
  clientId: string | null;
  clientLabel: string | null;
  date: string;
  heures: number;
  origine: 'pointe' | 'propose';
};

type Recap = {
  semaine: { debut: string; fin: string };
  lignes: Ligne[];
  parAffaire: Array<{ affaireId: string; affaireLabel: string; heures: number }>;
  parClient: Array<{ clientId: string; clientLabel: string; heures: number }>;
  totalHeures: number;
};

/** Clé de rattachement — préfixée pour qu'une affaire et un client de même
 *  id (hasard) ne collisionnent jamais. Même construction que côté moteur. */
const cleRattachement = (l: Pick<Ligne, 'affaireId' | 'clientId'>) =>
  l.affaireId ? `affaire:${l.affaireId}` : `client:${l.clientId}`;

/** Clé stable d'une ligne : membre + rattachement + jour, comme en base. */
const cleLigne = (l: Pick<Ligne, 'membreId' | 'affaireId' | 'clientId' | 'date'>) =>
  `${l.membreId}|${cleRattachement(l)}|${l.date}`;

const fmtJour = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
};

export default function Pointages() {
  const { toast } = useToast();
  const { words } = useVertical();
  const feminin = words.indefinite.startsWith('une ');
  const queryClient = useQueryClient();
  const [semaineRef, setSemaineRef] = useState<string | null>(null);
  /** Heures ajustées par l'utilisateur, par clé de ligne. */
  const [ajustements, setAjustements] = useState<Record<string, number>>({});
  const [deplie, setDeplie] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError } = useQuery<Recap>({
    queryKey: ['pointages-recap', semaineRef],
    queryFn: async () => {
      const url = semaineRef
        ? `${API}/pointages/recapitulatif-semaine?date=${semaineRef}`
        : `${API}/pointages/recapitulatif-semaine`;
      const r = await apiFetch(url);
      if (!r.ok) throw new Error('Chargement impossible');
      return r.json();
    },
  });

  // Repartir de la proposition dès qu'on change de semaine : garder les
  // ajustements d'une autre semaine écrirait des heures sur les mauvais jours.
  useEffect(() => {
    setAjustements({});
  }, [data?.semaine.debut]);

  const heuresDe = (l: Ligne): number => ajustements[cleLigne(l)] ?? l.heures;

  // Un groupe par rattachement — affaire OU client, jamais les deux — sur le
  // même principe que le regroupement `parAffaire`/`parClient` du serveur.
  const groupes = useMemo(() => {
    const acc = new Map<string, { label: string; heures: number; lignes: Ligne[] }>();
    for (const l of data?.lignes ?? []) {
      const cle = cleRattachement(l);
      const cur = acc.get(cle) ?? { label: (l.affaireLabel ?? l.clientLabel)!, heures: 0, lignes: [] };
      cur.heures += heuresDe(l);
      cur.lignes.push(l);
      acc.set(cle, cur);
    }
    return [...acc.entries()].map(([cle, v]) => ({ cle, ...v }));
  }, [data, ajustements]);

  const total = groupes.reduce((acc, g) => acc + g.heures, 0);

  const confirmer = useMutation({
    mutationFn: async () => {
      const lignes = (data?.lignes ?? []).map((l) => ({
        membreId: l.membreId,
        ...(l.affaireId ? { affaireId: l.affaireId } : { clientId: l.clientId }),
        date: l.date,
        heures: heuresDe(l),
      }));
      const r = await apiFetch(`${API}/pointages/recapitulatif-semaine/confirmer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: data!.semaine.debut, lignes }),
      });
      if (!r.ok) {
        const corps = await r.json().catch(() => ({}));
        throw new Error(corps.error ?? 'Enregistrement impossible');
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Semaine confirmée', description: `${total} h enregistrées.` });
      setAjustements({});
      void queryClient.invalidateQueries({ queryKey: ['pointages-recap'] });
    },
    onError: (e: Error) => {
      toast({ title: 'Échec', description: e.message, variant: 'destructive' });
    },
  });

  const decalerSemaine = (jours: number) => {
    // Le repli passe par toDateString (composantes locales) : dériver le jour
    // d'un toISOString ferait reculer la semaine d'un cran près de minuit.
    const depart = data?.semaine.debut ?? toDateString(new Date());
    const base = new Date(`${depart}T12:00:00`);
    base.setDate(base.getDate() + jours);
    setSemaineRef(toDateString(base));
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-5 flex items-center gap-2">
        <CalendarCheck className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Heures de la semaine</h1>
      </div>

      {/* ── Navigation de semaine, au doigt (ticket 4.20) ───────────────────
          Deux boutons de 32 px encadraient la période sur une seule ligne : à
          390 px, « Semaine précédente » mangeait la moitié de la largeur et la
          date passait à l'étroit. Sur téléphone, les flèches deviennent des
          cibles carrées de 44 px et la période s'affiche entre les deux ; au
          bureau, les libellés reviennent, il y a la place. */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button
          variant="outline"
          onClick={() => decalerSemaine(-7)}
          aria-label="Semaine précédente"
          className="h-11 w-11 shrink-0 p-0 sm:h-8 sm:w-auto sm:px-3"
        >
          <ChevronLeft className="h-5 w-5 sm:hidden" />
          <span className="hidden sm:inline">Semaine précédente</span>
        </Button>
        <div className="min-w-0 text-center text-xs text-muted-foreground">
          {data ? `${fmtJour(data.semaine.debut)} → ${fmtJour(data.semaine.fin)}` : '—'}
        </div>
        <Button
          variant="outline"
          onClick={() => decalerSemaine(7)}
          aria-label="Semaine suivante"
          className="h-11 w-11 shrink-0 p-0 sm:h-8 sm:w-auto sm:px-3"
        >
          <ChevronRight className="h-5 w-5 sm:hidden" />
          <span className="hidden sm:inline">Suivante</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-6 text-center text-sm text-destructive">
          Impossible de charger la semaine.
        </div>
      ) : groupes.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center text-sm text-muted-foreground">
          {words.noneLabel} planifié{feminin ? 'e' : ''} cette semaine. Renseignez le planning de l'équipe pour
          obtenir une proposition pré-remplie.
        </div>
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-2">
          {groupes.map((groupe) => (
            <motion.div
              key={groupe.cle}
              variants={itemVariants}
              className="rounded-xl border border-card-border bg-card"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
                onClick={() =>
                  setDeplie((d) => ({ ...d, [groupe.cle]: !d[groupe.cle] }))
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{groupe.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {groupe.lignes.length} jour(s)
                  </div>
                </div>
                <div className="font-mono-nums text-base font-semibold">{groupe.heures} h</div>
                {deplie[groupe.cle] ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {deplie[groupe.cle] && (
                <div className="border-t border-border px-4 py-3 space-y-2">
                  {groupe.lignes.map((l) => (
                    <div key={cleLigne(l)} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="truncate text-foreground">{fmtJour(l.date)}</div>
                        <div className="truncate text-muted-foreground">{l.membreNom}</div>
                      </div>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={24}
                        step={0.5}
                        className="h-11 w-20 text-right font-mono-nums sm:h-9"
                        value={heuresDe(l)}
                        onChange={(e) =>
                          setAjustements((a) => ({
                            ...a,
                            [cleLigne(l)]: Math.max(0, Math.min(24, Number(e.target.value) || 0)),
                          }))
                        }
                      />
                      {l.origine === 'propose' && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          proposé
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      )}

      <div className="sticky bottom-0 mt-5 -mx-4 border-t border-border bg-background/95 px-4 py-4 backdrop-blur">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total de la semaine</span>
          <span className="font-mono-nums text-2xl font-semibold">{total} h</span>
        </div>
        <Button
          className="w-full"
          size="lg"
          disabled={isLoading || confirmer.isPending || groupes.length === 0}
          onClick={() => confirmer.mutate()}
        >
          {confirmer.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enregistrement…
            </>
          ) : (
            'Confirmer la semaine'
          )}
        </Button>
      </div>
    </div>
  );
}
