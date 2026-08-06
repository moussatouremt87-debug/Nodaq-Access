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
  UserCog,
  Plug2,
  Settings2,
  Hammer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  testId: string;
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
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/factures',   label: 'Factures',         icon: Receipt,       testId: 'nav-factures' },
      { href: '/marge',      label: 'Marge',            icon: TrendingUp,    testId: 'nav-marge' },
      { href: '/rapports',   label: 'Rapports',         icon: FileBarChart,  testId: 'nav-rapports' },
      { href: '/echeancier', label: 'Échéancier fiscal', icon: CalendarClock, testId: 'nav-echeancier' },
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
      { href: '/equipe',       label: 'Équipe & plannings', icon: UserCog,  testId: 'nav-equipe' },
      { href: '/votre-metier', label: 'Votre métier',       icon: Hammer,   testId: 'nav-votre-metier' },
      { href: '/connecteurs',  label: 'Connecteurs',        icon: Plug2,    testId: 'nav-connecteurs' },
      { href: '/parametres',   label: 'Paramètres',         icon: Settings2, testId: 'nav-parametres' },
    ],
  },
];

export const MOBILE_NAV = [
  { href: '/',          label: 'Cockpit',   icon: LayoutDashboard },
  { href: '/affaires',  label: 'Affaires',  icon: Briefcase },
  { href: '/devis',     label: 'Devis',     icon: FileText },
  { href: '/factures',  label: 'Factures',  icon: Receipt },
  { href: '/marge',     label: 'Marge',     icon: TrendingUp },
  { href: '/echeancier', label: 'Fiscal',   icon: CalendarClock },
  { href: '/classeur',  label: 'Classeur',  icon: FolderOpen },
  { href: '/chat',      label: 'Agent IA',  icon: MessageSquare },
];

/** Returns true when the given nav href matches the current location. */
export function navIsActive(href: string, location: string): boolean {
  return href === '/' ? location === '/' : location.startsWith(href);
}
