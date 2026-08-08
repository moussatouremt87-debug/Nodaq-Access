/**
 * React Query hooks for the 4.11 analytics engine.
 * All data comes from server-side calculations — the client never computes a figure.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

export const INDICATEUR_IDS = [
  'horizon_travail',
  'argent_qui_dort',
  'marge_pour_100_euros',
  'delai_paiement_client',
  'ca_facture',
  'ca_encaisse',
  'resultat_exploitation_estime',
  'carnet_commandes_euros',
  'taux_signature_devis',
  'delai_reponse_devis',
  'montant_moyen_affaire',
  'jours_factures_sur_payes',
  'ecart_devise_realise',
  'concentration_client',
] as const;

export type IndicateurId = (typeof INDICATEUR_IDS)[number];

export type PeriodeMode = 'mois' | 'trimestre' | 'exercice' | '12_mois';
export type ComparaisonMode =
  | 'aucune'
  | 'periode_precedente'
  | 'meme_periode_n1'
  | 'moyenne_12_mois';

export interface ComparaisonResult {
  mode: string;
  periode?: { debut: string; fin: string; label: string };
  valeur: number | null;
  nbSources: number;
  donneesInsuffisantes: boolean;
  messageImpossible?: string;
}

export interface IndicateurResult {
  id: IndicateurId;
  valeur: number | null;
  unite: string;
  periode: { debut: string; fin: string; label: string };
  nbSources: number;
  donneesInsuffisantes: boolean;
  estime?: boolean;
  detail?: Record<string, unknown>;
  comparaison?: ComparaisonResult;
}

export interface SeriePoint {
  periode: { debut: string; fin: string; label: string };
  valeur: number | null;
  nbSources: number;
  donneesInsuffisantes: boolean;
}

export interface AnalyticsParams {
  ids?: IndicateurId[];
  periode: PeriodeMode;
  comparaison: ComparaisonMode;
  debut?: string;
  fin?: string;
}

/** Fetch all (or a subset of) indicators for a given period + comparison mode. */
export function useIndicateurs(params: AnalyticsParams) {
  const idsParam = params.ids?.join(',') ?? 'all';
  return useQuery({
    queryKey: ['analytics', 'indicateurs', idsParam, params.periode, params.comparaison, params.debut, params.fin],
    queryFn: async (): Promise<IndicateurResult[]> => {
      const qs = new URLSearchParams({
        ids: idsParam,
        periode: params.periode,
        comparaison: params.comparaison,
      });
      if (params.debut) qs.set('debut', params.debut);
      if (params.fin) qs.set('fin', params.fin);
      const res = await apiFetch(`/api/analytics/indicateurs?${qs}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Fetch a single indicator — used when only one tile is being shown/refreshed. */
export function useIndicateur(id: IndicateurId, params: Omit<AnalyticsParams, 'ids'>) {
  return useQuery({
    queryKey: ['analytics', 'indicateur', id, params.periode, params.comparaison],
    queryFn: async (): Promise<IndicateurResult> => {
      const qs = new URLSearchParams({ periode: params.periode, comparaison: params.comparaison });
      const res = await apiFetch(`/api/analytics/indicateurs/${id}?${qs}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Fetch the monthly time series for a single indicator (evolution chart). */
export function useIndicateurSerie(id: IndicateurId, n = 12) {
  return useQuery({
    queryKey: ['analytics', 'serie', id, n],
    queryFn: async (): Promise<SeriePoint[]> => {
      const res = await apiFetch(`/api/analytics/indicateurs/${id}/serie?n=${n}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}
