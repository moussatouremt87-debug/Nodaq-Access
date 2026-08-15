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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AffaireWords } from '@nodaq/shared';
import { FINANCIAL_ROLES, type MembershipRole } from '@/hooks/use-auth';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  testId: string;
  /** Si présent, l'entrée est masquée pour les rôles hors de cette liste. */
  requiredRoles?: readonly MembershipRole[];
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Tableau de bord',
    items: [
      { href: '/',      label: 'Cockpit',     icon: LayoutDashboard, testId: 'nav-cockpit' },
      { href: '/brief', label: 'Brief matin', icon: Sunrise,         testId: 'nav-brief' },
      { href: '/chat',  label: 'Agent IA',    icon: MessageSquare,   testId: 'nav-chat' },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { href: '/affaires',  label: 'Affaires',  icon: Briefcase, testId: 'nav-affaires' },
      { href: '/devis',     label: 'Devis',     icon: FileText,  testId: 'nav-devis' },
      { href: '/contrats',  label: 'Contrats',  icon: Repeat,    testId: 'nav-contrats' },
      { href: '/prospects', label: 'Prospects', icon: Users,     testId: 'nav-prospects' },
      { href: '/prospection', label: 'Prospection', icon: Radar, testId: 'nav-prospection' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/factures',   label: 'Factures',         icon: Receipt,       testId: 'nav-factures',   requiredRoles: FINANCIAL_ROLES },
      { href: '/avoirs',     label: 'Avoirs',           icon: FileText,      testId: 'nav-avoirs',     requiredRoles: FINANCIAL_ROLES },
      { href: '/analytique', label: 'Activité',          icon: BarChart2,     testId: 'nav-analytique' },
      { href: '/pointages',  label: 'Heures',           icon: CalendarCheck, testId: 'nav-pointages' },
      { href: '/devis/dictee', label: 'Devis dicté',    icon: Mic,           testId: 'nav-devis-dictee' },
      { href: '/marge',      label: 'Marge',            icon: TrendingUp,    testId: 'nav-marge',      requiredRoles: FINANCIAL_ROLES },
      { href: '/rapports',   label: 'Rapports',         icon: FileBarChart,  testId: 'nav-rapports',   requiredRoles: FINANCIAL_ROLES },
      { href: '/echeancier',      label: 'Échéancier fiscal',   icon: CalendarClock,   testId: 'nav-echeancier',      requiredRoles: FINANCIAL_ROLES },
      { href: '/compte-resultat', label: 'Compte de résultat', icon: FileSpreadsheet, testId: 'nav-compte-resultat', requiredRoles: FINANCIAL_ROLES },
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
      { href: '/parametres',   label: 'Paramètres',         icon: Settings2, testId: 'nav-parametres',  requiredRoles: ['OWNER'] },
      // Sous-entrée de Paramètres : l'envoi se règle une fois, on n'y revient pas.
      { href: '/parametres/envoi', label: 'Envoi des documents', icon: Send, testId: 'nav-parametres-envoi' },
      { href: '/onboarding',   label: 'Profil entreprise',   icon: Building2,   testId: 'nav-onboarding',  requiredRoles: ['OWNER'] },
      { href: '/reprise',      label: 'Reprise des données', icon: DatabaseZap, testId: 'nav-reprise',     requiredRoles: ['OWNER'] },
      { href: '/facturation-electronique', label: 'Facturation électronique', icon: ScrollText, testId: 'nav-facturation-electronique', requiredRoles: ['OWNER'] },
    ],
  },
];

export const MOBILE_NAV: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  requiredRoles?: readonly MembershipRole[];
}> = [
  { href: '/',             label: 'Cockpit',    icon: LayoutDashboard },
  // Deuxième position, délibérément : le devis dicté est la fonction sur
  // laquelle repose le produit, et l'artisan qui la veut est justement celui
  // qui est sur un chantier avec son téléphone.
  { href: '/devis/dictee', label: 'Devis dicté', icon: Mic },
  { href: '/affaires',     label: 'Affaires',   icon: Briefcase },
  { href: '/devis',        label: 'Devis',      icon: FileText },
  { href: '/factures',     label: 'Factures',   icon: Receipt,      requiredRoles: FINANCIAL_ROLES },
  { href: '/pointages',    label: 'Heures',     icon: CalendarCheck },
  { href: '/marge',        label: 'Marge',      icon: TrendingUp,   requiredRoles: FINANCIAL_ROLES },
  { href: '/echeancier',   label: 'Fiscal',     icon: CalendarClock, requiredRoles: FINANCIAL_ROLES },
  { href: '/classeur',     label: 'Classeur',   icon: FolderOpen },
  { href: '/chat',         label: 'Agent IA',   icon: MessageSquare },
  // Plateforme screens (auth-gated at route level)
  { href: '/equipe',       label: 'Équipe',     icon: UserCog,      requiredRoles: ['OWNER'] },
  { href: '/votre-metier', label: 'Métier',     icon: Hammer },
  { href: '/connecteurs',  label: 'Connecteurs', icon: Plug2,       requiredRoles: ['OWNER'] },
  { href: '/parametres',   label: 'Paramètres', icon: Settings2,    requiredRoles: ['OWNER'] },
];

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
