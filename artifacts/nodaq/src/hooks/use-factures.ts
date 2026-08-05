import {
  useListFactures,
  useCreateFacture,
  useUpdateFacture,
  getListFacturesQueryKey,
  getGetCockpitKpisQueryKey,
  type ListFacturesParams,
  type FactureInput,
  type FactureUpdate,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export function useFactures(params?: ListFacturesParams) {
  return useListFactures(params);
}

function useInvalidateFactures() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: getListFacturesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCockpitKpisQueryKey() });
  };
}

export function useCreateFactureMutation() {
  const invalidate = useInvalidateFactures();
  const { toast } = useToast();
  const mutation = useCreateFacture();
  return {
    ...mutation,
    createFacture: (data: FactureInput, onSuccess?: () => void) =>
      mutation.mutate(
        { data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: 'Facture créée' });
            onSuccess?.();
          },
          onError: () =>
            toast({
              title: 'Échec de la création de la facture',
              variant: 'destructive',
            }),
        },
      ),
  };
}

export function useUpdateFactureMutation() {
  const invalidate = useInvalidateFactures();
  const { toast } = useToast();
  const mutation = useUpdateFacture();
  return {
    ...mutation,
    updateFacture: (
      id: string,
      data: FactureUpdate,
      onSuccess?: () => void,
    ) =>
      mutation.mutate(
        { id, data },
        {
          onSuccess: () => {
            invalidate();
            toast({ title: 'Facture mise à jour' });
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
