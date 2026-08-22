/**
 * Bannière de conformité facturation électronique — ticket 4.36, lot B.
 *
 * ── Le ton, qui est tout le sujet ─────────────────────────────────────────
 * « On s'en occupe avec vous », jamais « vous risquez une amende ». Un artisan
 * qui reçoit une menace de son logiciel de gestion ferme le logiciel. La
 * décision de ce qui s'affiche vit dans `messageConformite` (partagé,
 * éprouvé) — ce composant met en page, il ne rédige pas.
 *
 * ── Fermable, mais pas oubliable ──────────────────────────────────────────
 * Fermer dit « pas maintenant », pas « plus jamais » : la bannière revient à
 * l'approche de l'échéance. Elle ne revient PAS quand le tenant est prêt ou
 * inscrit sur la liste d'attente — on ne harcèle pas quelqu'un qui a déjà
 * fait ce qu'il fallait.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import {
  messageConformite,
  doitReapparaitre,
  ETAPES_COMMENT_CA_MARCHE,
} from '@nodaq/shared';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';
import { toDateString } from '@/lib/format';

const API = '/api';

type Etat = {
  situation: { raccordementConfirme: boolean; inscritListeAttenteLe: string | null };
  bannièreFermeeLe: string | null;
};

export function BanniereConformite() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [commentOuvert, setCommentOuvert] = useState(false);

  const { data } = useQuery<Etat>({
    queryKey: ['conformite-facturation'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/facturation-electronique/conformite`);
      if (!r.ok) throw new Error('Chargement impossible');
      return r.json();
    },
  });

  const inscrire = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`${API}/facturation-electronique/liste-attente`, { method: 'POST' });
      if (!r.ok) throw new Error("L'inscription n'a pas abouti");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conformite-facturation'] });
      setCommentOuvert(false);
      toast({
        title: 'C’est noté',
        description: 'Nous vous guiderons dès que le raccordement sera disponible.',
      });
    },
    onError: (e: Error) =>
      toast({ title: "Rien n'a été enregistré", description: e.message, variant: 'destructive' }),
  });

  const fermer = useMutation({
    mutationFn: async () => {
      await apiFetch(`${API}/facturation-electronique/banniere-fermee`, { method: 'POST' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conformite-facturation'] }),
  });

  // `data?.situation` et non `!data` : une réponse d'une forme inattendue —
  // ancienne version du serveur, requête simulée dans un test d'écran — ne
  // doit pas faire tomber le COCKPIT ENTIER pour une bannière d'information.
  // C'est l'audit d'accessibilité qui l'a signalé, en rendant les deux écrans.
  if (!data?.situation) return null;

  const aujourdhui = toDateString(new Date());
  const message = messageConformite(data.situation, aujourdhui);
  if (!doitReapparaitre(data.bannièreFermeeLe, message.etat, aujourdhui)) return null;

  const pret = message.etat === 'PRET';
  const attente = message.etat === 'EN_ATTENTE';
  const Icone = pret ? CheckCircle2 : attente ? Clock : ArrowRight;

  return (
    <>
      <div
        // Jamais rouge, même l'échéance passée : la couleur d'alerte
        // transformerait une information en reproche.
        className={`relative rounded-xl border p-4 ${
          pret
            ? 'border-primary/25 bg-primary/5'
            : 'border-card-border bg-card'
        }`}
        data-testid="banniere-conformite"
      >
        <div className="flex items-start gap-3">
          <Icone className={`mt-0.5 h-5 w-5 shrink-0 ${pret ? 'text-primary' : 'text-muted-foreground'}`} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">{message.titre}</p>
            <p className="mt-1 text-sm text-muted-foreground">{message.corps}</p>
            {message.action && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3 gap-1.5"
                onClick={() => setCommentOuvert(true)}
              >
                {message.action} <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {/* Pas de croix quand il n'y a plus rien à faire : fermer une bonne
              nouvelle n'a pas de sens, et la bannière disparaîtra d'elle-même. */}
          {!pret && (
            <button
              type="button"
              aria-label="Masquer pour le moment"
              onClick={() => fermer.mutate()}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <Sheet open={commentOuvert} onOpenChange={setCommentOuvert}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Comment ça marche</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            {ETAPES_COMMENT_CA_MARCHE.map((e, i) => (
              <div key={e.titre} className="flex gap-3">
                {/* Numérotées parce que c'est une SÉQUENCE : l'ordre porte une
                    information, chaque étape suppose la précédente. */}
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-foreground">{e.titre}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{e.texte}</p>
                </div>
              </div>
            ))}

            <div className="rounded-lg border border-card-border bg-muted/40 p-3">
              <p className="text-sm text-foreground">
                Le raccordement n’est pas encore ouvert dans nodaq. Inscrivez-vous :
                nous vous guiderons dès qu’il le sera, et vous n’aurez rien à surveiller.
              </p>
              <Button
                className="mt-3 w-full"
                onClick={() => inscrire.mutate()}
                disabled={inscrire.isPending}
              >
                {inscrire.isPending ? 'Enregistrement…' : 'Prévenez-moi'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
