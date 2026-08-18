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
import { tempsGagneSecondes, formaterTempsGagne } from '@nodaq/shared';

/**
 * Les opérations que l'action validée portait, lues depuis son `payload`.
 *
 * Le typage généré ne décrit pas la forme du plan (c'est un `jsonb` libre
 * côté base) : on la sonde défensivement plutôt que d'imposer un cast — une
 * réponse inattendue doit donner « aucun gain affiché », jamais une erreur
 * dans un toast de confirmation.
 */
function operationsDe(reponse: unknown): { type: string }[] {
  const payload = (reponse as { payload?: unknown } | undefined)?.payload;
  const ops = (payload as { operations?: unknown } | undefined)?.operations;
  if (!Array.isArray(ops)) return [];
  return ops.filter(
    (o): o is { type: string } =>
      typeof o === 'object' && o !== null && typeof (o as { type?: unknown }).type === 'string',
  );
}

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
          onSuccess: (reponse) => {
            queryClient.invalidateQueries({
              queryKey: getListPendingActionsQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: getGetCockpitKpisQueryKey(),
            });
            queryClient.invalidateQueries({
              queryKey: getGetCockpitActivityQueryKey(),
            });
            // US-A6.5 — le gain va en DESCRIPTION du toast existant, pas dans
            // une modale ni une animation : le point d'attention de la story
            // interdit de détourner l'attention du panneau de validation
            // lui-même (US-A6.2). `formaterTempsGagne` rend `null` pour zéro,
            // et on n'affiche alors rien plutôt que « 0 min gagnées ».
            const gagne = formaterTempsGagne(
              tempsGagneSecondes(operationsDe(reponse)),
            );
            toast({
              title: 'Action approuvée',
              ...(gagne ? { description: `≈ ${gagne} de saisie évitée` } : {}),
            });
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
