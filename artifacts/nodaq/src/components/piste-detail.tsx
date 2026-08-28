/**
 * Le détail d'une piste de prospection.
 *
 * ── POURQUOI UN SEUL PANNEAU POUR QUATRE SOURCES ──────────────────────────
 * Les quatre sources n'ont presque aucun champ commun : un marché public a un
 * acheteur et des codes CPV, un syndic a une commune, un permis a un numéro et
 * une date d'octroi. Écrire un panneau par source aurait produit quatre
 * variantes qui divergeraient à la première évolution.
 *
 * Chaque section convertit donc SA piste en une liste de couples
 * `{ libellé, valeur }` — la conversion vit près de la donnée, l'affichage est
 * unique. Un champ vide n'est pas rendu : mieux vaut un panneau court qu'une
 * ligne « — » qui fait croire à une donnée manquante alors que la source ne la
 * publie pas.
 *
 * ── CE QUE CE PANNEAU NE FAIT PAS ─────────────────────────────────────────
 * Il n'offre AUCUN moyen de contacter qui que ce soit. Ces sources publient
 * des signaux — un marché, un mandat, un permis — pas des coordonnées. Ajouter
 * un bouton « appeler » supposerait un numéro que nous n'avons pas et que la
 * source ne donne pas.
 *
 * La SOURCE est citée dans le panneau, pas seulement dans la liste : c'est là
 * que l'artisan décide d'agir, et c'est là qu'il doit pouvoir vérifier.
 */
import { ExternalLink } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';

export interface ChampPiste {
  readonly libelle: string;
  /** `null` ou vide : la ligne n'est pas rendue. */
  readonly valeur: string | null | undefined;
}

export interface PisteDetail {
  readonly titre: string;
  readonly sousTitre?: string | null;
  readonly champs: readonly ChampPiste[];
  readonly source: { readonly label: string; readonly url: string };
  /**
   * Mention affichée en tête quand la piste n'en est pas une — le demandeur
   * particulier d'un permis, dont le nom et l'adresse sont déjà publics mais
   * qui ne doit jamais devenir une cible de démarchage.
   */
  readonly mention?: string;
}

export function PanneauPiste({
  piste,
  onClose,
}: {
  piste: PisteDetail | null;
  onClose: () => void;
}) {
  const remplis = (piste?.champs ?? []).filter((c) => (c.valeur ?? '').trim().length > 0);

  return (
    <Sheet open={piste !== null} onOpenChange={(ouvert) => { if (!ouvert) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        {piste && (
          <>
            <SheetHeader>
              <SheetTitle className="text-left">{piste.titre}</SheetTitle>
              {piste.sousTitre && (
                <SheetDescription className="text-left">{piste.sousTitre}</SheetDescription>
              )}
            </SheetHeader>

            {piste.mention && (
              <p
                className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground"
                data-testid="mention-piste"
              >
                {piste.mention}
              </p>
            )}

            <dl className="mt-5 space-y-3" data-testid="champs-piste">
              {remplis.map((c) => (
                <div key={c.libelle} className="grid grid-cols-3 gap-3 text-sm">
                  <dt className="col-span-1 text-xs text-muted-foreground pt-0.5">{c.libelle}</dt>
                  <dd className="col-span-2 text-foreground break-words">{c.valeur}</dd>
                </div>
              ))}
            </dl>

            {remplis.length === 0 && (
              <p className="mt-5 text-sm text-muted-foreground">
                La source ne publie rien de plus sur ce signal.
              </p>
            )}

            <div className="mt-6 pt-4 border-t border-border/60">
              <p className="text-[11px] text-muted-foreground">Source</p>
              <a
                href={piste.source.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 text-sm text-primary underline break-all"
              >
                {piste.source.label}
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Une ligne de liste qui ouvre le panneau.
 *
 * Un VRAI bouton, et pas un `div` avec `onClick` : sans ça la ligne n'est ni
 * atteignable au clavier ni annoncée comme actionnable par un lecteur d'écran.
 * Le dépôt garde l'accessibilité (`accessibilite-audit`), et une liste de
 * pistes inutilisable au clavier serait une régression silencieuse.
 */
export function LignePiste({
  onClick,
  children,
  testId,
}: {
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="w-full text-left p-3 hover-elevate transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {children}
    </button>
  );
}
