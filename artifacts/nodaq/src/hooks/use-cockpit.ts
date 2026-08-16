import {
  useGetCockpitKpis,
  useGetCockpitActivity,
  useListPendingActions,
  useApprovePendingAction,
  useRejectPendingAction,
  getGetCockpitKpisQueryKey,
  getGetCockpitActivityQueryKey,
  getListPendingActionsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export function useCockpitKpis() {
  return useGetCockpitKpis();
}

export function useCockpitActivity() {
  return useGetCockpitActivity();
}

/**
 * US-A6.2 — le panneau "Actions à valider" est un pilier de sécurité (CLAUDE.md
 * §4 : écriture agentique = validation humaine). La config globale du
 * QueryClient (App.tsx) désactive `retry` et `refetchOnWindowFocus` : sans
 * override ICI, un seul échec transitoire (401 le temps que la session se
 * propage, hoquet réseau) laisse `data` à `undefined` indéfiniment, et le
 * panneau affiche silencieusement "Rien à valider" — indiscernable d'un vide
 * réel. Retry scoped à CETTE requête, pas au QueryClient global.
 */
export function usePendingActions() {
  return useListPendingActions({
    query: { queryKey: getListPendingActionsQueryKey(), retry: 2 },
  });
}

export function useApproveAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useApprovePendingAction();
  return {
    ...mutation,
    approve: (id: string, note?: string) =>
      mutation.mutate(
        { id, data: { note } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getListPendingActionsQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: getGetCockpitKpisQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: getGetCockpitActivityQueryKey(),
            });
            toast({ title: 'Action approuvée' });
          },
          onError: () => {
            toast({
              title: "Impossible d'approuver cette action",
              variant: 'destructive',
            });
          },
        },
      ),
  };
}

export function useRejectAction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useRejectPendingAction();
  return {
    ...mutation,
    reject: (id: string, note?: string) =>
      mutation.mutate(
        { id, data: { note } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getListPendingActionsQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: getGetCockpitKpisQueryKey(),
            });
            toast({ title: 'Action rejetée' });
          },
          onError: () => {
            toast({
              title: 'Impossible de rejeter cette action',
              variant: 'destructive',
            });
          },
        },
      ),
  };
}
