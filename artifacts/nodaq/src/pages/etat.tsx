/**
 * L'état des services — /etat, page PUBLIQUE.
 *
 * Publique volontairement, et pour la même raison que les articles d'aide :
 * celui qui n'arrive pas à se connecter est précisément celui qui a besoin de
 * savoir si la panne vient de lui. Une page d'état derrière une session ne
 * répond jamais à la seule question qu'on lui pose.
 *
 * Rendue NUE, hors de l'AppShell (voir `ROUTES_PUBLIQUES` dans App.tsx) : la
 * coquille appelle `useIsOwner()`, donc `/auth/me`, ce qui renverrait 401 à un
 * visiteur sans session — et lui montrerait la navigation complète du produit.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';

const API = '/api';

type EtatComposant = 'operationnel' | 'degrade' | 'indisponible';

type Composant = {
  nom: string;
  etat: EtatComposant;
  consequence: string | null;
  tempsReponseMs?: number;
};

type Etat = {
  global: EtatComposant;
  message: string;
  composants: Composant[];
  verifieLe: string;
  limite: string;
};

/** Le vert et le rouge ne suffisent pas : une icône et un mot les doublent. */
const APPARENCE: Record<EtatComposant, {
  libelle: string;
  Icone: typeof CheckCircle2;
  couleur: string;
  fond: string;
}> = {
  operationnel: {
    libelle: 'Fonctionne',
    Icone: CheckCircle2,
    couleur: 'text-emerald-600 dark:text-emerald-400',
    fond: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900',
  },
  degrade: {
    libelle: 'Au ralenti',
    Icone: AlertTriangle,
    couleur: 'text-amber-600 dark:text-amber-400',
    fond: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
  },
  indisponible: {
    libelle: 'Interrompu',
    Icone: XCircle,
    couleur: 'text-red-600 dark:text-red-400',
    fond: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900',
  },
};

/** Relecture périodique : on regarde cette page en ATTENDANT que ça revienne. */
const INTERVALLE_MS = 30_000;

export default function EtatPage() {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [injoignable, setInjoignable] = useState(false);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let vivant = true;
    const relever = async () => {
      try {
        const res = await fetch(`${API}/etat`, { cache: 'no-store' });
        if (!res.ok) throw new Error('indisponible');
        const data = (await res.json()) as Etat;
        if (!vivant) return;
        setEtat(data);
        setInjoignable(false);
      } catch {
        /*
         * Le seul cas que cette page ne peut pas rapporter proprement : le
         * serveur ne répond plus du tout. On le DIT, au lieu de laisser un
         * écran vide qui ressemblerait à « tout va bien ».
         */
        if (vivant) setInjoignable(true);
      } finally {
        if (vivant) setChargement(false);
      }
    };
    void relever();
    const t = setInterval(() => void relever(), INTERVALLE_MS);
    return () => { vivant = false; clearInterval(t); };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-16">
        <header className="mb-8">
          <p className="text-sm font-medium text-muted-foreground">nodaq</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            État des services
          </h1>
        </header>

        {chargement && !etat && !injoignable && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            Vérification en cours…
          </p>
        )}

        {injoignable && <ServeurInjoignable />}

        {etat && !injoignable && (
          <>
            <Bandeau etat={etat} />
            <ul className="mt-6 space-y-3" aria-label="Détail par service">
              {etat.composants.map((c) => (
                <LigneComposant key={c.nom} composant={c} />
              ))}
            </ul>

            <p className="mt-6 text-sm text-muted-foreground">
              Dernière vérification&nbsp;: {heure(etat.verifieLe)}. Cette page se
              met à jour toute seule toutes les 30&nbsp;secondes.
            </p>

            <p className="mt-2 text-sm text-muted-foreground">{etat.limite}</p>
          </>
        )}

        <footer className="mt-10 border-t pt-6 text-sm">
          <p className="text-muted-foreground">
            Un problème qui n'apparaît pas ici&nbsp;? Posez la question dans{' '}
            <a href="/aide" className="font-medium underline underline-offset-4">
              l'aide de nodaq
            </a>{' '}
            une fois connecté&nbsp;: le support regarde votre dossier et
            transmet à l'équipe si besoin.
          </p>
          <p className="mt-3">
            <a href="/login" className="font-medium underline underline-offset-4">
              Retour à la connexion
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function Bandeau({ etat }: { etat: Etat }) {
  const { Icone, couleur, fond } = APPARENCE[etat.global];
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${fond}`} role="status">
      <Icone className={`mt-0.5 h-5 w-5 shrink-0 ${couleur}`} aria-hidden />
      <p className="font-medium">{etat.message}</p>
    </div>
  );
}

function LigneComposant({ composant }: { composant: Composant }) {
  const { libelle, Icone, couleur } = APPARENCE[composant.etat];
  return (
    <li className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="min-w-0">
        <p className="font-medium">{composant.nom}</p>
        {composant.consequence && (
          <p className="mt-1 text-sm text-muted-foreground">{composant.consequence}</p>
        )}
      </div>
      <span className={`flex shrink-0 items-center gap-1.5 text-sm font-medium ${couleur}`}>
        <Icone className="h-4 w-4" aria-hidden />
        {libelle}
      </span>
    </li>
  );
}

function ServeurInjoignable() {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
      <p className="flex items-center gap-2 font-medium text-red-700 dark:text-red-300">
        <XCircle className="h-5 w-5 shrink-0" aria-hidden />
        nodaq ne répond pas.
      </p>
      <p className="mt-2 text-sm text-red-800/90 dark:text-red-200/90">
        L'interruption touche l'application entière. Elle est de notre côté, pas
        du vôtre&nbsp;: rien à réinstaller, rien à reconfigurer. Cette page
        réessaie toute seule toutes les 30&nbsp;secondes.
      </p>
    </div>
  );
}

/** Une heure locale lisible. Jamais d'ISO brut : ce n'est pas lisible. */
function heure(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'à l’instant';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
