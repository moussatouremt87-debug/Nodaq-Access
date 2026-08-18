/**
 * La campagne portée par une action de la file de validation (4.18, US-1).
 *
 * Chargée par action, à la demande : la file affiche des actions de toutes
 * natures, et seules celles de type `call_dunning` en ont une.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';
import type { RegleRelance } from '@nodaq/shared';

const API = '/api';

export interface AppelPropose {
  clientId: string | null;
  factureId: string;
  montantCents: number;
  numero: string;
  clientNom: string;
}

export interface CampagneRelance {
  id: string;
  pendingActionId: string;
  statut: 'PROPOSEE' | 'VALIDEE' | 'REJETEE' | 'TERMINEE';
  appels: AppelPropose[];
  mandat: RegleRelance;
  regleVersion: number | null;
  fenetreDebutHeure: number;
  fenetreFinHeure: number;
  maxTentatives: number;
}

export interface CampagnePourAction {
  campagne: CampagneRelance;
  /** La règle du tenant : ce que le panneau PEUT proposer, pas plus. */
  regle: RegleRelance;
  regleVersion: number;
  restreintLaRegle: boolean;
}

export function useCampagnePourAction(pendingActionId: string, actif: boolean) {
  return useQuery<CampagnePourAction>({
    queryKey: ['campagne-relance', pendingActionId],
    enabled: actif,
    queryFn: async () => {
      const r = await apiFetch(`${API}/relance/campagnes/par-action/${pendingActionId}`);
      if (!r.ok) throw new Error('Campagne introuvable');
      return r.json() as Promise<CampagnePourAction>;
    },
  });
}

/** Resserrer le mandat. Ne peut jamais l'élargir — le serveur le garantit. */
export function useResserrerMandat(pendingActionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { campagneId: string; mandat: Partial<RegleRelance> }) => {
      const r = await apiFetch(`${API}/relance/campagnes/${params.campagneId}/mandat`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.mandat),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Modification impossible');
      }
      return r.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campagne-relance', pendingActionId] });
      // La file affiche le libellé et le montant : ils suivent le mandat.
      void qc.invalidateQueries({ queryKey: ['pending-actions'] });
    },
  });
}

/** Retirer un débiteur de la liste avant validation. */
export function useExclureAppel(pendingActionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { campagneId: string; factureId: string }) => {
      const r = await apiFetch(
        `${API}/relance/campagnes/${params.campagneId}/appels/${params.factureId}`,
        { method: 'DELETE' },
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Exclusion impossible');
      }
      return r.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campagne-relance', pendingActionId] });
      void qc.invalidateQueries({ queryKey: ['pending-actions'] });
    },
  });
}
