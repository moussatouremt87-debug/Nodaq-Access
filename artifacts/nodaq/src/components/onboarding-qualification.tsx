/**
 * Les écrans de qualification — ticket 4.36, lot A, côté écran.
 *
 * ── Ils ne sont pas un questionnaire marketing ────────────────────────────
 * Chaque réponse d'ici a un effet, et l'écran le DIT à celui qui répond :
 *   • le stade décide de ce que le compte pourra émettre, et fait sauter la
 *     recherche SIREN quand il n'y a pas encore d'entreprise ;
 *   • l'irritant choisit la première action proposée à la fin du parcours.
 * Les deux réponses qui ne servent qu'à nous — effectif, outil quitté — sont
 * annoncées comme telles. Les mélanger sans le dire serait malhonnête.
 *
 * ── Chaque écran est passable ─────────────────────────────────────────────
 * « Plus tard » partout, et le PATCH n'envoie qu'un champ à la fois : un
 * parcours abandonné au troisième écran laisse quand même les deux premières
 * réponses en base. Un onboarding tout-ou-rien perd tout à la première
 * hésitation.
 */
import { useState, useEffect, type ReactNode } from 'react';
import { ArrowRight, Check, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/auth';
import {
  STADES_ENTREPRISE, LIBELLE_STADE,
  EFFECTIFS, LIBELLE_EFFECTIF,
  GESTIONS_ACTUELLES, LIBELLE_GESTION,
  IRRITANTS, LIBELLE_IRRITANT,
  type StadeEntreprise, type Effectif, type GestionActuelle, type Irritant,
} from '@nodaq/shared';

const API = '/api';

/**
 * Enregistre UNE réponse. Ne rend jamais d'erreur à l'utilisateur : une
 * qualification qui ne part pas ne doit pas bloquer une inscription — c'est
 * une information pour nous, pas une étape pour lui.
 */
export async function repondre(champs: Record<string, unknown>): Promise<void> {
  await apiFetch(`${API}/onboarding/qualification`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(champs),
  }).catch(() => {});
}

