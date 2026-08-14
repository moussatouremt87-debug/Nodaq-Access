import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';

/**
 * Un champ de saisie de montant en euros dont l'état interne (texte tapé) est
 * découplé de la valeur formatée. Un champ contrôlé classique — dont le
 * `value` est recalculé et reformaté (`.toFixed(2)`) à chaque frappe — fait
 * perdre à React la position du curseur à chaque re-rendu, corrompant la
 * saisie (ex. "3200" devient "3,00"). Le texte affiché n'est reformaté qu'à
 * la perte de focus.
 */
export function CurrencyInput({ valueCents, onChangeCents, className, min = 0 }: {
  valueCents: number;
  onChangeCents: (cents: number) => void;
  className?: string;
  min?: number;
}) {
  const [texte, setTexte] = useState(() => (valueCents / 100).toFixed(2));
  const [enFocus, setEnFocus] = useState(false);

  useEffect(() => {
    if (!enFocus) setTexte((valueCents / 100).toFixed(2));
  }, [valueCents, enFocus]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={texte}
      onFocus={() => setEnFocus(true)}
      onChange={e => {
        const brut = e.target.value;
        setTexte(brut);
        const analyse = Number(brut.replace(',', '.'));
        if (brut.trim() !== '' && Number.isFinite(analyse) && analyse >= min) {
          onChangeCents(Math.round(analyse * 100));
        }
      }}
      onBlur={() => {
        setEnFocus(false);
        setTexte((valueCents / 100).toFixed(2));
      }}
      className={className}
    />
  );
}
