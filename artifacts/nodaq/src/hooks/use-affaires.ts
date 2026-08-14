import {
  useListAffaires,
  useGetAffaire,
  useGetAffaireStats,
  useCreateAffaire,
  useUpdateAffaire,
  useDeleteAffaire,
  getListAffairesQueryKey,
  getGetAffaireQueryKey,
  getGetAffaireStatsQueryKey,
  getGetCockpitKpisQueryKey,
  getGetCockpitActivityQueryKey,
  type ListAffairesParams,
  type AffaireInput,
  type AffaireUpdate,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export function useAffaires(params?: ListAffairesParams) {
  return useListAffaires(params);
}

export function useAffaire(id: string) {
  return useGetAffaire(id);
}

export function useAffaireStats() {
  return useGetAffaireStats();
}

function useInvalidateAffaires() {
  const queryClient = useQueryClient();
  // `id` invalide la fiche détail de CETTE affaire — sa clé de requête
  // (`/api/affaires/{id}`) est indépendante de celle de la liste, l'une ne
  // recouvre pas l'autre. Sans elle, `/affaires/:id` continuait d'afficher
  // les anciennes valeurs après "Modifier" tant qu'on ne rechargeait pas la
  // page à la main, alors que l'écriture avait bien réussi côté serveur.
  return (id?: string) => {
    queryClient.invalidateQueries({ queryKey: getListAffairesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAffaireStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCockpitKpisQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetCockpitActivityQueryKey(),
    });
    if (id) queryClient.invalidateQueries({ queryKey: getGetAffaireQueryKey(id) });
  };
}

export function useCreateAffaireMutation() {
  const invalidate = useInvalidateAffaires();
  const { toast } = useToast();
  const mutation = useCreateAffaire();
  return {
    ...mutation,
    createAffaire: (data: AffaireInput, onSuccess?: () => void) =>
      mutation.mutate(
        { data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: 'Affaire créée' });
            onSuccess?.();
          },
          onError: () =>
            toast({
              title: "Échec de la création de l'affaire",
              variant: 'destructive',
            }),
        },
      ),
  };
}

export function useUpdateAffaireMutation() {
  const invalidate = useInvalidateAffaires();
  const { toast } = useToast();
  const mutation = useUpdateAffaire();
  return {
    ...mutation,
    updateAffaire: (
      id: string,
      data: AffaireUpdate,
      onSuccess?: () => void,
    ) =>
      mutation.mutate(
        { id, data },
        {
          onSuccess: () => {
            invalidate(id);
            toast({ title: 'Affaire mise à jour' });
            onSuccess?.();
          },
          onError: () =>
            toast({
              title: 'Échec de la mise à jour',
              variant: 'destructive',
            }),
        },
      ),
  };
}

export function useDeleteAffaireMutation() {
  const invalidate = useInvalidateAffaires();
  const { toast } = useToast();
  const mutation = useDeleteAffaire();
  return {
    ...mutation,
    deleteAffaire: (id: string, onSuccess?: () => void) =>
      mutation.mutate(
        { id },
        {
          onSuccess: () => {
            invalidate(id);
            toast({ title: 'Affaire supprimée' });
            onSuccess?.();
          },
          onError: () =>
            toast({ title: 'Échec de la suppression', variant: 'destructive' }),
        },
      ),
  };
}
