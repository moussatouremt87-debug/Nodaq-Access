/**
 * Le secteur d'activité du tenant, et le vocabulaire qui va avec (US-A1.1).
 *
 * `verticalPacks.ts` (@nodaq/shared) porte les mots ; ce hook est le seul
 * point d'entrée pour les lire depuis une page — comme `affaireWords()` côté
 * serveur, aucune page ne doit indexer `VERTICAL_PACKS` à la main.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { affaireWords, verticalPack, verticalChoices, type AffaireWords, type Vertical } from '@nodaq/shared';
import { apiFetch } from '@/lib/auth';

const API = '/api';
const QUERY_KEY = ['votre-metier'];

type MetierData = { metier: string };

async function fetchMetier(): Promise<MetierData> {
  const res = await apiFetch(`${API}/votre-metier`);
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

export function useVertical() {
  const { data, isLoading } = useQuery<MetierData>({
    queryKey: QUERY_KEY,
    queryFn: fetchMetier,
  });

  const vertical = data?.metier;
  const words: AffaireWords = affaireWords(vertical);
  const pack = verticalPack(vertical);
  const proposalWord = pack.proposalWord;
  // US-A3.1 : délai de paiement usuel du secteur, en jours (0 = comptant).
  // Déjà disponible côté client — `verticalPack` est isomorphe, pas de route
  // réseau supplémentaire.
  const delaiPaiementUsuelJours = pack.delaiPaiementUsuelJours;
  // US-A4.3 : mot du prestataire externe (sous-traitant/freelance/extra/
  // intérimaire selon le secteur) — coûté, jamais compté dans la capacité RH.
  const externalWorkerWords = pack.externalWorkerWords;

  return { vertical, words, proposalWord, delaiPaiementUsuelJours, externalWorkerWords, isLoading };
}

export function useUpdateVerticalMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (metier: Vertical) => {
      const res = await apiFetch(`${API}/votre-metier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metier }),
      });
      if (!res.ok) throw new Error('Sauvegarde échouée');
      return res.json() as Promise<MetierData>;
    },
    onSuccess: (d) => {
      qc.setQueryData(QUERY_KEY, d);
    },
  });
  return { ...mutation, updateVertical: mutation.mutate };
}

/** Les 9 secteurs minimum de l'onboarding (US-A1.1) — un sous-ensemble
 *  curaté de `verticalChoices()`, pas les 17 valeurs complètes : le reste
 *  (verticaux ADR-007 plus fins, ancien découpage) reste accessible depuis
 *  l'écran de réglages avancés « Votre métier », pas dès la première
 *  question posée à un nouvel utilisateur. */
export function secteursOnboarding() {
  const { cible, ancien } = verticalChoices();
  // `retail` (commerce) reste classé « ancien découpage » côté réglages
  // (inTarget: false, décision assumée — voir verticalPacks.ts) mais fait
  // partie des 9 secteurs que CETTE liste doit couvrir : chercher dans les
  // deux groupes, pas seulement « cible ».
  const retenus = [
    'batiment', 'retail', 'restauration_chr', 'services_personne',
    'professions_liberales', 'artisanat_service', 'services_entreprises',
    'transport', 'sante_liberale',
    // US-A1.4 — la porte de sortie, en DERNIER. Sans elle, un fleuriste, un
    // agriculteur ou un photographe ne trouve pas son métier : il en choisit
    // un autre au hasard, ou passe l'écran — et le défaut serveur le range
    // alors en `industrie_btp`. Le rebond que US-A1.1 corrige à cet écran
    // revenait donc à l'écran suivant, sous une autre forme.
    'autre',
  ];
  const tous = [...cible, ...ancien];
  return retenus
    .map(id => tous.find(c => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c != null);
}
