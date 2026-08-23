/**
 * Le retour à chaud sous une production de l'agent — ticket 4.36, lot C.
 *
 * ── Un clic, jamais un formulaire ─────────────────────────────────────────
 * Deux pouces, discrets, sous la production. Le champ libre n'apparaît
 * qu'APRÈS un pouce en bas, et il reste facultatif : exiger une explication
 * transformerait un geste d'une seconde en corvée, et on ne recueillerait plus
 * rien du tout.
 *
 * ── Jamais bloquant, jamais une fenêtre ───────────────────────────────────
 * Aucune modale, aucun envoi à confirmer. L'échec est silencieux côté
 * utilisateur : personne ne doit être interrompu parce qu'un avis n'est pas
 * parti — c'est un signal pour nous, pas une action pour lui.
 */
import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/auth';

const API = '/api';

type Note = 'POUCE_HAUT' | 'POUCE_BAS';

export function RetourAgent({
  typeProduction,
  referenceId,
}: {
  /** devis_genere, plan_vocal, resume, relance_proposee… */
  typeProduction: string;
  referenceId?: string;
}) {
  const [donne, setDonne] = useState<Note | null>(null);
  const [verbatim, setVerbatim] = useState('');
  const [envoye, setEnvoye] = useState(false);

  const envoyer = (note: Note, texte?: string): void => {
    setDonne(note);
    void apiFetch(`${API}/agent/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        typeProduction,
        ...(referenceId ? { referenceId } : {}),
        note,
        ...(texte?.trim() ? { verbatim: texte.trim() } : {}),
      }),
      // Un avis qui ne part pas n'interrompt personne : c'est un signal pour
      // nous, pas une action pour l'utilisateur.
    }).catch(() => {});
  };

  if (envoye) {
    return (
      <p className="mt-1.5 text-[11px] text-muted-foreground" data-testid="retour-agent-merci">
        Merci — c’est noté.
      </p>
    );
  }

  return (
    <div className="mt-1.5" data-testid="retour-agent">
      {donne === null && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Ce résultat vous va ?</span>
          <button
            type="button"
            aria-label="Ce résultat me va"
            onClick={() => { envoyer('POUCE_HAUT'); setEnvoye(true); }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Ce résultat ne me va pas"
            onClick={() => envoyer('POUCE_BAS')}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Le champ n'apparaît qu'après un pouce en bas. Le pouce est DÉJÀ
          enregistré : ce qui suit est un bonus, pas une condition. */}
      {donne === 'POUCE_BAS' && (
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <Input
            autoFocus
            value={verbatim}
            onChange={(e) => setVerbatim(e.target.value)}
            placeholder="Qu’est-ce qui ne va pas ? (facultatif)"
            className="h-9 flex-1 text-sm"
            data-testid="retour-agent-verbatim"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { envoyer('POUCE_BAS', verbatim); setEnvoye(true); }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => { envoyer('POUCE_BAS', verbatim); setEnvoye(true); }}
          >
            Envoyer
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEnvoye(true)}>
            Passer
          </Button>
        </div>
      )}
    </div>
  );
}
