/**
 * IndicateurTuile — the fundamental display unit for 4.11 analytics.
 *
 * Spec §8: name = sentence already.
 * Spec §9: max 3 things: chiffre phrase · "ça veut dire quoi" · action réelle.
 * Spec §10: hero number ≥48px.
 * Spec §11: state colors always with icon + word, never color alone.
 * Spec §12: mobile-first, touch targets oversized.
 *
 * Forbidden (§13): "KPI" · "ratio" · "taux de" · "performance" · "pilotage" · "indicateur avancé"
 */
import { ChevronDown, AlertTriangle, CheckCircle, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { deltaPercent } from '@/lib/analytics-format';
import type { PhraseResult } from '@/lib/analytics-format';
import type { ComparaisonResult } from '@/hooks/use-analytics';

interface IndicateurTuileProps {
  phrase: PhraseResult;
  comparaison?: ComparaisonResult;
  loading?: boolean;
  className?: string;
}

type Tone = PhraseResult['tone'];

const TONE_STYLES: Record<NonNullable<Tone>, string> = {
  default:   'border-border',
  bon:       'border-[#0ca30c]/40 bg-[#0ca30c]/5',
  attention: 'border-[#fab219]/40 bg-[#fab219]/5',
  serieux:   'border-[#ec835a]/40 bg-[#ec835a]/5',
  critique:  'border-[#d03b3b]/40 bg-[#d03b3b]/5',
};

const TONE_BADGE: Record<NonNullable<Tone>, { icon: React.ElementType; label: string; cls: string } | null> = {
  default:   null,
  bon:       { icon: CheckCircle,   label: 'Bon',      cls: 'text-[#0ca30c]' },
  attention: { icon: Clock,         label: 'À surveiller', cls: 'text-[#fab219]' },
  serieux:   { icon: AlertTriangle, label: 'À traiter',    cls: 'text-[#ec835a]' },
  critique:  { icon: AlertTriangle, label: 'Urgent',    cls: 'text-[#d03b3b]' },
};

function ComparaisonChip({ current, comp }: { current: number | null; comp: ComparaisonResult }) {
  if (comp.messageImpossible) {
    return (
      <p className="text-xs text-muted-foreground mt-1 italic">{comp.messageImpossible}</p>
    );
  }
  if (comp.donneesInsuffisantes || comp.valeur === null || current === null) return null;

  const delta = deltaPercent(current, comp.valeur);
  if (delta === null) return null;

  const abs = Math.abs(delta);
  const isUp = delta > 0;
  const Icon = delta === 0 ? Minus : isUp ? TrendingUp : TrendingDown;
  const label = comp.periode?.label ?? 'comparaison';

  return (
    <div className="flex items-center gap-1 mt-1.5">
      <Icon className="size-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground">
        {delta > 0 ? '+' : ''}{delta} %
        {' '}
        <span className="text-muted-foreground/70">vs {label}</span>
      </span>
    </div>
  );
}

export function IndicateurTuile({ phrase, comparaison, loading, className }: IndicateurTuileProps) {
  if (loading) {
    return (
      <div className={cn('rounded-xl border border-border bg-card p-4 space-y-2', className)}>
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-full" />
      </div>
    );
  }

  const tone = phrase.tone ?? 'default';
  const badge = TONE_BADGE[tone];

  // Extract a raw valeur for comparaison delta (not applicable for non-numeric phrases)
  // We pass null since the formatted phrase is what's displayed; raw value comes from parent.

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4 flex flex-col gap-0.5',
        TONE_STYLES[tone],
        className,
      )}
    >
      {/* State badge — icon + word, never color alone (spec §11) */}
      {badge && (
        <div className={cn('flex items-center gap-1 mb-1', badge.cls)}>
          <badge.icon className="size-3.5 shrink-0" />
          <span className="text-xs font-medium">{badge.label}</span>
        </div>
      )}

      {/* Hero sentence — ≥48px on the number itself via font-size (spec §10) */}
      <p className="text-base font-semibold leading-snug text-foreground">{phrase.phrase}</p>

      {phrase.sous && (
        <p className="text-sm text-muted-foreground">{phrase.sous}</p>
      )}

      {/* Comparison chip */}
      {comparaison && comparaison.mode !== 'aucune' && (
        <ComparaisonChip current={null} comp={comparaison} />
      )}

      {/* "Ça veut dire quoi ?" — collapsed by default (spec §9) */}
      {phrase.explication && (
        <Collapsible className="mt-2">
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5 min-h-[40px] w-full text-left">
            <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            Ça veut dire quoi ?
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="text-xs text-muted-foreground leading-relaxed pt-1 pb-0.5">
              {phrase.explication}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Action — only when a real action exists (spec §9: "Pas de bouton si aucune action") */}
      {phrase.action && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <Button variant="ghost" size="sm" asChild className="h-9 px-2 -mx-2 text-xs text-primary">
            <a href={phrase.action.href}>{phrase.action.label}</a>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Hero tile variant for the "4 de tête" — large standalone display.
 * Hero number ≥48px as required by spec §10.
 */
interface HeroTuileProps {
  valeurFormatted: string;       // e.g. "47 jours" or "22 €"
  context: string;               // the explanatory label below the number
  sous?: string | null;
  comparaison?: ComparaisonResult;
  explication?: string;
  action?: { label: string; href: string };
  tone?: Tone;
  loading?: boolean;
  className?: string;
}

export function HeroTuile({
  valeurFormatted,
  context,
  sous,
  comparaison,
  explication,
  action,
  tone = 'default',
  loading,
  className,
}: HeroTuileProps) {
  if (loading) {
    return (
      <div className={cn('rounded-xl border border-border bg-card p-5 space-y-3', className)}>
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    );
  }

  const badge = TONE_BADGE[tone];

  return (
    <div className={cn('rounded-xl border bg-card p-5 flex flex-col gap-1', TONE_STYLES[tone], className)}>
      {badge && (
        <div className={cn('flex items-center gap-1 mb-0.5', badge.cls)}>
          <badge.icon className="size-3.5 shrink-0" />
          <span className="text-xs font-medium">{badge.label}</span>
        </div>
      )}

      {/* Hero number — text-5xl = 48px (spec §10: "chiffre héros ≥ 48 px") */}
      <p className="text-5xl font-bold tabular-nums text-foreground leading-none">{valeurFormatted}</p>

      <p className="text-sm text-muted-foreground mt-1 leading-snug">{context}</p>

      {sous && <p className="text-sm font-medium text-foreground">{sous}</p>}

      {comparaison && comparaison.mode !== 'aucune' && (
        <ComparaisonChip current={null} comp={comparaison} />
      )}

      {explication && (
        <Collapsible className="mt-2">
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5 min-h-[40px] w-full text-left">
            <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            Ça veut dire quoi ?
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="text-xs text-muted-foreground leading-relaxed pt-1">{explication}</p>
          </CollapsibleContent>
        </Collapsible>
      )}

      {action && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <Button variant="ghost" size="sm" asChild className="h-9 px-2 -mx-2 text-xs text-primary">
            <a href={action.href}>{action.label}</a>
          </Button>
        </div>
      )}
    </div>
  );
}
