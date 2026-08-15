import { Link, useLocation } from 'wouter';
import { Radio, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS, MOBILE_NAV, navIsActive, verticalizeNavLabel } from '@/lib/nav';
import { TopRibbon } from './top-ribbon';
import { ThemeToggle } from './theme-toggle';
import { useAuth } from '@/hooks/use-auth';
import { useVertical } from '@/hooks/use-vertical';
import type { AffaireWords } from '@nodaq/shared';
import { MicroFlottant } from '@/components/micro-flottant';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data } = useAuth();
  const { words, proposalWord } = useVertical();
  const role = data?.authenticated === true && 'role' in data ? data.role : undefined;
  const peutVoir = (item: { requiredRoles?: readonly string[] }) =>
    !item.requiredRoles || (role !== undefined && item.requiredRoles.includes(role));

  return (
    <div className="min-h-[100dvh] w-full text-foreground flex grain">
      {/* ── Ambient animated orbs (fixed, behind everything) ─────── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden>
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      {/* ── Desktop sidebar ──────────────────────────────────────── */}
      <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground relative z-10">
        <div className="flex items-center gap-2.5 px-5 h-11 border-b border-sidebar-border">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
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
          {NAV_SECTIONS.map(section => {
            const visibleItems = section.items.filter(peutVoir);
            if (visibleItems.length === 0) return null;
            return (
            <div key={section.label}>
              <div className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/35 font-medium">
                {section.label}
              </div>
              <div className="space-y-0.5 mt-0.5">
                {visibleItems.map(item => {
                  const active = navIsActive(item.href, location);
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
                      <span>{verticalizeNavLabel(item.href, item.label, words, proposalWord)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="rounded-lg bg-sidebar-accent px-3 py-2.5 flex items-center gap-2.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-sidebar-primary" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sidebar-primary" />
            </span>
            <div className="text-[11px] leading-tight flex-1">
              <div className="font-medium text-sidebar-foreground/90">
                Système opérationnel
              </div>
              <div className="text-sidebar-foreground/45 font-mono-nums">
                Synchronisé
              </div>
            </div>
            <ThemeToggle />
          </div>
          {/* MFA (ticket 4.15) — accessible à tous les rôles : OWNER/ACCOUNTANT
              y sont déjà passés de force à la connexion, MEMBER peut l'activer
              volontairement même si rien ne l'y oblige. */}
          <Link
            href="/mfa"
            className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-sidebar-foreground/60 hover-elevate"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Sécurité du compte
          </Link>
        </div>
      </aside>

      {/* ── Right column: ribbon + main content ──────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col relative z-10">
        {/* Mobile nav (mobile only, sticky top) */}
        <MobileNav location={location} peutVoir={peutVoir} words={words} proposalWord={proposalWord} />

        {/* Desktop top ribbon (desktop only, sticky top-0, h-11) */}
        <TopRibbon />

        <main className="flex-1 min-w-0">
          {children}
          {/* Monté ICI, en fin de page — donc présent sur TOUTES les pages,
              après leur contenu. Le poser page par page garantirait qu'on en
              oublie une. Volontairement PAS en `position: fixed` : un bouton
              flottant de cette taille n'a pas de zone du bas systématiquement
              vide à recouvrir sans cacher du texte. */}
          <MicroFlottant />
        </main>
      </div>
    </div>
  );
}

function MobileNav({
  location,
  peutVoir,
  words,
  proposalWord,
}: {
  location: string;
  peutVoir: (item: { requiredRoles?: readonly string[] }) => boolean;
  words: AffaireWords;
  proposalWord: string;
}) {
  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center border-b border-sidebar-border bg-sidebar">
      {/* Scrollable nav items */}
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-2 flex-1 min-w-0">
        {MOBILE_NAV.filter(peutVoir).map(item => {
          const active = navIsActive(item.href, location);
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
              {verticalizeNavLabel(item.href, item.label, words, proposalWord)}
            </Link>
          );
        })}
      </div>
      {/* Theme toggle pinned to the right — always visible */}
      <div className="flex items-center px-2 py-2 border-l border-sidebar-border shrink-0">
        <ThemeToggle />
      </div>
    </div>
  );
}
