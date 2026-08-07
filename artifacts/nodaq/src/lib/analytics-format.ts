/**
 * 4.11 — Sentence formatters for analytics indicators.
 *
 * Spec §8: "LE NOM AFFICHÉ EST DÉJÀ LA PHRASE D'EXPLICATION."
 * Each function returns the exact French sentence shown as the tile title.
 *
 * Spec §13 — Forbidden vocabulary (never use in labels):
 *   KPI · ratio · taux de · performance · pilotage · indicateur avancé
 */
import { fmtEURCompact } from '@/lib/format';
import type { IndicateurId, IndicateurResult } from '@/hooks/use-analytics';

const MOIS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function fmtDay(d: Date): string {
  const j = d.getDate();
  return `${j === 1 ? '1er' : j} ${MOIS_FR[d.getMonth()]}`;
}

/** Adds a calendar date from today + N days. */
function addDays(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

// ── Phrase builders ────────────────────────────────────────────────────────────

export interface PhraseResult {
  /** Main sentence — the tile title (≥48px hero). */
  phrase: string;
  /** Optional sub-line (shown small below the phrase). */
  sous: string | null;
  /** Human-readable explanation of what this figure means. */
  explication: string;
  /** Optional action link label + href. */
  action?: { label: string; href: string };
  /**
   * Semantic tone for state coloring.
   * State colors always carry an icon + word — never color alone.
   */
  tone?: 'default' | 'bon' | 'attention' | 'serieux' | 'critique';
}

type Builder = (r: IndicateurResult) => PhraseResult;

const BUILDERS: Record<IndicateurId, Builder> = {
  horizon_travail: (r) => {
    const jours = r.valeur ?? 0;
    const date = addDays(jours);
    return {
      phrase: `Vous avez du travail jusqu'au ${fmtDay(date)}`,
      sous: `${jours} jours de carnet`,
      explication:
        "C'est le nombre de jours de travail payant que vous avez déjà en portefeuille. En dessous de 30 jours, pensez à prospecter activement.",
      tone: jours < 30 ? 'critique' : jours < 60 ? 'attention' : 'bon',
    };
  },

  argent_qui_dort: (r) => {
    const total = r.valeur ?? 0;
    const plus60 = (r.detail?.plus60Jours as number | undefined) ?? 0;
    return {
      phrase: `${fmtEURCompact(total)} dorment chez vos clients`,
      sous: plus60 > 0 ? `dont ${fmtEURCompact(plus60)} à plus de 60 jours` : null,
      explication:
        "Ce sont les factures envoyées mais pas encore réglées (retenues de garantie déduites). Les montants au-delà de 60 jours méritent une relance.",
      action: r.nbSources > 0
        ? { label: `Relancer les ${r.nbSources} facture${r.nbSources > 1 ? 's' : ''} en attente`, href: '/factures' }
        : undefined,
      tone: plus60 > 0 ? 'serieux' : total > 0 ? 'attention' : 'default',
    };
  },

  marge_pour_100_euros: (r) => {
    const v = Math.round(r.valeur ?? 0);
    return {
      phrase: `Sur 100 € facturés, il vous reste ${v} €`,
      sous: null,
      explication:
        "Pour chaque tranche de 100 € facturée, c'est ce qu'il reste une fois les achats et la main-d'œuvre déduits. En dessous de 15 €, les coûts laissent peu de marge.",
      tone: v < 10 ? 'critique' : v < 20 ? 'attention' : v >= 30 ? 'bon' : 'default',
    };
  },

  delai_paiement_client: (r) => {
    const jours = r.valeur ?? 0;
    return {
      phrase: `Vos clients vous paient en ${jours} jours`,
      sous: null,
      explication:
        "Moyenne pondérée entre l'émission d'une facture et son encaissement. En dessous de 30 jours, c'est excellent. Au-delà de 60 jours, votre trésorerie en souffre.",
      tone: jours > 60 ? 'critique' : jours > 45 ? 'attention' : jours <= 30 ? 'bon' : 'default',
    };
  },

  ca_facture: (r) => ({
    phrase: fmtEURCompact(r.valeur ?? 0) + ' facturés',
    sous: `${r.nbSources} facture${r.nbSources > 1 ? 's' : ''}`,
    explication: 'Montant total hors taxes des factures émises sur la période, hors avoirs et brouillons.',
  }),

  ca_encaisse: (r) => ({
    phrase: fmtEURCompact(r.valeur ?? 0) + ' encaissés',
    sous: `${r.nbSources} facture${r.nbSources > 1 ? 's' : ''} réglée${r.nbSources > 1 ? 's' : ''}`,
    explication:
      "Montant total hors taxes effectivement encaissé — c'est l'argent qui est entré en compte sur la période.",
  }),

  resultat_exploitation_estime: (r) => {
    const v = r.valeur ?? 0;
    return {
      phrase: `Résultat${r.estime ? ' estimé' : ''} : ${fmtEURCompact(v)}`,
      sous: r.estime ? 'Estimé — certaines charges ne sont pas encore saisies' : null,
      explication:
        "CA encaissé moins les charges connues (achats, salaires…). Marqué « estimé » tant que toutes les lignes de charges n'ont pas été renseignées dans le compte de résultat.",
      action: r.estime
        ? { label: 'Compléter les charges', href: '/compte-resultat' }
        : undefined,
      tone: v < 0 ? 'critique' : v === 0 ? 'attention' : 'default',
    };
  },

  carnet_commandes_euros: (r) => ({
    phrase: `${fmtEURCompact(r.valeur ?? 0)} de travail en cours`,
    sous: `${r.nbSources} affaire${r.nbSources > 1 ? 's' : ''} active${r.nbSources > 1 ? 's' : ''}`,
    explication:
      "Valeur des affaires en cours dont la facturation n'est pas encore complète — c'est le travail déjà vendu qui reste à produire et à facturer.",
  }),

  taux_signature_devis: (r) => {
    const nb = (r.detail?.nbAcceptes as number | undefined) ?? 0;
    const total = (r.detail?.nbEnvoyes as number | undefined) ?? r.nbSources;
    return {
      phrase: `Vous signez ${nb} devis sur ${total}`,
      sous: `${r.valeur ?? 0} % d'acceptation`,
      explication:
        "Proportion de vos devis envoyés qui ont été acceptés sur la période. En dessous de 1 sur 3, c'est souvent un signal sur le prix ou la présentation.",
      action: { label: 'Voir les devis en cours', href: '/devis' },
      tone: (r.valeur ?? 0) < 25 ? 'attention' : 'default',
    };
  },

  delai_reponse_devis: (r) => {
    const jours = r.valeur ?? 0;
    return {
      phrase: `Vos clients répondent en ${jours} jours`,
      sous: 'délai moyen de signature',
      explication:
        "Temps moyen entre l'envoi d'un devis et sa signature. Un délai court signale une proposition convaincante ou un besoin urgent.",
    };
  },

  montant_moyen_affaire: (r) => ({
    phrase: `${fmtEURCompact(r.valeur ?? 0)} par affaire en moyenne`,
    sous: `sur ${r.nbSources} affaire${r.nbSources > 1 ? 's' : ''}`,
    explication:
      "Valeur moyenne d'une affaire sur la période. Augmenter ce montant en ciblant des chantiers plus importants peut avoir plus d'impact que multiplier les petites affaires.",
  }),

  jours_factures_sur_payes: (_r) => ({
    phrase: 'Données de pointage non disponibles',
    sous: null,
    explication:
      "Cet indicateur nécessite l'enregistrement du temps de travail par affaire. Il sera disponible quand le module de pointage sera activé.",
  }),

  ecart_devise_realise: (r) => {
    const jours = r.valeur ?? 0;
    const ecartCents = (r.detail?.ecartMoyenCents as number | undefined) ?? 0;
    const sign = jours > 0 ? '+' : '';
    return {
      phrase: `${sign}${jours} jours de décalage en moyenne`,
      sous: ecartCents !== 0
        ? `${ecartCents > 0 ? '+' : ''}${fmtEURCompact(Math.abs(ecartCents))} d'écart`
        : null,
      explication:
        "Différence moyenne entre la date de fin prévue au devis et la date de clôture réelle. Un écart positif signifie que les chantiers prennent plus de temps que prévu.",
      tone: jours > 14 ? 'attention' : 'default',
    };
  },

  concentration_client: (r) => {
    const pct = r.valeur ?? 0;
    const nom = (r.detail?.topClient as string | undefined) ?? 'votre plus gros client';
    return {
      phrase: `${nom} représente ${pct} % de votre CA`,
      sous: `sur ${r.nbSources} client${r.nbSources > 1 ? 's' : ''}`,
      explication:
        "Concentration de votre chiffre d'affaires sur un seul client. Au-delà de 50 %, une rupture de cette relation aurait un impact majeur. Pensez à diversifier.",
      tone: pct >= 50 ? 'critique' : pct >= 33 ? 'attention' : 'default',
    };
  },
};

export function buildPhrase(r: IndicateurResult): PhraseResult {
  if (r.donneesInsuffisantes) {
    return {
      phrase: 'Pas encore assez de données',
      sous: `Il faut au moins ${minSourcesLabel(r.id)} pour afficher cet indicateur.`,
      explication: BUILDERS[r.id]?.(r)?.explication ?? '',
    };
  }
  return BUILDERS[r.id]?.(r) ?? { phrase: '—', sous: null, explication: '' };
}

function minSourcesLabel(id: IndicateurId): string {
  const map: Partial<Record<IndicateurId, string>> = {
    horizon_travail: '3 affaires en cours',
    argent_qui_dort: '1 facture en attente',
    marge_pour_100_euros: '3 affaires clôturées',
    delai_paiement_client: '5 factures réglées',
    taux_signature_devis: '5 devis envoyés',
    delai_reponse_devis: '3 devis signés',
    ecart_devise_realise: '3 affaires clôturées avec date prévue',
  };
  return map[id] ?? 'suffisamment de données';
}

/** Compute the delta % between current and comparison values. */
export function deltaPercent(current: number | null, comparison: number | null): number | null {
  if (current === null || comparison === null || comparison === 0) return null;
  return Math.round(((current - comparison) / Math.abs(comparison)) * 100);
}
