/**
 * Règle de négociation de la relance (ticket 4.18, US-9).
 *
 * Lue par TOUS les rôles, écrite par le seul propriétaire — c'est le serveur
 * qui l'impose (`biz` en lecture, `ownerOnly` en écriture) ; ce hook ne fait
 * que le refléter.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';
import type { RegleRelance } from '@nodaq/shared';

const API = '/api';

export interface RegleCourante extends RegleRelance {
  /** 0 = aucune version posée : le défaut prudent s'applique. */
  version: number;
  poseeParEmail: string | null;
  poseeLe: string | null;
  /** Phrase rendue par le serveur — une seule formulation pour tous les écrans. */
  resume: string;
}

export function useRegleRelance() {
  return useQuery<RegleCourante>({
    queryKey: ['relance-regles'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/relance/regles`);
      if (!r.ok) throw new Error('Chargement de la règle impossible');
      return r.json() as Promise<RegleCourante>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useEnregistrerRegleRelance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (regle: RegleRelance) => {
      const r = await apiFetch(`${API}/relance/regles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regle),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        // Le serveur rend un message écrit pour un humain (422) : on le montre
        // tel quel plutôt que d'en fabriquer un second, moins précis.
        throw new Error((err as { error?: string }).error ?? 'Enregistrement impossible');
      }
      return r.json() as Promise<RegleCourante>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['relance-regles'] });
    },
  });
}
