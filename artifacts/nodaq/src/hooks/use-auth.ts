import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

export type AuthState =
  | { authenticated: false; role?: never }
  | { authenticated: true; userId: string; email: string; nom: string; tenantId: string; role: string };

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
