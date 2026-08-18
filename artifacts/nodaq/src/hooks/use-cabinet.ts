/**
 * Console cabinet (US-A5.2) — le portefeuille de tenants d'un utilisateur, et
 * la bascule de l'un à l'autre.
 *
 * La bascule change le tenant de la session EN PLACE côté serveur : tous les
 * écrans déjà chargés montrent alors les données du MAUVAIS client tant que
 * leur cache n'est pas vidé. D'où l'invalidation TOTALE du cache React Query
 * dans `onSuccess` — pas une liste de clés à tenir à jour, qui finirait
 * fatalement par en oublier une.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';
import type { MembershipRole } from '@/hooks/use-auth';

const API = '/api';

export const ESPACES_QUERY_KEY = ['mes-espaces'];

export type Espace = {
  tenantId: string;
  tenantNom: string;
  role: MembershipRole;
  secteurLabel: string;
  /** Affaires en cours — `null` pour un espace où l'utilisateur est simple
   *  MEMBER : aucune donnée financière ne lui est rendue. */
  affairesEnCours: number | null;
};

export function useMesEspaces() {
  const { data, isLoading } = useQuery<{ espaces: Espace[] }>({
    queryKey: ESPACES_QUERY_KEY,
    queryFn: async () => {
      const res = await apiFetch(`${API}/auth/mes-espaces`);
      if (!res.ok) throw new Error('Impossible de charger vos espaces');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const espaces = data?.espaces ?? [];
  return {
    espaces,
    isLoading,
    /** Un seul espace = utilisateur mono-tenant : rien de « cabinet » à
     *  montrer. C'est le cas de l'immense majorité des comptes. */
    estMultiEspaces: espaces.length > 1,
  };
}

export function useBasculerEspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tenantId: string) => {
      const res = await apiFetch(`${API}/auth/basculer-espace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (!res.ok) throw new Error('Bascule impossible');
      return res.json();
    },
    onSuccess: () => {
      // Tout le cache, sans exception : chaque écran est scopé au tenant.
      qc.invalidateQueries();
    },
  });
}
