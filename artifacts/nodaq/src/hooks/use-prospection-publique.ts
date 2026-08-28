/**
 * Signaux publics de prospection — BOAMP, DECP, RNIC, permis de construire.
 *
 * Aucun client généré pour `/prospection/*` : patron `use-analytics.ts`,
 * `apiFetch` direct. Chaque source a son propre hook — une section ne dépend
 * jamais de l'état d'une autre.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/auth';

interface SourcePublique {
  label: string;
  url: string;
}

interface Marche {
  objet: string | null;
  acheteur: string | null;
  cpv: string[];
  departements: string[];
  adresse: string | null;
  dateLimiteReponse: string | null;
  natureProcedure: string | null;
  source: SourcePublique;
}

export interface ReponseAppelsOffres {
  marches: Marche[];
  avertissement: string;
  raisonSilence: 'aucune_source' | 'zone_absente' | null;
  messageSilence: string | null;
}

export function useAppelsOffres() {
  return useQuery({
    queryKey: ['prospection', 'appels-offres'],
    queryFn: async (): Promise<ReponseAppelsOffres> => {
      const res = await apiFetch('/api/prospection/appels-offres');
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

interface AgregatSousTraitance {
  secteur: string;
  zone: string;
  occurrences: number;
}

interface Titulaire {
  titulaireSiren: string | null;
  titulaireNom: string | null;
  secteur: string | null;
  zone: string | null;
  montant: number | null;
  dateNotification: string | null;
  objet: string | null;
  source: SourcePublique;
}

export interface ReponseSousTraitance {
  agregats: AgregatSousTraitance[];
  titulairesProfessionnels: Titulaire[];
  seuilAnonymat: number;
  agregatsTus: number;
  avertissement: string;
  raisonSilence: 'aucune_source' | 'zone_absente' | null;
  messageSilence: string | null;
}

export function useSousTraitance() {
  return useQuery({
    queryKey: ['prospection', 'sous-traitance'],
    queryFn: async (): Promise<ReponseSousTraitance> => {
      const res = await apiFetch('/api/prospection/sous-traitance');
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

interface AgregatSyndics {
  commune: string;
  occurrences: number;
}

interface SyndicProfessionnel {
  commune: string | null;
  codePostal: string | null;
  nomSyndic: string | null;
  syndicProfessionnel: boolean;
  source: SourcePublique;
}

export interface ReponseSyndics {
  agregats: AgregatSyndics[];
  syndicsProfessionnels: SyndicProfessionnel[];
  seuilAnonymat: number;
  agregatsTus: number;
  avertissement: string;
  raisonSilence: 'aucune_source' | 'zone_absente' | null;
  messageSilence: string | null;
}

export function useSyndics() {
  return useQuery({
    queryKey: ['prospection', 'syndics'],
    queryFn: async (): Promise<ReponseSyndics> => {
      const res = await apiFetch('/api/prospection/syndics');
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

interface PisteProfessionnelle {
  numero: string | null;
  nature: string | null;
  nomDemandeur: string | null;
  demandeurPersonneMorale: boolean;
  adresse: string | null;
  codePostal: string | null;
  commune: string | null;
  dateOctroi: string | null;
  superficieTerrain: number | null;
  source: SourcePublique;
}

/**
 * Un permis dont le demandeur est un PARTICULIER.
 *
 * `nomDemandeur` est presque toujours `null` : la base Sitadel anonymise les
 * personnes physiques — mesuré, 44 enregistrements sur 100 n'en portent
 * aucun. Le champ reste déclaré parce qu'un republieur pourrait en fournir
 * un, mais l'écran ne doit JAMAIS s'appuyer dessus pour identifier la ligne :
 * c'est l'ADRESSE des travaux qui la nomme.
 */
interface InformationParticulier {
  nomDemandeur: string | null;
  adresse: string | null;
  codePostal: string | null;
  commune: string | null;
  dateOctroi: string | null;
  nature: string | null;
  superficieTerrain: number | null;
  /**
   * La source, PAR LIGNE.
   *
   * Elle se déduisait auparavant de la première piste professionnelle — or
   * ces pistes sont derrière `PERMIS_AFFICHER_PISTES_PRO`, désactivé en
   * production : le panneau affichait alors un lien vide sous « Source ».
   */
  source: SourcePublique;
}

export interface ReponsePermis {
  pistesProfessionnelles: PisteProfessionnelle[];
  informationsParticuliers: InformationParticulier[];
  avertissement: string;
  raisonSilence: 'aucune_source' | 'zone_absente' | null;
  messageSilence: string | null;
}

export function usePermisConstruire() {
  return useQuery({
    queryKey: ['prospection', 'permis'],
    queryFn: async (): Promise<ReponsePermis> => {
      const res = await apiFetch('/api/prospection/permis');
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}
