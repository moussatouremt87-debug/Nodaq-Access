/**
 * Micro — présent sur TOUTES les pages, en fin de contenu.
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
 *
 * ── PAS EN `position: fixed` ─────────────────────────────────────────────
 * Un bouton flottant, agrandi et centré, recouvrait le contenu de chaque
 * page — il n'existe pas de zone du bas systématiquement vide à cette
 * taille. Rendu ici dans le flux normal (dernier élément de `<main>`, voir
 * app-shell.tsx) : il apparaît après le dernier contenu de la page, défile
 * avec elle, ne recouvre jamais rien.
 */
import { useCallback, useState } from 'react';
import { Mic, Loader2, Check, X, HelpCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { useDictee } from '@/hooks/use-dictee';
import { apiFetch } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { CHAMPS_CORRIGEABLES } from '@nodaq/shared';

const API = '/api';

interface Operation {
  type: string;
  libelle: string;
  certitude: string;
  /** Les champs résolus. Seuls ceux de `CHAMPS_CORRIGEABLES` sont modifiables. */
  champs?: Record<string, string | null>;
  /**
   * Champs que la voix laisse volontairement vides et que le serveur réclame
   * avant d'écrire — un prix de catalogue, un montant de charge ou de
   * contrat. Optionnel : un plan produit avant le lot 4 n'a pas ce champ, et
   * les plans vivent une heure en base.
   */
  aCompleter?: string[];
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

  /**
   * Corrections saisies avant validation : index d'opération → champ → valeur.
   *
   * Un nom propre entendu par une machine devient facilement autre chose —
   * « Menuiserie Delacroix » ressort en « Menuiserie de la Croix ». L'écran
   * montrait ce qui allait être écrit sans permettre de le rectifier : il
   * fallait tout annuler et redicter, ce que personne ne fait deux fois.
   */
  const [corrections, setCorrections] = useState<Record<string, Record<string, string>>>({});

  const corriger = (i: number, champ: string, valeur: string) =>
    setCorrections((c) => ({ ...c, [i]: { ...(c[i] ?? {}), [champ]: valeur } }));

  /**
   * Les champs encore vides que le serveur réclame — un prix de catalogue, un
   * montant de charge ou de contrat. La voix ne les porte pas : ni le modèle
   * (il n'a pas le droit de fixer un prix), ni le serveur (il n'a rien à
   * calculer, c'est une décision commerciale).
   *
   * Ce blocage est un CONFORT : le serveur refuse de toute façon un plan dont
   * un champ réclamé est vide. On ne laisse pas l'utilisateur appuyer sur un
   * bouton qui va échouer, voilà tout.
   */
  const incomplets = (plan?.operations ?? []).flatMap((o, i) =>
    (o.aCompleter ?? []).filter((c) => (corrections[i]?.[c] ?? '').trim() === ''),
  );

  const valider = useCallback(async () => {
    if (!plan) return;
    setApplique(true);
    try {
      const res = await apiFetch(`${API}/voix/executer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: plan.planId,
          ...(Object.keys(corrections).length > 0 ? { corrections } : {}),
        }),
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
      {/* `flex justify-center` : centre le bouton horizontalement — `Button`
          est `inline-flex`, une marge `auto` seule ne le centrerait pas. */}
      <div className="flex justify-center py-8">
        <Button
          aria-label="Dicter une commande"
          data-testid="bouton-micro-flottant"
          size="icon"
          className="h-20 w-20 rounded-full shadow-lg"
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
      </div>

      <Sheet open={plan !== null} onOpenChange={(o) => { if (!o) setPlan(null); }}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Ce que j’ai compris</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 py-4">
            {plan?.operations.length ? (
              <ul className="space-y-2" data-testid="liste-operations">
                {plan.operations.map((o, i) => {
                  const modifiables = CHAMPS_CORRIGEABLES[o.type as keyof typeof CHAMPS_CORRIGEABLES] ?? [];
                  const reclames = o.aCompleter ?? [];
                  // Un champ RÉCLAMÉ est vide par construction : le filtre
                  // « a déjà une valeur » l'écarterait, et il ne s'afficherait
                  // jamais. On l'ajoute explicitement.
                  const aCorriger = [
                    ...modifiables.filter((c) => o.champs?.[c] != null),
                    ...reclames.filter((c) => o.champs?.[c] == null),
                  ];
                  return (
                    <li key={i} className="rounded-lg border border-card-border p-3 text-sm">
                      {o.libelle}
                      {o.certitude === 'partielle' && (
                        <span className="ml-2 text-xs text-muted-foreground">(rapprochement approximatif)</span>
                      )}
                      {/* Les champs DICTÉS se relisent et se corrigent ici.
                          Jamais les identifiants résolus : les modifier ne
                          serait plus corriger une transcription, mais viser
                          autre chose que ce que le libellé annonce. */}
                      {aCorriger.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {aCorriger.map((champ) => {
                            const manquant =
                              reclames.includes(champ) &&
                              (corrections[i]?.[champ] ?? '').trim() === '';
                            return (
                              <div key={champ} className="flex items-center gap-2">
                                <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                                  {champ}
                                </span>
                                <Input
                                  value={corrections[i]?.[champ] ?? o.champs?.[champ] ?? ''}
                                  onChange={(e) => corriger(i, champ, e.target.value)}
                                  placeholder={reclames.includes(champ) ? 'à saisir' : undefined}
                                  aria-invalid={manquant || undefined}
                                  className={`h-9 text-sm${manquant ? ' border-amber-500' : ''}`}
                                  data-testid={`correction-${i}-${champ}`}
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
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

            {/* Un bouton grisé sans motif est une impasse : on dit pourquoi,
                et ce que la voix ne peut légitimement pas fournir. */}
            {incomplets.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="montant-a-saisir">
                Un montant reste à saisir : je ne le devine pas, et je ne
                l’invente pas.
              </p>
            )}

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
              disabled={applique || !plan?.operations.length || incomplets.length > 0}
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
