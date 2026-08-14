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

/**
 * MFA (ticket 4.15) — trois états pour OWNER/ACCOUNTANT, un seul pour MEMBER.
 * Volontairement minimal tant que le second facteur n'est pas prouvé : ni
 * `role` ni `tenantId` ni `email` — miroir exact de `GET /api/auth/me`
 * (`routes/auth.ts`), qui ne les rend pas non plus dans ces deux états.
 */
export type AuthState =
  | { authenticated: false }
  | { authenticated: true; mfaStatus: 'enroll_required' | 'verify_required' }
  | {
      authenticated: true;
      mfaStatus: 'verified' | 'not_required';
      userId: string;
      email: string;
      nom: string;
      tenantId: string;
      role: MembershipRole;
    };

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
  return data?.authenticated === true && 'role' in data && data.role === 'OWNER';
}

/** OWNER ou ACCOUNTANT — les deux rôles qui voient les données financières. */
export function useHasFinancialAccess() {
  const { data } = useAuth();
  return data?.authenticated === true && 'role' in data && FINANCIAL_ROLES.includes(data.role);
}
