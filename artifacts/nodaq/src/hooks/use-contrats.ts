import {
  useListContrats,
  useCreateContrat,
  useUpdateContrat,
  useDeleteContrat,
  getListContratsQueryKey,
  getGetCockpitKpisQueryKey,
  type ContratInput,
  type ContratUpdate,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export function useContrats() {
  return useListContrats();
}

function useInvalidateContrats() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: getListContratsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCockpitKpisQueryKey() });
  };
}

export function useCreateContratMutation() {
  const invalidate = useInvalidateContrats();
  const { toast } = useToast();
  const mutation = useCreateContrat();
  return {
    ...mutation,
    createContrat: (data: ContratInput, onSuccess?: () => void) =>
      mutation.mutate(
        { data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: 'Contrat créé' });
            onSuccess?.();
          },
          onError: () =>
            toast({
              title: 'Échec de la création du contrat',
              variant: 'destructive',
            }),
        },
      ),
  };
}

export function useUpdateContratMutation() {
  const invalidate = useInvalidateContrats();
  const { toast } = useToast();
  const mutation = useUpdateContrat();
  return {
    ...mutation,
    updateContrat: (
      id: string,
      data: ContratUpdate,
      onSuccess?: () => void,
    ) =>
      mutation.mutate(
        { id, data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: 'Contrat mis à jour' });
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

export function useDeleteContratMutation() {
  const invalidate = useInvalidateContrats();
  const { toast } = useToast();
  const mutation = useDeleteContrat();
  return {
    ...mutation,
    deleteContrat: (id: string, onSuccess?: () => void) =>
      mutation.mutate(
        { id },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: 'Contrat supprimé' });
            onSuccess?.();
          },
          onError: () =>
            toast({ title: 'Échec de la suppression', variant: 'destructive' }),
        },
      ),
  };
}
