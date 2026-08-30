/**
 * L'aide — un assistant qui EXPLIQUE, et qui ne touche à rien.
 *
 * Volontairement distinct de l'Agent IA. L'agent AGIT : il propose des devis,
 * des factures, des règlements, et chaque proposition attend une validation.
 * Celui-ci n'a aucun outil et ne lit aucune donnée de l'entreprise — il répond
 * à « comment on fait pour… ».
 *
 * Les mélanger ferait un assistant qui parfois répond, parfois écrit, sans que
 * l'artisan sache lequel des deux il a devant lui.
 */
import { useRef, useState, useEffect } from 'react';
import { LifeBuoy, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/page-header';
import { apiFetch } from '@/lib/auth';

interface Tour { role: 'user' | 'assistant'; contenu: string }

/**
 * Les questions qu'on pose vraiment. Elles ne sont pas décoratives : devant un
 * champ vide, quelqu'un qui n'ose pas demander repart sans rien.
 */
const AMORCES = [
  'Comment corriger une facture déjà envoyée ?',
  'Comment faire signer un devis à distance ?',
  "Qu'est-ce que l'attestation TVA qu'on me demande ?",
  'Comment donner un accès à mon comptable ?',
];

export default function AidePage() {
  const [tours, setTours] = useState<Tour[]>([]);
  const [saisie, setSaisie] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const bas = useRef<HTMLDivElement>(null);

  useEffect(() => { bas.current?.scrollIntoView({ behavior: 'smooth' }); }, [tours, envoi]);

  async function envoyer(texte: string) {
    const question = texte.trim();
    if (!question || envoi) return;
    setErreur(null);
    setSaisie('');
    const avant = tours;
    setTours([...avant, { role: 'user', contenu: question }]);
    setEnvoi(true);
    try {
      const res = await apiFetch('/api/support/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // L'historique est renvoyé par l'écran : rien n'est conservé côté
        // serveur, une question d'aide contenant souvent une situation réelle.
        body: JSON.stringify({ message: question, historique: avant.map(t => ({ role: t.role, contenu: t.contenu })) }),
      });
      const donnees = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErreur(donnees.error ?? "L'assistant n'a pas pu répondre.");
        return;
      }
      setTours(t => [...t, { role: 'assistant', contenu: donnees.reponse }]);
    } catch {
      setErreur('Connexion interrompue. Réessayez.');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        eyebrow="Aide"
        title="Comment on fait ?"
        description="Posez votre question sur l'utilisation de nodaq. Cet assistant explique — il ne touche à aucune de vos données."
      />

      <div className="flex-1 overflow-y-auto px-5 md:px-8 py-6 space-y-4">
        {tours.length === 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <LifeBuoy className="h-4 w-4" />
              Les questions le plus souvent posées :
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {AMORCES.map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => envoyer(q)}
                  className="text-left text-sm rounded-lg border border-card-border bg-card px-4 py-3 hover:border-primary/50 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {tours.map((t, i) => (
          <div
            key={i}
            className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={
                t.role === 'user'
                  ? 'max-w-[85%] rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 text-sm'
                  : 'max-w-[85%] rounded-2xl bg-card border border-card-border px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed'
              }
            >
              {t.contenu}
            </div>
          </div>
        ))}

        {envoi && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> L'assistant cherche…
          </div>
        )}
        {erreur && <p className="text-sm text-destructive">{erreur}</p>}
        <div ref={bas} />
      </div>

      <form
        onSubmit={e => { e.preventDefault(); envoyer(saisie); }}
        className="border-t border-border px-5 md:px-8 py-4 flex gap-2 items-end"
      >
        <Textarea
          value={saisie}
          onChange={e => setSaisie(e.target.value)}
          onKeyDown={e => {
            // Entrée envoie, Maj+Entrée passe à la ligne — l'usage attendu.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyer(saisie); }
          }}
          placeholder="Votre question…"
          rows={1}
          className="min-h-[44px] max-h-32 resize-none"
          aria-label="Votre question"
        />
        <Button
          type="submit"
          disabled={envoi || !saisie.trim()}
          className="h-11 shrink-0"
          // Un bouton qui ne porte qu'une icône n'a AUCUN nom pour un lecteur
          // d'écran : il s'annonce « bouton ». Une garde du dépôt le refuse.
          aria-label="Envoyer la question"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
