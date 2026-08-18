/**
 * État des modules du tenant — lecture partagée par la navigation et l'écran
 * de réglage.
 *
 * La coquille interroge cette route à chaque rendu de menu : elle est donc
 * mise en cache comme les autres réglages qui bougent rarement. Une valeur
 * périmée de quelques minutes sur un module allumé la veille est sans
 * conséquence ; une requête par navigation, elle, se verrait.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

const API = '/api';

export interface ModuleResolu {
  id: string;
  title: string;
  description: string;
  href?: string;
  tools: readonly string[];
  active: boolean;
  source: 'defaut_vertical' | 'hors_socle' | 'choix';
}

export function useModules() {
  return useQuery<ModuleResolu[]>({
    queryKey: ['modules'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/modules`);
      if (!r.ok) throw new Error('Chargement des modules impossible');
      return (await r.json()).modules as ModuleResolu[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useBasculerModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (choix: Record<string, boolean>) => {
      const r = await apiFetch(`${API}/modules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choix }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Enregistrement impossible');
      }
      return (await r.json()).modules as ModuleResolu[];
    },
    onSuccess: () => {
      // La navigation dépend de cet état : sans invalidation, l'écran
      // enregistrerait le choix sans que le menu ne bouge, et l'utilisateur
      // croirait que rien ne s'est passé.
      void qc.invalidateQueries({ queryKey: ['modules'] });
    },
  });
}

/**
 * Les chemins masqués parce que leur module est éteint.
 *
 * Rendue depuis l'état SERVEUR, jamais recalculée côté client à partir du
 * catalogue : le défaut d'un module dépend du secteur du tenant, et deux
 * résolutions indépendantes finiraient par diverger.
 */
export function cheminsDeModulesEteints(modules: ModuleResolu[] | undefined): Set<string> {
  const masques = new Set<string>();
  for (const m of modules ?? []) {
    if (!m.active && m.href) masques.add(m.href);
  }
  return masques;
}
