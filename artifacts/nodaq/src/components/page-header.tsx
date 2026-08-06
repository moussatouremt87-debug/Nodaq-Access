import { cn } from '@/lib/utils';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  withMesh = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
  /** Renders a slow-shifting gradient mesh behind the header — fintech hero feel */
  withMesh?: boolean;
}) {
  return (
    <div
      className={cn(
        // On desktop, stick below the top ribbon (h-11 = 44px). On mobile, stick at top-0 (no ribbon).
        'sticky top-0 md:top-11 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 px-5 md:px-8 py-5',
        withMesh && 'relative overflow-hidden',
        className,
      )}
    >
      {withMesh && (
        <div className="hero-mesh absolute inset-0 pointer-events-none" aria-hidden />
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          {eyebrow && (
            <div className="text-[11px] font-mono-nums uppercase tracking-[0.16em] text-muted-foreground mb-1">
              {eyebrow}
            </div>
          )}
          <h1 className="text-2xl md:text-[26px] font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground max-w-xl">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
