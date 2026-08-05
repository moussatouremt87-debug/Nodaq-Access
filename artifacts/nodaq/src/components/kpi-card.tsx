import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

export function KpiCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = 'default',
  delay = 0,
  testId,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  tone?: 'default' | 'accent' | 'warning' | 'negative';
  delay?: number;
  testId?: string;
}) {
  const toneClasses: Record<string, string> = {
    default: 'text-foreground',
    accent: 'text-primary',
    warning: 'text-chart-3',
    negative: 'text-destructive',
  };

  return (
    <div
      className="animate-stagger-in rounded-xl border border-card-border bg-card p-4 md:p-5 shadow-sm hover-elevate"
      style={{ animationDelay: `${delay}ms` }}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </div>
        <Icon className="h-4 w-4 text-muted-foreground/60 shrink-0" strokeWidth={2} />
      </div>
      <div
        className={cn(
          'mt-3 font-mono-nums text-2xl md:text-[28px] font-semibold tabular-nums leading-none',
          toneClasses[tone],
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-2 text-xs text-muted-foreground truncate">{hint}</div>
      )}
    </div>
  );
}
