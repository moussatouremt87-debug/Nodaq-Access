import { useEffect, useState } from 'react';
import { motion, useMotionValue, useSpring, useMotionValueEvent } from 'framer-motion';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

// Self-contained variants: entrance (hidden→visible) + hover
const kpiVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0.42, ease: [0.25, 0.1, 0.25, 1] as const },
  },
  hover: {
    y: -3,
    boxShadow: '0 10px 28px -6px rgba(0,0,0,0.40), 0 2px 8px -2px rgba(0,0,0,0.22)',
    transition: { type: 'spring' as const, stiffness: 300, damping: 20 },
  },
};

const toneClasses: Record<string, string> = {
  default: 'text-foreground',
  accent: 'text-primary',
  warning: 'text-chart-3',
  negative: 'text-destructive',
};

interface AnimatedKpiProps {
  label: string;
  /** Raw numeric value — cents for currency, plain int for counts */
  target: number;
  /** Formats the animated number into the display string */
  format: (n: number) => string;
  icon: LucideIcon;
  hint?: string;
  tone?: 'default' | 'accent' | 'warning' | 'negative';
  testId?: string;
  /**
   * Le backend a masqué ce champ pour le rôle courant (null, jamais 0).
   * Affiche un texte explicite plutôt que d'animer vers zéro — un 0 nu
   * laisserait croire à une absence de chiffre d'affaires.
   */
  masked?: boolean;
}

export function AnimatedKpi({
  label,
  target,
  format,
  icon: Icon,
  hint,
  tone = 'default',
  testId,
  masked = false,
}: AnimatedKpiProps) {
  const raw = useMotionValue(0);
  const spring = useSpring(raw, { stiffness: 70, damping: 16, restDelta: 0.5 });
  const [display, setDisplay] = useState(() => format(0));

  // Mirror spring value into display string on every frame
  useMotionValueEvent(spring, 'change', (v) => {
    setDisplay(format(Math.round(Math.max(0, v))));
  });

  // Animate to the (possibly new) target on mount and whenever target changes
  useEffect(() => {
    if (masked) return;
    raw.set(0);
    const id = setTimeout(() => raw.set(target), 50);
    return () => clearTimeout(id);
  }, [target, raw, masked]);

  return (
    <motion.div
      variants={kpiVariants}
      whileHover="hover"
      className="rounded-xl border border-card-border bg-card p-4 md:p-5 shadow-sm cursor-default"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
          {label}
        </div>
        <Icon className="h-4 w-4 text-muted-foreground/60 shrink-0" strokeWidth={2} />
      </div>
      {masked ? (
        <>
          <div className="mt-3 flex items-center gap-1.5 text-muted-foreground/70">
            <Lock className="h-4 w-4" strokeWidth={2} />
            <span className="font-mono-nums text-2xl md:text-[28px] font-semibold leading-none">—</span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground truncate">
            Réservé aux gestionnaires financiers
          </div>
        </>
      ) : (
        <>
          <div
            className={cn(
              'mt-3 font-mono-nums text-2xl md:text-[28px] font-semibold tabular-nums leading-none',
              toneClasses[tone],
            )}
          >
            {display}
          </div>
          {hint && (
            <div className="mt-2 text-xs text-muted-foreground truncate">{hint}</div>
          )}
        </>
      )}
    </motion.div>
  );
}
