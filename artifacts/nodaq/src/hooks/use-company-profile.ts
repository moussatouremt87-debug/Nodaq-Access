/**
 * Le profil entreprise du tenant (US-A1.3) — un seul point d'entrée pour
 * `GET /api/onboarding/profil`, dont `cockpit.tsx` avait déjà sa propre
 * copie (`useProfilIncomplet`) sous la même `queryKey`. Fusionné ici pour
 * qu'un seul cache React Query serve les deux besoins (profil incomplet,
 * franchise TVA) plutôt que deux requêtes indépendantes vers la même route.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

const API = '/api';
export const COMPANY_PROFILE_QUERY_KEY = ['onboarding-profil'];

async function fetchProfil(): Promise<Record<string, string>> {
  const res = await apiFetch(`${API}/onboarding/profil`);
  if (!res.ok) return {};
  const { profile } = await res.json() as { profile: Record<string, string> };
  return profile;
}

export function useCompanyProfile() {
  const { data: profile, isLoading } = useQuery({
    queryKey: COMPANY_PROFILE_QUERY_KEY,
    queryFn: fetchProfil,
    staleTime: 1000 * 60 * 5,
  });

  return {
    profile,
    isLoading,
    /** SIRET absent = profil pas encore renseigné. */
    incomplete: !profile?.['company.siret'],
    /** Franchise en base de TVA, art. 293 B CGI — déclaré, jamais deviné. */
    tvaFranchise: profile?.['company.tva_franchise'] === 'true',
  };
}
