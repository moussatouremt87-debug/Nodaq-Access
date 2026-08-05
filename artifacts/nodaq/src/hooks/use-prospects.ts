import {
  useListProspects,
  useCreateProspect,
  useUpdateProspect,
  useDeleteProspect,
  getListProspectsQueryKey,
  getGetCockpitKpisQueryKey,
  type ListProspectsParams,
  type ProspectInput,
  type ProspectUpdate,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export function useProspects(params?: ListProspectsParams) {
  return useListProspects(params);
}

function useInvalidateProspects() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: getListProspectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCockpitKpisQueryKey() });
  };
}

export function useCreateProspectMutation() {
  const invalidate = useInvalidateProspects();
  const { toast } = useToast();
  const mutation = useCreateProspect();
  return {
    ...mutation,
    createProspect: (data: ProspectInput, onSuccess?: () => void) =>
      mutation.mutate(
        { data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: 'Prospect ajouté' });
            onSuccess?.();
          },
          onError: () =>
            toast({
              title: "Échec de l'ajout du prospect",
              variant: 'destructive',
            }),
        },
      ),
  };
}

export function useUpdateProspectMutation() {
  const invalidate = useInvalidateProspects();
  const { toast } = useToast();
  const mutation = useUpdateProspect();
  return {
    ...mutation,
    updateProspect: (
      id: string,
      data: ProspectUpdate,
      onSuccess?: () => void,
    ) =>
      mutation.mutate(
        { id, data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: 'Prospect mis à jour' });
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

export function useDeleteProspectMutation() {
  const invalidate = useInvalidateProspects();
  const { toast } = useToast();
  const mutation = useDeleteProspect();
  return {
    ...mutation,
    deleteProspect: (id: string, onSuccess?: () => void) =>
      mutation.mutate(
        { id },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: 'Prospect supprimé' });
            onSuccess?.();
          },
          onError: () =>
            toast({ title: 'Échec de la suppression', variant: 'destructive' }),
        },
      ),
  };
}
