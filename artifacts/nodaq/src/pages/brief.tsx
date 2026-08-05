import { Link } from 'wouter';
import {
  Sunrise,
  AlertTriangle,
  CalendarClock,
  ShieldCheck,
  Users2,
  ArrowRight,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { useBrief } from '@/hooks/use-brief';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const SECTION_META: Record<string, { icon: typeof Sunrise; label: string; tone: string }> = {
  overdue: { icon: AlertTriangle, label: 'Retards', tone: 'text-destructive' },
  deadlines: { icon: CalendarClock, label: 'Échéances', tone: 'text-chart-3' },
  actions: { icon: ShieldCheck, label: 'Actions en attente', tone: 'text-primary' },
  prospects: { icon: Users2, label: 'Prospects', tone: 'text-chart-2' },
  summary: { icon: Sunrise, label: 'Résumé', tone: 'text-foreground' },
};

export default function Brief() {
  const { data: brief, isLoading, isError } = useBrief();

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow={brief?.date ? fmtDate(brief.date) : 'Brief du jour'}
        title="Brief matin"
        description={brief?.greeting ?? "Votre point de situation quotidien, condensé à l'essentiel."}
      />

      <div className="px-5 md:px-8 pt-6">
        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-destructive rounded-xl border border-card-border bg-card">
            Impossible de charger le brief du jour.
          </div>
        ) : !brief || brief.sections.length === 0 ? (
          <Empty className="py-16 rounded-xl border border-dashed border-card-border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Sunrise />
              </EmptyMedia>
              <EmptyTitle>Rien à signaler ce matin</EmptyTitle>
              <EmptyDescription>
                Aucune alerte, aucune échéance urgente. Bonne journée.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {brief.sections.map((section, sIdx) => {
              const meta = SECTION_META[section.type] ?? SECTION_META.summary;
              const Icon = meta.icon;
              return (
                <div
                  key={`${section.type}-${sIdx}`}
                  className="rounded-xl border border-card-border bg-card shadow-sm animate-stagger-in"
                  style={{ animationDelay: `${sIdx * 60}ms` }}
                  data-testid={`brief-section-${section.type}`}
                >
                  <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
                    <Icon className={cn('h-4 w-4', meta.tone)} />
                    <span className="text-sm font-semibold">{section.title}</span>
                    <span className="ml-auto text-[11px] font-mono-nums text-muted-foreground">
                      {section.items.length}
                    </span>
                  </div>
                  {section.items.length === 0 ? (
                    <div className="px-5 py-6 text-sm text-muted-foreground">
                      Rien à signaler.
                    </div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {section.items.map((item, iIdx) => {
                        const content = (
                          <div
                            className="flex items-center justify-between gap-3 px-5 py-3 hover-elevate"
                            data-testid={`brief-item-${section.type}-${iIdx}`}
                          >
                            <div className="min-w-0 flex items-center gap-2">
                              {item.urgent && (
                                <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                              )}
                              <span
                                className={cn(
                                  'text-sm truncate',
                                  item.urgent ? 'text-destructive font-medium' : 'text-foreground',
                                )}
                              >
                                {item.label}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {item.meta && (
                                <span className="text-xs text-muted-foreground font-mono-nums">
                                  {item.meta}
                                </span>
                              )}
                              {item.link && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                            </div>
                          </div>
                        );
                        return (
                          <li key={iIdx}>
                            {item.link ? (
                              <Link href={item.link} className="block">
                                {content}
                              </Link>
                            ) : (
                              content
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
