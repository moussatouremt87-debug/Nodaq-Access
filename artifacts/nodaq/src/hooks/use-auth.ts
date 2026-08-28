import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

/**
 * Miroir de `MembershipRole`/`FINANCIAL_ROLES` (`lib/shared/src/index.ts`) —
 * pas importé depuis `@nodaq/shared` : le frontend n'a pas cette dépendance
 * aujourd'hui (patron déjà suivi ailleurs, ex. `status-badge.tsx`, qui
 * reredéclare les statuts backend plutôt que d'importer le paquet partagé).
 * Garder les deux synchronisés si l'un change.
 */
export type MembershipRole = 'OWNER' | 'MEMBER' | 'ACCOUNTANT' | 'VIEWER';
export const FINANCIAL_ROLES: readonly MembershipRole[] = ['OWNER', 'ACCOUNTANT', 'VIEWER'];

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

/** Les rôles qui voient les données financières — MEMBER excepté. */
export function useHasFinancialAccess() {
  const { data } = useAuth();
  return data?.authenticated === true && 'role' in data && FINANCIAL_ROLES.includes(data.role);
}

/**
 * Tiers de confiance en lecture seule (US-A5.4) — un banquier qui instruit un
 * dossier de prêt. Sert à MASQUER les commandes d'écriture : le refus, lui,
 * vient du serveur (`middleware/lectureSeule.ts`), qui reste seul juge. Ce
 * hook évite simplement de proposer un bouton dont on sait qu'il échouera.
 */
export function useLectureSeule() {
  const { data } = useAuth();
  return data?.authenticated === true && 'role' in data && data.role === 'VIEWER';
}

/**
 * Sortir de sa session.
 *
 * `POST /api/auth/logout` (`routes/auth.ts`) existait depuis le premier lot :
 * il supprime la session en base ET efface le cookie signé. Ce qui manquait
 * était le chemin pour l'appeler — l'interface n'offrait aucune sortie.
 *
 * `queryClient.clear()` et pas `invalidateQueries` : invalider REFAIT les
 * requêtes, donc rejoue tout le tableau de bord du compte qu'on vient de
 * quitter et laisse ses montants à l'écran le temps des 401. Vider jette les
 * données du cache sur-le-champ. Sur un téléphone prêté ou un poste d'atelier
 * partagé, c'est la différence entre une déconnexion et une apparence de
 * déconnexion.
 *
 * La navigation reste au composant appelant : ce hook ne sait pas d'où il est
 * invoqué, et un `window.location` ici rendrait le comportement intestable.
 */
export function useDeconnexion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/api/auth/logout', { method: 'POST' });
      // Le serveur répond `{ ok: true }` même quand la session avait déjà
      // expiré : il n'y a donc pas de cas « déjà déconnecté » à traiter à
      // part. Un échec ici est un vrai échec (réseau, 5xx).
      if (!res.ok) throw new Error('Déconnexion impossible');
      return res.json() as Promise<{ ok: true }>;
    },
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
