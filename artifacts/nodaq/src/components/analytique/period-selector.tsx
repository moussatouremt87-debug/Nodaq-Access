/**
 * Period + comparison selector — ONE line, always.
 * Spec §12: "filtres de période sur UNE seule ligne au-dessus"
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PeriodeMode, ComparaisonMode } from '@/hooks/use-analytics';

interface PeriodSelectorProps {
  periode: PeriodeMode;
  comparaison: ComparaisonMode;
  onPeriodeChange: (p: PeriodeMode) => void;
  onComparaisonChange: (c: ComparaisonMode) => void;
}

const PERIODES: { value: PeriodeMode; label: string; short: string }[] = [
  { value: 'mois',      label: 'Ce mois',         short: 'Mois' },
  { value: 'trimestre', label: 'Ce trimestre',     short: 'T. en cours' },
  { value: 'exercice',  label: "L'exercice",       short: 'Exercice' },
  { value: '12_mois',   label: '12 mois glissants', short: '12 mois' },
];

const COMPARAISONS: { value: ComparaisonMode; label: string; short: string }[] = [
  { value: 'meme_periode_n1',   label: 'Même période an dernier', short: 'vs N-1' },
  { value: 'moyenne_12_mois',   label: 'Moyenne 12 mois',         short: 'Moy. 12 m.' },
  { value: 'periode_precedente', label: 'Période précédente',      short: 'Précédente' },
  { value: 'aucune',            label: 'Sans comparaison',         short: 'Aucune' },
];

export function PeriodSelector({ periode, comparaison, onPeriodeChange, onComparaisonChange }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
      <Select value={periode} onValueChange={(v) => onPeriodeChange(v as PeriodeMode)}>
        <SelectTrigger className="h-8 w-[160px] sm:w-[180px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIODES.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground text-xs hidden sm:inline">comparé à</span>

      <Select value={comparaison} onValueChange={(v) => onComparaisonChange(v as ComparaisonMode)}>
        <SelectTrigger className="h-8 w-[185px] sm:w-[205px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COMPARAISONS.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
