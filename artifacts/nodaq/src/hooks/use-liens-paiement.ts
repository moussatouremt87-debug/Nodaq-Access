/**
 * Les liens de paiement émis après un appel de relance (4.19, lot E).
 *
 * Lecture pour tout rôle à accès financier ; le renvoi est réservé au
 * propriétaire côté serveur — l'écran ne fait que ne pas le proposer, il ne
 * l'autorise pas.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

const API = '/api';

export type StatutLienPaiement = 'EMIS' | 'PAYE' | 'EXPIRE' | 'REVOQUE' | 'ECHEC';

export interface LienPaiement {
  id: string;
  factureId: string | null;
  montantCents: number;
  statut: StatutLienPaiement;
  url: string | null;
  expireLe: string | null;
  payeLe: string | null;
  createdAt: string;
}

export function useLiensPaiement() {
  return useQuery<LienPaiement[]>({
    queryKey: ['liens-paiement'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/relance/liens-paiement`);
      if (!res.ok) throw new Error('Chargement impossible');
      const corps = (await res.json()) as { liens: LienPaiement[] };
      return corps.liens;
    },
  });
}

export function useRenvoyerLienPaiement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`${API}/relance/liens-paiement/${id}/renvoyer`, {
        method: 'POST',
      });
      const corps = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((corps as { error?: string }).error ?? 'Renvoi impossible');
      return corps as { renvoye: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['liens-paiement'] }),
  });
}
