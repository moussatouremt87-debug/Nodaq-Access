/**
 * Abonnement du compte — l'état que l'écran Réglages → Abonnement affiche.
 *
 * Les PRIX viennent du serveur (table `plans`, seedée par migration) : rien
 * n'est écrit en dur ici — la grille interdit de coder un prix hors du seed.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

const API = '/api';

export interface PlanTarif {
  id: string;
  libelle: string;
  prixMensuelCents: number;
  prixAnnuelCents: number | null;
  utilisateursInclus: number;
  prixUtilisateurSuppCents: number | null;
  /** Module vocal : dossiers de relance inclus — un dossier = un impayé
   *  relancé dans le mois, jamais une tentative d'appel (4.43). */
  dossiersInclus: number;
  prixDossierSuppCents: number | null;
  whatsappConversationsIncluses: number;
}

export interface EtatAbonnement {
  plan: PlanTarif;
  moduleVocal: PlanTarif | null;
  subscription: {
    statut: 'TRIAL' | 'ACTIVE' | 'READONLY' | 'EN_ATTENTE';
    periodicite: 'MENSUEL' | 'ANNUEL';
    trialEndsAt: string | null;
    priceLockedAt: string | null;
    planSuivant: string | null;
    echeance: string | null;
    moduleVocal: boolean;
  };
  statut: 'TRIAL' | 'ACTIVE' | 'READONLY' | 'EN_ATTENTE';
  utilisateurs: {
    actifs: number;
    inclus: number;
    supplementaires: number;
    prixSupplementaireCents: number | null;
  };
  dossiers: {
    utilises: number;
    inclus: number;
    depassement: number;
    prixDepassementCents: number;
    mois: string;
  } | null;
  essai: { joursRestants: number; demanderCarte: boolean } | null;
  fondateurs: { totales: number; prises: number; ouverte: boolean };
  plans: PlanTarif[];
}

export function useAbonnement() {
  return useQuery<EtatAbonnement>({
    queryKey: ['abonnement'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/abonnement`);
      if (!r.ok) throw new Error("Chargement de l'abonnement impossible");
      return r.json();
    },
  });
}

async function poster(chemin: string, corps: unknown): Promise<EtatAbonnement> {
  const r = await apiFetch(`${API}${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((json as { error?: string }).error ?? 'Enregistrement impossible');
    (err as Error & { confirmationRequise?: string }).confirmationRequise = (
      json as { confirmationRequise?: string }
    ).confirmationRequise;
    throw err;
  }
  return json as EtatAbonnement;
}

export function useChangerFormule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corps: {
      planId: string;
      periodicite?: 'MENSUEL' | 'ANNUEL';
      confirmeAbandonFondateurs?: boolean;
    }) => poster('/abonnement/formule', corps),
    onSuccess: () => {
      // La lecture seule et les limites d'invitation dépendent de cet état.
      void qc.invalidateQueries({ queryKey: ['abonnement'] });
    },
  });
}

export function useBasculerModuleVocal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actif: boolean) => poster('/abonnement/module-vocal', { actif }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['abonnement'] }),
  });
}

export function euros(cents: number): string {
  const entier = cents % 100 === 0;
  return (cents / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: entier ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