function Choix<T extends string>({
  titre, aide, options, libelle, valeur, onChoisir, testid,
}: {
  titre: string;
  aide?: ReactNode;
  options: readonly T[];
  libelle: Readonly<Record<T, string>>;
  valeur: T | null;
  onChoisir: (v: T) => void;
  testid: string;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground">{titre}</h2>
      {aide && <p className="mt-1 text-sm text-muted-foreground">{aide}</p>}
      <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChoisir(o)}
            aria-pressed={valeur === o}
            data-testid={`${testid}-${o}`}
            className={`rounded-xl border p-3.5 text-left text-sm transition-colors ${
              valeur === o
                ? 'border-primary bg-primary/5 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-primary/40'
            }`}
          >
            {libelle[o]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Pied({
  onSuivant, onPasser, actif,
}: { onSuivant: () => void; onPasser: () => void; actif: boolean }) {
  return (
    <div className="flex gap-2 pt-6">
      <Button onClick={onSuivant} disabled={!actif} className="gap-1.5">
        <ArrowRight className="h-4 w-4" /> Continuer
      </Button>
      {/* « Plus tard », jamais « Passer » : on ne ferme pas la porte. */}
      <Button variant="ghost" onClick={onPasser} className="text-muted-foreground">
        Plus tard
      </Button>
    </div>
  );
}

/** Écran 1 — le stade. La seule réponse qui change ce que le compte PEUT faire. */
export function EcranStade({
  onNext, onSkip,
}: { onNext: (stade: StadeEntreprise | null) => void; onSkip: () => void }) {
  const [v, setV] = useState<StadeEntreprise | null>(null);
  return (
    <div data-testid="ecran-stade">
      <Choix
        titre="Où en est votre entreprise ?"
        aide={
          <>
            Vous pouvez tout préparer dans les trois cas. Ce qui demande un
            numéro SIREN, c’est l’émission de devis et de factures — pas
            l’accès à l’application.
          </>
        }
        options={STADES_ENTREPRISE}
        libelle={LIBELLE_STADE}
        valeur={v}
        onChoisir={setV}
        testid="stade"
      />
      <Pied
        actif={v !== null}
        onSuivant={() => { if (v) void repondre({ stade: v }); onNext(v); }}
        onPasser={onSkip}
      />
    </div>
  );
}

/** Écran 2 — l'effectif. Veille : il ne configure rien, et l'écran le dit. */
export function EcranEffectif({
  onNext, onSkip,
}: { onNext: () => void; onSkip: () => void }) {
  const [v, setV] = useState<Effectif | null>(null);
  return (
    <div data-testid="ecran-effectif">
      <Choix
        titre="Combien êtes-vous ?"
        aide="Cela nous sert à comprendre pour qui nous construisons — rien ne change dans l’application selon votre réponse."
        options={EFFECTIFS}
        libelle={LIBELLE_EFFECTIF}
        valeur={v}
        onChoisir={setV}
        testid="effectif"
      />
      <Pied
        actif={v !== null}
        onSuivant={() => { if (v) void repondre({ effectif: v }); onNext(); }}
        onPasser={onSkip}
      />
    </div>
  );
}

/** Écran 3 — la gestion actuelle, et l'outil quitté. Veille également. */
export function EcranGestion({
  onNext, onSkip,
}: { onNext: () => void; onSkip: () => void }) {
  const [v, setV] = useState<GestionActuelle | null>(null);
  const [logiciel, setLogiciel] = useState('');
  return (
    <div data-testid="ecran-gestion">
      <Choix
        titre="Comment faites-vous aujourd’hui ?"
        aide="Pour savoir d’où viennent nos utilisateurs. Aucune conséquence sur votre compte."
        options={GESTIONS_ACTUELLES}
        libelle={LIBELLE_GESTION}
        valeur={v}
        onChoisir={setV}
        testid="gestion"
      />
      {v === 'AUTRE_LOGICIEL' && (
        <div className="mt-3">
          <Input
            autoFocus
            value={logiciel}
            onChange={(e) => setLogiciel(e.target.value)}
            placeholder="Lequel ? (facultatif)"
            data-testid="gestion-logiciel"
          />
        </div>
      )}
      <Pied
        actif={v !== null}
        onSuivant={() => {
          if (v) {
            void repondre({
              gestionActuelle: v,
              ...(v === 'AUTRE_LOGICIEL' && logiciel.trim()
                ? { logicielActuel: logiciel.trim() }
                : {}),
            });
          }
          onNext();
        }}
        onPasser={onSkip}
      />
    </div>
  );
}

/** Écran 4 — l'irritant. La seule réponse dont l'effet est visible tout de suite. */
export function EcranIrritant({
  onNext, onSkip,
}: { onNext: () => void; onSkip: () => void }) {
  const [v, setV] = useState<Irritant | null>(null);
  const [verbatim, setVerbatim] = useState('');
  return (
    <div data-testid="ecran-irritant">
      <Choix
        titre="Qu’est-ce qui vous coûte le plus, aujourd’hui ?"
        aide="Votre réponse décide par quoi on commence, à la fin de ce parcours."
        options={IRRITANTS}
        libelle={LIBELLE_IRRITANT}
        valeur={v}
        onChoisir={setV}
        testid="irritant"
      />
      {v === 'AUTRE' && (
        <div className="mt-3">
          <Input
            autoFocus
            value={verbatim}
            onChange={(e) => setVerbatim(e.target.value)}
            placeholder="Dites-le avec vos mots (facultatif)"
            data-testid="irritant-verbatim"
          />
        </div>
      )}
      <Pied
        actif={v !== null}
        onSuivant={() => {
          if (v) {
            void repondre({
              irritant: v,
              ...(v === 'AUTRE' && verbatim.trim() ? { irritantVerbatim: verbatim.trim() } : {}),
            });
          }
          onNext();
        }}
        onPasser={onSkip}
      />
    </div>
  );
}

/**
 * Écran 5 — la fin du parcours : UNE action concrète.
 *
 * ── Pourquoi pas le cockpit ───────────────────────────────────────────────
 * « L'onboarding se termine par une action concrète, pas par un cockpit
 * vide. » Un tableau de bord sans données ne montre rien et n'apprend rien :
 * c'est le pire écran d'accueil possible pour quelqu'un qui vient de
 * s'inscrire. L'action affichée ici est celle que `premiereAction()` a
 * choisie D'APRÈS l'irritant donné trois écrans plus tôt — c'est ce qui rend
 * la question honnête.
 *
 * Le serveur reste la source : on ne recalcule pas l'action côté écran, sinon
 * deux vérités à maintenir.
 */
export function EcranPremiereAction({ onAller }: { onAller: (chemin: string) => void }) {
  const [action, setAction] = useState<{ cle: string; titre: string; chemin: string } | null>(null);
  const [messageSiren, setMessageSiren] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    void (async () => {
      // Le parcours est fini : on le date, même si tout a été passé.
      await repondre({ terminee: true });
      const res = await apiFetch(`${API}/onboarding/qualification`).catch(() => null);
      if (!res?.ok || !vivant) return;
      const d = (await res.json()) as {
        premiereAction?: { cle: string; titre: string; chemin: string };
        messageSiren?: string | null;
      };
      if (!vivant) return;
      setAction(d.premiereAction ?? null);
      setMessageSiren(d.messageSiren ?? null);
    })();
    return () => { vivant = false; };
  }, []);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Check className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-xl font-semibold">Votre profil est enregistré</h2>

      {messageSiren && (
        <div
          className="flex max-w-md items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-left text-sm"
          data-testid="onboarding-siren-manquant"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>{messageSiren}</span>
        </div>
      )}

      {/* Tant que le serveur n'a pas répondu, on ne devine pas une action :
          proposer la mauvaise puis la remplacer sous les yeux est pire que
          d'attendre une demi-seconde. */}
      {action ? (
        <>
          <p className="max-w-sm text-sm text-muted-foreground">{action.titre}</p>
          <Button onClick={() => onAller(action.chemin)} data-testid="onboarding-premiere-action">
            <ArrowRight className="mr-2 h-4 w-4" /> C’est parti
          </Button>
        </>
      ) : (
        <Button variant="ghost" onClick={() => onAller('/')} className="text-muted-foreground">
          Accéder au cockpit
        </Button>
      )}
    </div>
  );
}
