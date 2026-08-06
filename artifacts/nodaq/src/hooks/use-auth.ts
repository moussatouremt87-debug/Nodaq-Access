import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

export function useAuth() {
  return useQuery<{ authenticated: boolean }>({
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
