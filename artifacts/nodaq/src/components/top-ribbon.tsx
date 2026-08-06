import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS, navIsActive, type NavSection } from '@/lib/nav';

/** Desktop-only horizontal ribbon. Hidden on mobile (MobileNav handles that). */
export function TopRibbon() {
  const [location] = useLocation();

  return (
    <div
      className={cn(
        'hidden md:flex items-stretch shrink-0',
        'sticky top-0 z-30 h-11',
        'border-b border-sidebar-border bg-sidebar',
        'overflow-x-auto',
      )}
    >
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
          />
        );
      })}
    </div>
  );
}

function SectionTab({
  section,
  sectionActive,
  location,
}: {
  section: NavSection;
  sectionActive: boolean;
  location: string;
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
                'text-sidebar-foreground/55',
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
                : 'text-sidebar-foreground/35',
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
                      : 'text-sidebar-foreground/45',
                  )}
                  strokeWidth={2}
                />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
