/**
 * Micro flottant — présent sur TOUTES les pages.
 *
 * « Vous ne tapez plus jamais rien. » La voix pour dire et pour commander ;
 * l'ÉCRAN pour confirmer. Appui long pour parler, relâché pour envoyer.
 *
 * RIEN NE S'ÉCRIT AVANT « Valider ». La feuille montre les opérations, les
 * questions restées ouvertes, et ce qui n'a pas été compris — un plan qui fait
 * silence sur ce qu'il a raté est un plan qui ment.
 *
 * Pas de synthèse vocale : la confirmation est visuelle, c'est la promesse
 * qu'on tient.
 */
import { useCallback, useState } from 'react';
import { Mic, Loader2, Check, X, HelpCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { useDictee } from '@/hooks/use-dictee';
import { apiFetch } from '@/lib/auth';

const API = '/api';

interface Operation {
  type: string;
  libelle: string;
  certitude: string;
}

interface Question {
  question: string;
  mention: string;
  candidats: Array<{ id: string; libelle: string }>;
}

interface Plan {
  // `null` quand rien n'a produit d'opération : rien n'est enregistré côté
  // serveur dans ce cas, donc rien à valider — voir routes/voix.ts.
  planId: string | null;
  operations: Operation[];
  questions: Question[];
  nonCompris: string[];
}

export function MicroFlottant() {
  const { toast } = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [interprete, setInterprete] = useState(false);
  const [applique, setApplique] = useState(false);

  const interpreter = useCallback(
    async (texte: string) => {
      setInterprete(true);
      try {
        const res = await apiFetch(`${API}/voix/interpreter`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texte }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? "Interprétation impossible");
        }
        setPlan((await res.json()) as Plan);
      } catch (err) {
        toast({
          title: 'Je n’ai pas pu traiter votre phrase',
          description: err instanceof Error ? err.message : 'Erreur inconnue',
          variant: 'destructive',
        });
      } finally {
        setInterprete(false);
      }
    },
    [toast],
  );

  const { enregistre, transcrit, demarrer, arreter } = useDictee(interpreter);

  const valider = useCallback(async () => {
    if (!plan) return;
    setApplique(true);
    try {
      const res = await apiFetch(`${API}/voix/executer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.planId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Application impossible');
      }
      toast({ title: 'Appliqué', description: `${plan.operations.length} opération(s) enregistrée(s).` });
      setPlan(null);
      // Rechargement franc : les écrans ouverts affichent des données qui
      // viennent de changer, et un rafraîchissement partiel en laisserait.
      window.location.reload();
    } catch (err) {
      toast({
        title: 'Rien n’a été enregistré',
        description: err instanceof Error ? err.message : 'Erreur inconnue',
        variant: 'destructive',
      });
    } finally {
      setApplique(false);
    }
  }, [plan, toast]);

  const occupe = interprete || transcrit;

  return (
    <>
      <Button
        aria-label="Dicter une commande"
        data-testid="bouton-micro-flottant"
        size="icon"
        // `no-default-hover-elevate`/`no-default-active-elevate` : le survol
        // de `Button` pose `position: relative` (index.css) pour ancrer son
        // effet ::after — plus spécifique que la classe `fixed`, il gagnait
        // la cascade et renvoyait ce bouton dans le flux normal du DOM, hors
        // écran. Sans ces deux classes, AUCUN bouton `fixed` de ce composant
        // ne flotte réellement, peu importe sa position déclarée.
        className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 h-20 w-20 rounded-full shadow-lg md:bottom-6 no-default-hover-elevate no-default-active-elevate"
        // Appui LONG : `onPointerDown` / `onPointerUp` couvrent souris, doigt
        // et stylet d'un seul jeu d'événements.
        onPointerDown={() => void demarrer()}
        onPointerUp={arreter}
        onPointerLeave={arreter}
        disabled={occupe}
      >
        {occupe ? (
          <Loader2 className="h-9 w-9 animate-spin" />
        ) : (
          <Mic className={enregistre ? 'h-9 w-9 animate-pulse' : 'h-9 w-9'} />
        )}
      </Button>

      <Sheet open={plan !== null} onOpenChange={(o) => { if (!o) setPlan(null); }}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Ce que j’ai compris</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 py-4">
            {plan?.operations.length ? (
              <ul className="space-y-2" data-testid="liste-operations">
                {plan.operations.map((o, i) => (
                  <li key={i} className="rounded-lg border border-card-border p-3 text-sm">
                    {o.libelle}
                    {o.certitude === 'partielle' && (
                      <span className="ml-2 text-xs text-muted-foreground">(rapprochement approximatif)</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune opération à appliquer.</p>
            )}

            {plan?.questions.map((q, i) => (
              <div key={i} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" data-testid="question-plan">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <HelpCircle className="h-4 w-4" /> {q.question}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {q.candidats.map((c) => <li key={c.id}>• {c.libelle}</li>)}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Redictez en précisant lequel : je ne choisis pas à votre place.
                </p>
              </div>
            ))}

            {plan?.nonCompris.length ? (
              <div className="rounded-lg border border-card-border bg-muted/40 p-3" data-testid="non-compris">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4" /> Je n’ai pas compris
                </div>
                <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                  {plan.nonCompris.map((n, i) => <li key={i}>• {n}</li>)}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="flex gap-2 pb-2">
            <Button variant="outline" className="flex-1" onClick={() => setPlan(null)}>
              <X className="mr-2 h-4 w-4" /> Annuler
            </Button>
            <Button
              className="flex-1"
              onClick={() => void valider()}
              disabled={applique || !plan?.operations.length}
              data-testid="bouton-valider-plan"
            >
              {applique ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Valider
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
