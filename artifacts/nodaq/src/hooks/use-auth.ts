import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

/**
 * Miroir de `MembershipRole`/`FINANCIAL_ROLES` (`lib/shared/src/index.ts`) —
 * pas importé depuis `@nodaq/shared` : le frontend n'a pas cette dépendance
 * aujourd'hui (patron déjà suivi ailleurs, ex. `status-badge.tsx`, qui
 * reredéclare les statuts backend plutôt que d'importer le paquet partagé).
 * Garder les deux synchronisés si l'un change.
 */
export type MembershipRole = 'OWNER' | 'MEMBER' | 'ACCOUNTANT';
export const FINANCIAL_ROLES: readonly MembershipRole[] = ['OWNER', 'ACCOUNTANT'];

export type AuthState =
  | { authenticated: false; role?: never }
  | { authenticated: true; userId: string; email: string; nom: string; tenantId: string; role: MembershipRole };

export function useAuth() {
  return useQuery<AuthState>({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const res = await apiFetch('/api/auth/me');
      if (res.status === 401) return { authenticated: false };
      if (!res.ok) throw new Error('Auth check failed');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** Returns true iff the current authenticated user holds the OWNER role. */
export function useIsOwner() {
  const { data } = useAuth();
  return data?.authenticated === true && data.role === 'OWNER';
}

/** OWNER ou ACCOUNTANT — les deux rôles qui voient les données financières. */
export function useHasFinancialAccess() {
  const { data } = useAuth();
  return data?.authenticated === true && FINANCIAL_ROLES.includes(data.role);
}
