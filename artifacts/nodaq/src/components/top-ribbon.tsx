import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS, navIsActive, verticalizeNavLabel, type NavSection } from '@/lib/nav';
import { ThemeToggle } from './theme-toggle';
import { useVertical } from '@/hooks/use-vertical';
import type { AffaireWords } from '@nodaq/shared';

/** Desktop-only horizontal ribbon. Hidden on mobile (MobileNav handles that). */
export function TopRibbon() {
  const [location] = useLocation();
  const { words, proposalWord } = useVertical();

  return (
    // Outer bar: full width, no overflow — keeps the toggle always in view
    <div
      className={cn(
        'hidden md:flex items-stretch shrink-0',
        'sticky top-0 z-30 h-11',
        'border-b border-sidebar-border bg-sidebar',
      )}
    >
      {/* Scrollable section tabs — overflow here, not on the outer bar */}
      <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto">
        {NAV_SECTIONS.map(section => {
          const sectionActive = section.items.some(item =>
            navIsActive(item.href, location),
          );
          return (
            <SectionTab
              key={section.label}
              section={section}
              sectionActive={sectionActive}
              location={location}
              words={words}
              proposalWord={proposalWord}
            />
          );
        })}
      </div>

      {/* Theme toggle — structurally outside the scroll area, always visible */}
      <div className="flex items-center px-3 shrink-0 border-l border-sidebar-border/50">
        <ThemeToggle />
      </div>
    </div>
  );
}

function SectionTab({
  section,
  sectionActive,
  location,
  words,
  proposalWord,
}: {
  section: NavSection;
  sectionActive: boolean;
  location: string;
  words: AffaireWords;
  proposalWord: string;
}) {
  const [open, setOpen] = useState(false);
  const primary = section.items[0]!;
  const hasMultiple = section.items.length > 1;

  return (
    <div
      className="relative flex items-stretch"
      onMouseEnter={() => hasMultiple && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Section tab — navigates to the section's primary route */}
      <Link
        href={primary.href}
        className={cn(
          'flex items-center gap-1.5 px-4 text-[13px] font-medium whitespace-nowrap',
          'border-b-2 transition-colors duration-150',
          sectionActive
            ? 'border-sidebar-primary text-sidebar-primary'
            : [
                'border-transparent',
                'text-sidebar-foreground/60',
                'hover:text-sidebar-foreground/90',
                'hover:border-sidebar-foreground/20',
              ],
        )}
      >
        {section.label}
        {hasMultiple && (
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 transition-transform duration-150',
              open ? 'rotate-180' : '',
              sectionActive
                ? 'text-sidebar-primary'
                : 'text-sidebar-foreground/60',
            )}
          />
        )}
      </Link>

      {/* Dropdown for sections with multiple sub-routes */}
      {hasMultiple && open && (
        <div
          className={cn(
            'absolute left-0 top-full z-50',
            'min-w-[188px] py-1',
            'rounded-b-lg border border-t-0 border-sidebar-border',
            'bg-sidebar shadow-lg',
          )}
        >
          {section.items.map(item => {
            const active = navIsActive(item.href, location);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 px-4 py-2 text-sm font-medium',
                  'transition-colors hover-elevate',
                  active
                    ? 'bg-sidebar-accent text-sidebar-primary'
                    : 'text-sidebar-foreground/70 hover:text-sidebar-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    active
                      ? 'text-sidebar-primary'
                      : 'text-sidebar-foreground/60',
                  )}
                  strokeWidth={2}
                />
                {verticalizeNavLabel(item.href, item.label, words, proposalWord)}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
