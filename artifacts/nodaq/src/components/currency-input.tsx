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
/**
 * Zéro s'affiche VIDE, avec « 0,00 » en filigrane.
 *
 * ── Pourquoi ────────────────────────────────────────────────────────────
 * « Quand je veux saisir le P.U HT, je dois manuellement effacer tous les 0
 * pour ensuite saisir le montant, c'est chiant pour les users. » Un champ
 * neuf affichait « 0.00 » comme une valeur saisie : il fallait la sélectionner
 * et la détruire avant de pouvoir taper. Sur une ligne de devis, ce geste se
 * répète autant de fois qu'il y a de lignes.
 *
 * ── Le compromis, assumé ────────────────────────────────────────────────
 * Un montant délibérément nul s'affiche donc comme un champ vide, et ne se
 * distingue plus visuellement d'un montant non saisi. C'est acceptable ICI :
 * le filigrane annonce « 0,00 », et la valeur transmise reste 0 dans les deux
 * cas — l'affichage change, pas la donnée. Là où l'absence de prix doit se
 * distinguer d'un prix nul, c'est le SERVEUR qui les sépare (`null` contre 0,
 * voir `LigneProposee.prixUnitaireHtCents`), pas ce champ.
 */
function afficher(valueCents: number): string {
  return valueCents === 0 ? '' : (valueCents / 100).toFixed(2);
}

export function CurrencyInput({ valueCents, onChangeCents, className, min = 0 }: {
  valueCents: number;
  onChangeCents: (cents: number) => void;
  className?: string;
  min?: number;
}) {
  const [texte, setTexte] = useState(() => afficher(valueCents));
  const [enFocus, setEnFocus] = useState(false);

  useEffect(() => {
    if (!enFocus) setTexte(afficher(valueCents));
  }, [valueCents, enFocus]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={texte}
      placeholder="0,00"
      onFocus={(e) => {
        setEnFocus(true);
        // Tout sélectionner : la frappe suivante REMPLACE au lieu de
        // s'ajouter. Sans ça, cliquer au milieu de « 89.00 » pour corriger un
        // chiffre donne « 8945.00 » sans qu'on comprenne pourquoi.
        e.currentTarget.select();
      }}
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
        setTexte(afficher(valueCents));
      }}
      className={className}
    />
  );
}
