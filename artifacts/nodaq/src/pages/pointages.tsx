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

/** Un chantier ou un client sur lequel on peut pointer, mais qui n'est pas
 *  déjà dans la proposition — voir `chantiersDisponibles` côté serveur. */
type ChantierDisponible = {
  affaireId: string | null;
  clientId: string | null;
  libelle: string;
};

type Recap = {
  semaine: { debut: string; fin: string };
  lignes: Ligne[];
  /** Optionnel : un récapitulatif servi avant ce lot n'en porte pas. */
  chantiersDisponibles?: ChantierDisponible[];
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

  /**
   * Les lignes ajoutées à la main pour un chantier absent de la proposition.
   *
   * « Quand je crée un chantier en cours, pourquoi il n'apparaît pas dans les
   * heures de la semaine ? » — parce que la proposition vient des
   * AFFECTATIONS. Un chantier où personne n'a encore été envoyé n'y figure
   * pas, et il n'existait aucun moyen d'y pointer quoi que ce soit.
   *
   * Elles arrivent à ZÉRO heure : proposer du temps sur un chantier où
   * personne n'a été envoyé, ce serait en fabriquer.
   */
  const [lignesAjoutees, setLignesAjoutees] = useState<Ligne[]>([]);
  const [chantierChoisi, setChantierChoisi] = useState('');
  const [membreChoisi, setMembreChoisi] = useState('');

  /**
   * Les personnes déjà présentes dans la semaine.
   *
   * Tirées des lignes plutôt que d'un appel de plus : qui apparaît dans la
   * proposition est exactement qui peut recevoir des heures cette semaine —
   * un absent n'y figure pas, et n'a donc pas à être proposé.
   */
  const membresConnus = useMemo(() => {
    const vus = new Map<string, { id: string; nom: string }>();
    for (const l of data?.lignes ?? []) vus.set(l.membreId, { id: l.membreId, nom: l.membreNom });
    return [...vus.values()].sort((a, b) => a.nom.localeCompare(b.nom));
  }, [data]);

  // Repartir à zéro en changeant de semaine, comme les ajustements : une
  // ligne ajoutée pour une semaine n'a rien à faire dans une autre.
  useEffect(() => setLignesAjoutees([]), [semaineRef]);
  // Pré-sélectionner la première personne évite un clic de plus au pouce.
  useEffect(() => {
    if (!membreChoisi && membresConnus.length > 0) setMembreChoisi(membresConnus[0]!.id);
  }, [membresConnus, membreChoisi]);

  const toutesLignes = useMemo(
    () => [...(data?.lignes ?? []), ...lignesAjoutees],
    [data, lignesAjoutees],
  );

  const heuresDe = (l: Ligne): number => ajustements[cleLigne(l)] ?? l.heures;

  const ajouterChantier = (c: ChantierDisponible, membre: { id: string; nom: string }) => {
    setLignesAjoutees((actuelles) => {
      const ligne: Ligne = {
        membreId: membre.id,
        membreNom: membre.nom,
        affaireId: c.affaireId,
        affaireLabel: c.affaireId ? c.libelle : null,
        clientId: c.clientId,
        clientLabel: c.clientId ? c.libelle : null,
        date: data?.semaine.debut ?? toDateString(new Date()),
        heures: 0,
        origine: 'propose',
      };
      // Deux clics sur la même paire ne créent pas deux lignes : la clé est
      // celle de la base, et un doublon y serait refusé de toute façon.
      const cle = cleLigne(ligne);
      if (actuelles.some((l) => cleLigne(l) === cle)) return actuelles;
      if ((data?.lignes ?? []).some((l) => cleLigne(l) === cle)) return actuelles;
      return [...actuelles, ligne];
    });
  };

  // Un groupe par rattachement — affaire OU client, jamais les deux — sur le
  // même principe que le regroupement `parAffaire`/`parClient` du serveur.
  const groupes = useMemo(() => {
    const acc = new Map<string, { label: string; heures: number; lignes: Ligne[] }>();
    for (const l of toutesLignes) {
      const cle = cleRattachement(l);
      const cur = acc.get(cle) ?? { label: (l.affaireLabel ?? l.clientLabel)!, heures: 0, lignes: [] };
      cur.heures += heuresDe(l);
      cur.lignes.push(l);
      acc.set(cle, cur);
    }
    return [...acc.entries()].map(([cle, v]) => ({ cle, ...v }));
  }, [toutesLignes, ajustements]);

  const total = groupes.reduce((acc, g) => acc + g.heures, 0);

  const confirmer = useMutation({
    mutationFn: async () => {
      const lignes = toutesLignes.map((l) => ({
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

      {/* Ajouter un chantier absent de la proposition. Sans ça, un chantier
          créé sans affectation était impossible à pointer : il existait, il
          était en cours, et aucune heure ne pouvait s'y rattacher. */}
      {(data?.chantiersDisponibles?.length ?? 0) > 0 && membresConnus.length > 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-card-border p-3" data-testid="ajouter-chantier">
          <p className="text-xs text-muted-foreground">
            Un chantier manque ? Ajoutez-le — il arrive à 0 h, à vous de saisir le temps réel.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="Chantier à ajouter"
              className="h-11 flex-1 rounded-md border border-input bg-background px-3 text-sm sm:h-9"
              value={chantierChoisi}
              onChange={(e) => setChantierChoisi(e.target.value)}
            >
              <option value="">Choisir…</option>
              {data?.chantiersDisponibles?.map((c) => (
                <option key={c.affaireId ?? c.clientId ?? ''} value={c.affaireId ?? `c:${c.clientId}`}>
                  {c.libelle}
                </option>
              ))}
            </select>
            <select
              aria-label="Personne concernée"
              className="h-11 flex-1 rounded-md border border-input bg-background px-3 text-sm sm:h-9"
              value={membreChoisi}
              onChange={(e) => setMembreChoisi(e.target.value)}
            >
              {membresConnus.map((m) => (
                <option key={m.id} value={m.id}>{m.nom}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              disabled={!chantierChoisi || !membreChoisi}
              onClick={() => {
                const c = data?.chantiersDisponibles?.find(
                  (x) => (x.affaireId ?? `c:${x.clientId}`) === chantierChoisi,
                );
                const m = membresConnus.find((x) => x.id === membreChoisi);
                if (c && m) {
                  ajouterChantier(c, m);
                  setChantierChoisi('');
                }
              }}
            >
              Ajouter
            </Button>
          </div>
        </div>
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
