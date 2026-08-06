import { cn } from '@/lib/utils';

/**
 * Loading skeleton with a directional shimmer sweep (left → right).
 * Respects prefers-reduced-motion via the CSS animation override in index.css.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-md animate-shimmer', className)}
      {...props}
    />
  );
}

export { Skeleton };
