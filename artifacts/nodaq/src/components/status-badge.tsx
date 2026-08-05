import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative' | 'accent';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground border-transparent',
  info: 'bg-chart-2/15 text-chart-2 border-chart-2/25',
  positive: 'bg-primary/15 text-primary border-primary/25',
  accent: 'bg-accent/15 text-accent-foreground/90 dark:text-accent border-accent/25',
  warning: 'bg-chart-3/15 text-chart-3 border-chart-3/30',
  negative: 'bg-destructive/12 text-destructive border-destructive/25',
};

const AFFAIRE_STATUS: Record<string, { label: string; tone: Tone }> = {
  PROSPECT: { label: 'Prospect', tone: 'neutral' },
  DEVIS_ENVOYE: { label: 'Devis envoyé', tone: 'info' },
  ACCEPTEE: { label: 'Acceptée', tone: 'accent' },
  EN_COURS: { label: 'En cours', tone: 'positive' },
  TERMINEE: { label: 'Terminée', tone: 'positive' },
  PERDUE: { label: 'Perdue', tone: 'negative' },
  ARCHIVEE: { label: 'Archivée', tone: 'neutral' },
};

const CONTRAT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIF: { label: 'Actif', tone: 'positive' },
  SUSPENDU: { label: 'Suspendu', tone: 'warning' },
  TERMINE: { label: 'Terminé', tone: 'neutral' },
};

const PROSPECT_STAGE: Record<string, { label: string; tone: Tone }> = {
  NOUVEAU: { label: 'Nouveau', tone: 'neutral' },
  CONTACTE: { label: 'Contacté', tone: 'info' },
  QUALIFIE: { label: 'Qualifié', tone: 'info' },
  PROPOSE: { label: 'Proposé', tone: 'accent' },
  NEGOCIE: { label: 'Négocié', tone: 'warning' },
  GAGNE: { label: 'Gagné', tone: 'positive' },
  PERDU: { label: 'Perdu', tone: 'negative' },
};

const PENDING_STATUS: Record<string, { label: string; tone: Tone }> = {
  EN_ATTENTE: { label: 'En attente', tone: 'warning' },
  APPROUVE: { label: 'Approuvé', tone: 'positive' },
  REJETE: { label: 'Rejeté', tone: 'negative' },
};

const SOURCE_LABEL: Record<string, string> = {
  BOUCHE_A_OREILLE: 'Bouche-à-oreille',
  LINKEDIN: 'LinkedIn',
  SITE_WEB: 'Site web',
  PARTENAIRE: 'Partenaire',
  AUTRE: 'Autre',
};

const CADENCE_LABEL: Record<string, string> = {
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  semestriel: 'Semestriel',
  annuel: 'Annuel',
};

function Chip({
  label,
  tone,
  className,
}: {
  label: string;
  tone: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

export function AffaireStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = AFFAIRE_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Chip label={meta.label} tone={meta.tone} className={className} />;
}

export function ContratStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = CONTRAT_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Chip label={meta.label} tone={meta.tone} className={className} />;
}

export function ProspectStageBadge({ stage, className }: { stage: string; className?: string }) {
  const meta = PROSPECT_STAGE[stage] ?? { label: stage, tone: 'neutral' as Tone };
  return <Chip label={meta.label} tone={meta.tone} className={className} />;
}

export function PendingStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = PENDING_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Chip label={meta.label} tone={meta.tone} className={className} />;
}

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

export function cadenceLabel(cadence: string): string {
  return CADENCE_LABEL[cadence] ?? cadence;
}

export const AFFAIRE_STATUS_OPTIONS = Object.entries(AFFAIRE_STATUS).map(
  ([value, meta]) => ({ value, label: meta.label }),
);
export const CONTRAT_STATUS_OPTIONS = Object.entries(CONTRAT_STATUS).map(
  ([value, meta]) => ({ value, label: meta.label }),
);
export const PROSPECT_STAGE_OPTIONS = Object.entries(PROSPECT_STAGE).map(
  ([value, meta]) => ({ value, label: meta.label }),
);
export const PROSPECT_SOURCE_OPTIONS = Object.entries(SOURCE_LABEL).map(
  ([value, label]) => ({ value, label }),
);
export const CONTRAT_CADENCE_OPTIONS = Object.entries(CADENCE_LABEL).map(
  ([value, label]) => ({ value, label }),
);
