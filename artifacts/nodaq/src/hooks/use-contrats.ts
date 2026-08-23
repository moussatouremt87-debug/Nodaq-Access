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
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';
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

/**
 * Facturer les échéances dues d'un contrat récurrent — US-A2.3.
 *
 * ── Ce que ce bouton fait, et ce qu'il ne fait pas ────────────────────────
 * Il MATÉRIALISE en brouillons les échéances échues et pas encore facturées,
 * y compris celles de plusieurs mois en arrière. Il n'envoie rien : l'émission
 * reste le geste délibéré qu'elle a toujours été, et c'est la chaîne de
 * validation humaine que la story demande.
 *
 * Cliquer deux fois ne facture pas deux fois — l'index unique de la base s'en
 * charge, et la seconde réponse dit simplement « déjà facturées ».
 */
export function useFacturerEcheances() {
  const invalidate = useInvalidateContrats();
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: async (contratId?: string) => {
      const r = await apiFetch('/api/contrats/facturer-echeances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contratId ? { contratId } : {}),
      });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as {
        creees: number;
        dejaFacturees: number;
        ecartes: { contratId: string; motif: string }[];
      };
    },
    onSuccess: (d) => {
      invalidate();
      if (d.creees === 0) {
        // Un succès muet laisserait croire à une panne. Dire « rien à
        // facturer » est une réponse ; ne rien dire n'en est pas une.
        toast({
          title: d.ecartes.length > 0 ? 'Rien n\'a pu être facturé' : 'Aucune échéance à facturer',
          description: d.ecartes[0]?.motif ?? 'Tous vos contrats sont à jour.',
          ...(d.ecartes.length > 0 ? { variant: 'destructive' as const } : {}),
        });
        return;
      }
      toast({
        title: d.creees === 1 ? '1 facture créée' : `${d.creees} factures créées`,
        description: 'En brouillon, dans Factures. Rien n\'est encore envoyé — relisez avant d\'émettre.',
      });
    },
    onError: () =>
      toast({ title: 'Échec de la facturation des échéances', variant: 'destructive' }),
  });
  return {
    ...mutation,
    facturerEcheances: (contratId?: string) => mutation.mutate(contratId),
  };
}
