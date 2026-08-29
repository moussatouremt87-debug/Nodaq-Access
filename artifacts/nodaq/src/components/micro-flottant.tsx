/**
 * Micro — présent sur TOUTES les pages, en fin de contenu.
 *
 * « Vous ne tapez plus jamais rien. » La voix pour dire et pour commander ;
 * l'ÉCRAN pour confirmer. Appui long pour parler, relâché pour envoyer.
 *
 * RIEN NE S'ÉCRIT AVANT « Valider ». La feuille montre ce que l'assistant a
 * répondu, puis les écritures qu'il propose, champ par champ.
 *
 * Pas de synthèse vocale : la confirmation est visuelle, c'est la promesse
 * qu'on tient.
 *
 * ── UN SEUL AGENT, PAS DEUX ─────────────────────────────────────────────
 * Le micro a longtemps tapé sur `/voix/interpreter`, un extracteur
 * d'intentions écrit à côté de l'agent de discussion : sans mémoire, sans
 * outils, incapable de résoudre « pour le même client » puisqu'il ne recevait
 * qu'une phrase isolée. Deux implémentations du même métier, dont une infirme.
 *
 * Le 29/08/2026, « Pour le même client, Madame Touré, pour la réfection du mur
 * pour 1200 euros » n'a rien produit — une phrase de suite, adressée à un
 * système sans passé.
 *
 * Le micro envoie donc à `/chat/messages`, l'agent RÉEL : il a l'historique de
 * la conversation et les outils (`create_devis`, `create_facture`,
 * `create_client`, …). Ce qu'il propose revient en `operations` + `planId`,
 * dans le MÊME magasin de plans qu'avant — `/voix/executer` les applique sans
 * savoir quel chemin les a produits. La règle 4 est donc intacte : rien ne
 * s'écrit avant « Valider ».
 *
 * ── PAS EN `position: fixed` ─────────────────────────────────────────────
 * Un bouton flottant, agrandi et centré, recouvrait le contenu de chaque
 * page — il n'existe pas de zone du bas systématiquement vide à cette
 * taille. Rendu ici dans le flux normal (dernier élément de `<main>`, voir
 * app-shell.tsx) : il apparaît après le dernier contenu de la page, défile
 * avec elle, ne recouvre jamais rien.
 */
