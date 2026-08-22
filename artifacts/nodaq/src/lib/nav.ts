import {
  LayoutDashboard,
  Briefcase,
  Repeat,
  Receipt,
  Users,
  Sunrise,
  MessageSquare,
  FileText,
  FolderOpen,
  TrendingUp,
  FileBarChart,
  CalendarClock,
  CalendarCheck,
  Mic,
  Send,
  UserCog,
  Plug2,
  Settings2,
  Hammer,
  FileSpreadsheet,
  Building2,
  DatabaseZap,
  BarChart2,
  Radar,
  ScrollText,
  Landmark,
  LineChart,
  FileClock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { decennaleApplicable, type AffaireWords, type Vertical } from '@nodaq/shared';
import { FINANCIAL_ROLES, type MembershipRole } from '@/hooks/use-auth';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  testId: string;
  /** Si présent, l'entrée est masquée pour les rôles hors de cette liste. */
  requiredRoles?: readonly MembershipRole[];
  /**
   * Si présent, l'entrée n'est visible que pour les verticaux où ce
   * prédicat est vrai. `undefined` (vertical pas encore chargé) est traité
   * comme visible — même doctrine que `verticalizeNavLabel` : les valeurs
   * par défaut avant chargement ne masquent jamais une entrée à tort.
   */
  visibleForVertical?: (vertical: Vertical | undefined) => boolean;
  /**
   * Entrée conservée en MODE SIMPLIFIÉ (US-A8.4) — le strict nécessaire pour
   * faire tourner l'entreprise : devis, facture, heures, et de quoi revenir
   * en arrière.
   *
   * ABSENT = fonction avancée, masquée en mode simplifié. Ce sens-là est
   * délibéré : une entrée ajoutée demain sans que personne n'ait tranché
   * reste masquée. L'inverse ferait repousser le menu complet par
   * inadvertance, chez précisément l'utilisateur qu'on cherchait à ne pas
   * submerger.
   *
   * Rien n'est jamais SUPPRIMÉ : « Afficher toutes les fonctions » lève le
   * filtre à la demande (AC2).
   */
  essentiel?: boolean;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Tableau de bord',
    items: [
      { href: '/',      label: 'Cockpit',     icon: LayoutDashboard, testId: 'nav-cockpit', essentiel: true },
      { href: '/brief', label: 'Brief matin', icon: Sunrise,         testId: 'nav-brief' },
      { href: '/chat',  label: 'Agent IA',    icon: MessageSquare,   testId: 'nav-chat', essentiel: true },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { href: '/affaires',  label: 'Affaires',  icon: Briefcase, testId: 'nav-affaires' },
      { href: '/devis',     label: 'Devis',     icon: FileText,  testId: 'nav-devis', essentiel: true },
      { href: '/contrats',  label: 'Contrats',  icon: Repeat,    testId: 'nav-contrats' },
      { href: '/prospects', label: 'Prospects', icon: Users,     testId: 'nav-prospects' },
      {
        href: '/prospection', label: 'Prospection', icon: Radar, testId: 'nav-prospection',
        // Les 4 sources (BOAMP, sous-traitance BTP, syndics, permis de
        // construire) sont intrinsèquement des signaux de travaux (US-B1.4,
        // module Bâtiment) — pas un besoin générique reformulable par
        // secteur. Réutilise la liste déjà tranchée de `decennaleApplicable`
        // (même famille d'exposition travaux) plutôt que d'en dupliquer une.
        visibleForVertical: (v) => v === undefined || decennaleApplicable(v),
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/factures',   label: 'Factures',         icon: Receipt,       testId: 'nav-factures',   requiredRoles: FINANCIAL_ROLES, essentiel: true },
      { href: '/avoirs',     label: 'Avoirs',           icon: FileText,      testId: 'nav-avoirs',     requiredRoles: FINANCIAL_ROLES },
      { href: '/analytique', label: 'Activité',          icon: BarChart2,     testId: 'nav-analytique' },
      { href: '/pointages',  label: 'Heures',           icon: CalendarCheck, testId: 'nav-pointages', essentiel: true },
      { href: '/marge',      label: 'Marge',            icon: TrendingUp,    testId: 'nav-marge',      requiredRoles: FINANCIAL_ROLES },
      { href: '/rapports',   label: 'Rapports',         icon: FileBarChart,  testId: 'nav-rapports',   requiredRoles: FINANCIAL_ROLES },
      { href: '/echeancier',      label: 'Échéancier fiscal',   icon: CalendarClock,   testId: 'nav-echeancier',      requiredRoles: FINANCIAL_ROLES },
      { href: '/charges-recurrentes', label: 'Charges récurrentes', icon: Landmark,    testId: 'nav-charges-recurrentes', requiredRoles: FINANCIAL_ROLES },
      { href: '/previsionnel-tresorerie', label: 'Prévisionnel',   icon: LineChart,    testId: 'nav-previsionnel-tresorerie', requiredRoles: FINANCIAL_ROLES },
      { href: '/compte-resultat', label: 'Compte de résultat', icon: FileSpreadsheet, testId: 'nav-compte-resultat', requiredRoles: FINANCIAL_ROLES },
      // US-A5.2 — console cabinet. `requiredRoles` ne suffit pas : l'entrée
      // n'a de sens que pour un utilisateur qui a PLUSIEURS espaces, une
      // condition qui ne dépend ni du rôle ni du secteur et qui est donc
      // filtrée dans `app-shell.tsx` (voir `peutVoir`).
      { href: '/cabinet', label: 'Cabinet', icon: Building2, testId: 'nav-cabinet', requiredRoles: FINANCIAL_ROLES },
    ],
  },
  {
    label: 'Documents',
    items: [
      { href: '/classeur', label: 'Classeur', icon: FolderOpen, testId: 'nav-classeur' },
    ],
  },
  {
    label: 'Plateforme',
    items: [
      { href: '/equipe',       label: 'Équipe & plannings', icon: UserCog,  testId: 'nav-equipe',       requiredRoles: ['OWNER'] },
      { href: '/votre-metier', label: 'Votre métier',       icon: Hammer,   testId: 'nav-votre-metier' },
      { href: '/connecteurs',  label: 'Connecteurs',        icon: Plug2,    testId: 'nav-connecteurs',  requiredRoles: ['OWNER'] },
      { href: '/parametres',   label: 'Paramètres',         icon: Settings2, testId: 'nav-parametres',  requiredRoles: ['OWNER'], essentiel: true },
      // Sous-entrée de Paramètres : l'envoi se règle une fois, on n'y revient pas.
      { href: '/parametres/envoi', label: 'Envoi des documents', icon: Send, testId: 'nav-parametres-envoi' },
      { href: '/onboarding',   label: 'Profil entreprise',   icon: Building2,   testId: 'nav-onboarding',  requiredRoles: ['OWNER'] },
      { href: '/reprise',      label: 'Reprise des données', icon: DatabaseZap, testId: 'nav-reprise',     requiredRoles: ['OWNER'] },
      { href: '/facturation-electronique', label: 'Facturation électronique', icon: ScrollText, testId: 'nav-facturation-electronique', requiredRoles: ['OWNER'] },
      // US-A6.4 — pièce à produire en cas de contrôle : c'est l'OWNER qui la
      // produit, pas un collaborateur. Même gating que le routeur serveur.
      { href: '/journal-decisions', label: 'Journal des décisions', icon: FileClock, testId: 'nav-journal-decisions', requiredRoles: ['OWNER'] },
    ],
  },
];

