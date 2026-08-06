import { Link, useLocation } from 'wouter';
import {
  LayoutDashboard,
  Briefcase,
  Repeat,
  Receipt,
  Users,
  Sunrise,
  MessageSquare,
  Radio,
  FileText,
  FolderOpen,
  TrendingUp,
  FileBarChart,
  CalendarClock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_SECTIONS = [
  {
    label: 'Tableau de bord',
    items: [
      { href: '/', label: 'Cockpit', icon: LayoutDashboard, testId: 'nav-cockpit' },
      { href: '/brief', label: 'Brief matin', icon: Sunrise, testId: 'nav-brief' },
      { href: '/chat', label: 'Agent IA', icon: MessageSquare, testId: 'nav-chat' },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { href: '/affaires', label: 'Affaires', icon: Briefcase, testId: 'nav-affaires' },
      { href: '/devis', label: 'Devis', icon: FileText, testId: 'nav-devis' },
      { href: '/contrats', label: 'Contrats', icon: Repeat, testId: 'nav-contrats' },
      { href: '/prospects', label: 'Prospects', icon: Users, testId: 'nav-prospects' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/factures', label: 'Factures', icon: Receipt, testId: 'nav-factures' },
      { href: '/marge', label: 'Marge', icon: TrendingUp, testId: 'nav-marge' },
      { href: '/rapports', label: 'Rapports', icon: FileBarChart, testId: 'nav-rapports' },
      { href: '/echeancier', label: 'Échéancier fiscal', icon: CalendarClock, testId: 'nav-echeancier' },
    ],
  },
  {
    label: 'Documents',
    items: [
      { href: '/classeur', label: 'Classeur', icon: FolderOpen, testId: 'nav-classeur' },
    ],
  },
];

// Flat list for mobile nav (keep it compact)
const MOBILE_NAV = [
  { href: '/', label: 'Cockpit', icon: LayoutDashboard },
  { href: '/affaires', label: 'Affaires', icon: Briefcase },
  { href: '/devis', label: 'Devis', icon: FileText },
  { href: '/factures', label: 'Factures', icon: Receipt },
  { href: '/marge', label: 'Marge', icon: TrendingUp },
  { href: '/echeancier', label: 'Fiscal', icon: CalendarClock },
  { href: '/classeur', label: 'Classeur', icon: FolderOpen },
  { href: '/chat', label: 'Agent IA', icon: MessageSquare },
];

function isActive(href: string, location: string) {
  return href === '/' ? location === '/' : location.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground flex grain">
      <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Radio className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <div className="leading-none">
            <div className="font-semibold text-[15px] tracking-tight text-sidebar-foreground">
              NODAQ
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/45 font-mono-nums">
              Cockpit v1.0
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <div className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/35 font-medium">
                {section.label}
              </div>
              <div className="space-y-0.5 mt-0.5">
                {section.items.map(item => {
                  const active = isActive(item.href, location);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-testid={item.testId}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover-elevate',
                        active
                          ? 'bg-sidebar-accent text-sidebar-primary'
                          : 'text-sidebar-foreground/70',
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 h-5 w-[3px] rounded-r-full bg-sidebar-primary" />
                      )}
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          active ? 'text-sidebar-primary' : 'text-sidebar-foreground/50',
                        )}
                        strokeWidth={2}
                      />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="rounded-lg bg-sidebar-accent px-3 py-2.5 flex items-center gap-2.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-sidebar-primary" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sidebar-primary" />
            </span>
            <div className="text-[11px] leading-tight">
              <div className="font-medium text-sidebar-foreground/90">
                Système opérationnel
              </div>
              <div className="text-sidebar-foreground/45 font-mono-nums">
                Synchronisé
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav location={location} />
        <main className="flex-1 min-w-0 relative z-10">{children}</main>
      </div>
    </div>
  );
}

function MobileNav({ location }: { location: string }) {
  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar px-2 py-2">
      {MOBILE_NAV.map(item => {
        const active = isActive(item.href, location);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium hover-elevate',
              active
                ? 'bg-sidebar-accent text-sidebar-primary'
                : 'text-sidebar-foreground/60',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
