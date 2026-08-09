export const fmtEUR = (cents: number | null | undefined): string =>
  new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);

export const fmtEURCompact = (cents: number | null | undefined): string => {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) >= 10000 ? 1 : 0,
  }).format(value);
};

/**
 * Format a Date as "YYYY-MM-DD" from its LOCAL (browser) components — never
 * via toISOString() sliced to 10 chars, which converts to UTC first and can
 * render the wrong calendar day (e.g. right after local midnight). Used for
 * default form values (today's date) on business-date fields like issuedDate.
 * Duplicated from lib/shared's toDateString rather than imported, to avoid
 * pulling the whole @nodaq/shared barrel (zod schemas, tax rules, …) into
 * the browser bundle for one function.
 */
export const toDateString = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
};

export const fmtDateShort = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  }).format(d);
};

export const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

export const fmtRelative = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '—';
  const diffMs = Date.now() - d;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  return `il y a ${diffD} j`;
};

export const isOverdue = (dueDate: string | null | undefined): boolean => {
  if (!dueDate) return false;
  return new Date(dueDate).getTime() < Date.now();
};

const MONTHS_FR = [
  'Janv',
  'Févr',
  'Mars',
  'Avr',
  'Mai',
  'Juin',
  'Juil',
  'Août',
  'Sept',
  'Oct',
  'Nov',
  'Déc',
];

export const fmtMonth = (yyyyMm: string): string => {
  const [y, m] = yyyyMm.split('-');
  const idx = Number(m) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx > 11) return yyyyMm;
  return `${MONTHS_FR[idx]} ${y?.slice(2)}`;
};

export const initials = (name: string | null | undefined): string => {
  if (!name) return '—';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
};