import { useCallback, useState } from 'react';
import { Mic, Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { useDictee } from '@/hooks/use-dictee';
import { apiFetch } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { RetourAgent } from '@/components/retour-agent';
import { CLE_CONVERSATION } from '@/hooks/use-chat';
import { CHAMPS_CORRIGEABLES } from '@nodaq/shared';

const API = '/api';

/** Une ligne dictée, telle que le serveur la propose. */
interface LigneDictee {
  libelle: string;
  quantite: number | null;
  unite: string | null;
  /**
   * Prix DICTÉ, déjà vérifié dans la transcription par le serveur. Absent le
   * plus souvent : le prix vient alors du catalogue, au moment de valider.
   */
  prixUnitaireHtCents?: number | null;
}

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


interface Plan {
  // `null` quand rien n'a produit d'opération : rien n'est enregistré côté
  // serveur dans ce cas, donc rien à valider — voir routes/voix.ts.
  planId: string | null;
  operations: Operation[];
  /**
   * Toujours vides depuis que le micro passe par l'agent : celui-ci tranche
   * ses ambiguïtés en PARLANT, il n'a pas besoin du mécanisme de
   * désambiguïsation de l'ancien extracteur, qui ne pouvait pas poser de
   * question. Conservés parce que le magasin de plans les porte encore côté
   * serveur — les retirer ferait diverger le client du contrat.
   */
  questions: unknown[];
  nonCompris: string[];
}

/**
 * Les lignes dictées d'une opération, ou une liste vide.
 *
 * Elles voyagent sérialisées dans `champs.lignesDicteesJson` — le plan attend
 * en base, et c'est cette chaîne qui sera reprise à l'identique à la
 * validation. Un JSON illisible ne fait pas tomber l'écran : on rend une
 * liste vide, et le libellé porte déjà le total.
 */
function lignesDe(o: Operation): LigneDictee[] {
  try {
    const brut = JSON.parse(o.champs?.['lignesDicteesJson'] ?? '[]');
    return Array.isArray(brut) ? (brut as LigneDictee[]) : [];
  } catch {
    return [];
  }
}

export function MicroFlottant() {
  const { toast } = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [interprete, setInterprete] = useState(false);
  const [applique, setApplique] = useState(false);

  /** Ce qui a été dit, mot pour mot. Sert à interroger l'assistant. */
  const [dictee, setDictee] = useState('');
  /** La réponse de l'assistant, quand la phrase n'était pas une commande. */
  const [reponseAgent, setReponseAgent] = useState<string | null>(null);


  const interpreter = useCallback(
    async (texte: string) => {
      setInterprete(true);
      setDictee(texte);
      setReponseAgent(null);
      try {
        const res = await apiFetch(`${API}/chat/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: texte,
            // La MÊME conversation que l'écran de discussion : c'est ce qui
            // permet à « pour le même client » de désigner quelqu'un.
            conversationId: localStorage.getItem(CLE_CONVERSATION),
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? "L'assistant n'a pas répondu");
        }
        const j = (await res.json()) as {
          conversationId?: string;
          message?: { content?: string };
          planId?: string | null;
          operations?: Operation[];
        };
        if (j.conversationId) localStorage.setItem(CLE_CONVERSATION, j.conversationId);
        setReponseAgent(j.message?.content ?? null);
        setPlan({
          planId: j.planId ?? null,
          operations: j.operations ?? [],
          // L'agent tranche ses ambiguïtés dans la conversation, en posant la
          // question — il n'a pas besoin du mécanisme de désambiguïsation de
          // l'ancien extracteur, qui ne pouvait pas parler.
          questions: [],
          nonCompris: [],
        });
      } catch (err) {
        setReponseAgent(
          err instanceof Error
            ? `L'assistant n'a pas pu répondre : ${err.message}`
            : "L'assistant n'a pas pu répondre.",
        );
        setPlan({ planId: null, operations: [], questions: [], nonCompris: [] });
      } finally {
        setInterprete(false);
      }
    },
    [],
  );

  const { enregistre, transcrit, erreur, demarrer, arreter } = useDictee(interpreter);

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
      {/* État VISIBLE, et qui reste. Un toast disparaît avant qu'on ait fini
          de le lire quand on a les mains prises et le soleil dans l'écran. */}
      {erreur && (
        <div
          className="mx-auto mb-2 max-w-md rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
          role="status"
          data-testid="erreur-dictee"
        >
          {erreur}
        </div>
      )}
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
            <SheetTitle>{plan?.operations.length ? 'À valider' : 'Réponse'}</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 py-4">
            {/*
                L'agent PARLE, toujours — puis propose s'il y a lieu.
                L'ancien panneau n'affichait qu'un verdict d'extracteur ;
                celui-ci rend une conversation, comme l'écran de discussion.
            */}
            <div className="space-y-3" data-testid="reponse-agent-bloc">
              <div className="rounded-lg border border-card-border bg-muted/40 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Vous avez dit
                </p>
                <p className="mt-1 text-sm text-foreground">{dictee}</p>
              </div>

              {interprete ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="agent-en-cours">
                  <Loader2 className="h-4 w-4 animate-spin" /> L’assistant réfléchit…
                </p>
              ) : reponseAgent ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="reponse-agent">
                  <p className="whitespace-pre-wrap text-sm text-foreground">{reponseAgent}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Cet échange est dans votre discussion : vous pouvez le reprendre là-bas.
                  </p>
                </div>
              ) : null}
            </div>

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

                      {/*
                        LE DÉTAIL DES LIGNES, pour un devis ou une facture.

                        Le libellé annonce un total ; le total seul ne se
                        vérifie pas. « 3 000 € HT » peut recouvrir la bonne
                        ligne au mauvais prix, ou l'inverse — et ce document
                        part chez un client. On valide ce qu'on VOIT, donc on
                        montre ce qui sera écrit, ligne par ligne.
                      */}
                      {lignesDe(o).length > 0 && (
                        <ul className="mt-2 space-y-1" data-testid={`lignes-dictees-${i}`}>
                          {lignesDe(o).map((l, j) => (
                            <li key={j} className="flex justify-between gap-3 text-xs text-muted-foreground">
                              <span className="min-w-0 break-words">
                                {l.libelle}
                                {l.quantite !== null ? ` × ${l.quantite}` : ''}
                                {l.unite ? ` ${l.unite}` : ''}
                              </span>
                              <span className="shrink-0 tabular-nums">
                                {/* Une ligne sans prix le DIT. Afficher « 0 € »
                                    ferait passer une absence pour une gratuité. */}
                                {typeof l.prixUnitaireHtCents === 'number' && l.prixUnitaireHtCents > 0
                                  ? `${(l.prixUnitaireHtCents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT`
                                  : 'prix au catalogue'}
                              </span>
                            </li>
                          ))}
                        </ul>
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
            ) : null}


            {/* Un bouton grisé sans motif est une impasse : on dit pourquoi,
                et ce que la voix ne peut légitimement pas fournir. */}
            {incomplets.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="montant-a-saisir">
                Un montant reste à saisir : je ne le devine pas, et je ne
                l’invente pas.
              </p>
            )}


            {/* Ticket 4.36 lot C — le jugement se recueille ICI, pendant que la
                feuille est lue, pas après la validation : c'est le plan qu'on
                juge, et un plan refusé est le signal le plus utile.
                Sans `planId`, l'index d'unicité ne s'applique pas et un
                double-clic compterait deux fois — on préfère ne rien demander
                (plans d'avant le lot 4, en voie d'extinction). */}
            {plan?.planId ? (
              <RetourAgent typeProduction="plan_vocal" referenceId={plan.planId} />
            ) : null}
          </div>

          {/*
              QUAND L'AGENT N'A RIEN PROPOSÉ, IL N'Y A RIEN À VALIDER.

              Le panneau montrait « Valider » grisé sous une réponse du type
              « souhaitez-vous que je procède ? ». L'utilisateur lisait une
              question, cherchait le bouton pour dire oui, et le trouvait
              inactif : impasse. Constaté le 29/08/2026.

              On n'affiche donc qu'une porte de sortie — « Fermer » — et l'on
              dit où répondre. La consigne de l'agent a été corrigée pour
              qu'il PROPOSE au lieu de demander, mais l'écran ne doit pas
              dépendre de la docilité d'un modèle.
          */}
          {plan?.operations.length ? (
            <div className="flex gap-2 pb-2">
              <Button variant="outline" className="flex-1" onClick={() => setPlan(null)}>
                <X className="mr-2 h-4 w-4" /> Annuler
              </Button>
              <Button
                className="flex-1"
                onClick={() => void valider()}
                disabled={applique || incomplets.length > 0}
                data-testid="bouton-valider-plan"
              >
                {applique ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Valider
              </Button>
            </div>
          ) : (
            <div className="space-y-2 pb-2">
              <p className="text-xs text-muted-foreground" data-testid="rien-a-valider">
                Rien à valider ici : l’assistant a répondu sans proposer d’écriture.
                Redictez, ou poursuivez dans la discussion.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setPlan(null)}>
                <X className="mr-2 h-4 w-4" /> Fermer
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