/**
 * Type DÉRIVÉ de `NavItem` plutôt que réécrit : les deux menus partagent les
 * mêmes attributs de visibilité, et une troisième déclaration finirait par
 * diverger — un `essentiel` posé d'un côté, oublié de l'autre.
 */
/**
 * La barre du POUCE — ticket 4.20.
 *
 * Quatre destinations, en bas de l'écran, atteignables sans changer de prise.
 * Quatre et pas quatorze : une bande de quatorze entrées qu'il faut faire
 * défiler horizontalement n'est pas une navigation, c'est une liste cachée —
 * on ne trouve que ce qu'on savait déjà chercher.
 *
 * Le RESTE n'est pas perdu : la cinquième case de la barre ouvre le menu
 * complet (`NAV_SECTIONS`), donc toutes les destinations du bureau sont
 * atteignables au téléphone. C'est ce que vérifie `nav.test.ts`, et c'est le
 * trou que ce ticket ferme : 14 destinations sur 47 auparavant.
 */
export const MOBILE_NAV: Array<
  Pick<NavItem, 'href' | 'label' | 'icon' | 'requiredRoles' | 'essentiel'>
> = [
  { href: '/',             label: 'Cockpit',    icon: LayoutDashboard, essentiel: true },
  // Deuxième position, délibérément. C'était « Devis dicté » ; cet écran a été
  // supprimé au ticket 4.24 et la voix est passée à l'agent unique. La PLACE
  // reste celle de la fonction sur laquelle repose le produit — l'artisan qui
  // la veut est sur un chantier, avec son téléphone.
  { href: '/chat',         label: 'Agent IA',   icon: MessageSquare, essentiel: true },
  { href: '/affaires',     label: 'Affaires',   icon: Briefcase },
  { href: '/pointages',    label: 'Heures',     icon: CalendarCheck, essentiel: true },
];

/**
 * Toutes les destinations atteignables depuis un téléphone.
 *
 * Exportée pour que la garde de parité lise EXACTEMENT ce que la coquille
 * rend : une garde qui recompose la liste de son côté finit par vérifier une
 * autre application que celle qu'on livre.
 */
export function destinationsMobiles(): string[] {
  return [
    ...MOBILE_NAV.map((item) => item.href),
    ...NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.href)),
  ];
}

/** Returns true when the given nav href matches the current location. */
export function navIsActive(href: string, location: string): boolean {
  return href === '/' ? location === '/' : location.startsWith(href);
}

/**
 * Libellé d'une entrée de menu, adapté au vocabulaire du secteur (US-A1.1).
 *
 * Volontairement limité aux DEUX entrées dont le libellé EST le nom générique
 * de l'entité (« Affaires », « Devis ») — pas aux fonctionnalités qui portent
 * leur propre nom construit (« Devis dicté », « Avoirs », « Contrats ») : leur
 * renommage poserait des questions de grammaire (accord de genre sur
 * `proposalWord`) que ce ticket ne tranche pas — voir `verticalPacks.ts`.
 * `NAV_SECTIONS`/`MOBILE_NAV` gardent leurs libellés BTP par défaut : ce sont
 * les repères que la garde `nav.test.ts` lit textuellement, et les valeurs
 * affichées avant que `useVertical()` ait chargé.
 */
export function verticalizeNavLabel(
  href: string,
  label: string,
  words: AffaireWords,
  proposalWord: string,
): string {
  if (href === '/affaires') return words.plural.charAt(0).toUpperCase() + words.plural.slice(1);
  if (href === '/devis') return proposalWord;
  return label;
}
