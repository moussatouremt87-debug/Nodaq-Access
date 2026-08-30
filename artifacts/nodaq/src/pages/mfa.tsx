/**
 * MFA (TOTP) — ticket 4.15, phase 1. Route publique (hors AppShell, voir
 * App.tsx/ROUTES_PUBLIQUES) car une session en attente de second facteur n'a
 * pas de `role` — l'AppShell, qui appelle useIsOwner(), choquerait dessus.
 *
 * Trois usages de cette même page :
 *   - mfaStatus 'enroll_required'  → OWNER/ACCOUNTANT jamais enrôlé, forcé ici
 *     avant d'atteindre quoi que ce soit d'autre.
 *   - mfaStatus 'verify_required'  → déjà enrôlé, mais CETTE session ne l'a
 *     pas encore prouvé (nouvel appareil, nouvelle connexion).
 *   - visite volontaire (MEMBER, ou financier déjà vérifié) — depuis le lien
 *     de la barre latérale : affiche l'état et permet d'activer le MFA
 *     même quand ce n'est pas obligatoire pour ce rôle.
 *
 * Auth-adjacent comme /auth/*: apiFetch direct, pas de client généré.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ShieldCheck, ShieldAlert, Loader2, KeyRound, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';
import { useAuth } from '@/hooks/use-auth';
import {
  lireEnrolement,
  memoriserEnrolement,
  oublierEnrolement,
} from '@/lib/enrolement-en-cours';

type Etape =
  | 'chargement'
  /** Le chemin par DÉFAUT depuis le 30/08/2026 : six chiffres reçus par courriel. */
  | 'code-courriel'
  | 'enrolement'
  | 'codes-recuperation'
  | 'verification'
  | 'recuperation'
  | 'parametres';

interface EtatEnrolement { secret: string; qrDataUri: string; otpauthUri: string }
interface EtatStatut { enabled: boolean; recoveryCodesRemaining?: number }

export default function MfaPage() {
  const { data: auth, isLoading: authLoading, refetch: refetchAuth } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const searchStr = typeof window !== 'undefined' ? window.location.search : '';
  const from = new URLSearchParams(searchStr).get('from') ?? '/';

  const [etape, setEtape] = useState<Etape>('chargement');
  const [enrolement, setEnrolement] = useState<EtatEnrolement | null>(null);
  const [statut, setStatut] = useState<EtatStatut | null>(null);
  const [codesRecuperation, setCodesRecuperation] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [codeRecup, setCodeRecup] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [codesNotes, setCodesNotes] = useState(false);
  const [renvoye, setRenvoye] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!auth?.authenticated) {
      setLocation('/login');
      return;
    }
    if (auth.mfaStatus === 'code_requis') {
      // Le code est DÉJÀ parti à la connexion : on affiche le champ, on ne
      // redemande pas d'envoi. Sinon un simple rechargement de page enverrait
      // un second courriel et invaliderait le premier code.
      setEtape('code-courriel');
    } else if (auth.mfaStatus === 'enroll_required') {
      demarrerEnrolement();
    } else if (auth.mfaStatus === 'verify_required') {
      setEtape('verification');
    } else {
      chargerStatut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, auth?.authenticated, auth && 'mfaStatus' in auth ? auth.mfaStatus : undefined]);

  /**
   * Le chemin par défaut : six chiffres reçus par courriel.
   *
   * En cas de succès, le serveur pose un cookie d'appareil de confiance : la
   * prochaine connexion sur cette machine ne redemandera rien pendant 90 jours.
   * C'est ce qui fait passer le second facteur de trois cents fois par an à
   * trois ou quatre.
   */
  async function soumettreCodeCourriel(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnvoi(true);
    try {
      const res = await apiFetch('/api/mfa/code/verifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const donnees = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Le serveur dit quoi FAIRE (réessayer, en redemander un). On le rend
        // tel quel plutôt que d'écrire un « Code incorrect » qui laisse
        // l'utilisateur devant un champ vide sans savoir quoi faire.
        setErreur(donnees.error ?? 'Ce code n\'a pas été accepté.');
        setCode('');
        return;
      }
      setLocation('/');
    } finally {
      setEnvoi(false);
    }
  }

  async function renvoyerCode() {
    setErreur(null);
    setRenvoye(false);
    const res = await apiFetch('/api/mfa/code/renvoyer', { method: 'POST' });
    const donnees = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErreur(donnees.error ?? 'Impossible d\'envoyer un nouveau code.');
      return;
    }
    setCode('');
    setRenvoye(true);
  }

  async function demarrerEnrolement() {
    setErreur(null);

    // Un enrôlement déjà commencé dans CET onglet est repris tel quel. Sur
    // téléphone, configurer son authentificateur oblige à quitter la page ;
    // au retour, Safari la recharge souvent. Redemander un secret rendrait
    // alors le code tout juste configuré invalide — « Code incorrect », sans
    // que rien n'explique pourquoi.
    const repris = lireEnrolement();
    if (repris) {
      setEnrolement(repris);
      setEtape('enrolement');
      return;
    }

    const res = await apiFetch('/api/mfa/enroll', { method: 'POST' });
    if (!res.ok) {
      toast({ title: 'Erreur', description: 'Impossible de démarrer l\'enrôlement MFA.', variant: 'destructive' });
      return;
    }
    const donnees = await res.json();
    memoriserEnrolement(donnees);
    setEnrolement(donnees);
    setEtape('enrolement');
  }

  async function chargerStatut() {
    const res = await apiFetch('/api/mfa/status');
    if (res.ok) setStatut(await res.json());
    setEtape('parametres');
  }

  async function soumettreEnrolement(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolement || code.length !== 6) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const res = await apiFetch('/api/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: enrolement.secret, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErreur(data?.error ?? 'Code incorrect.');
        setCode('');
        return;
      }
      // L'enrôlement a abouti : le serveur a persisté le secret, le garder
      // ici le ferait reproposer à un enrôlement suivant.
      oublierEnrolement();
      setCodesRecuperation(data.recoveryCodes ?? []);
      setEtape('codes-recuperation');
    } finally {
      setEnvoi(false);
    }
  }

  async function soumettreVerification(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const res = await apiFetch('/api/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErreur(data?.error ?? 'Code incorrect.');
        setCode('');
        return;
      }
      await terminerVerification();
    } finally {
      setEnvoi(false);
    }
  }

  async function soumettreRecuperation(e: React.FormEvent) {
    e.preventDefault();
    if (!codeRecup.trim()) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const res = await apiFetch('/api/mfa/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeRecup.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErreur(data?.error ?? 'Code incorrect.');
        setCodeRecup('');
        return;
      }
      await terminerVerification();
    } finally {
      setEnvoi(false);
    }
  }

  async function terminerVerification() {
    await qc.invalidateQueries({ queryKey: ['auth-me'] });
    await refetchAuth();
    setLocation(from);
  }

  if (authLoading || etape === 'chargement') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-6 sm:p-8 shadow-xl"
      >
        {etape === 'enrolement' && enrolement && (
          <EnrolementEcran
            enrolement={enrolement}
            code={code}
            setCode={setCode}
            erreur={erreur}
            envoi={envoi}
            onSubmit={soumettreEnrolement}
          />
        )}

        {etape === 'codes-recuperation' && (
          <CodesRecuperationEcran
            codes={codesRecuperation}
            confirme={codesNotes}
            setConfirme={setCodesNotes}
            onContinuer={terminerVerification}
          />
        )}

        {etape === 'code-courriel' && (
          <CodeCourrielEcran
            destinataire={auth && 'destinataire' in auth ? auth.destinataire : undefined}
            code={code}
            setCode={setCode}
            erreur={erreur}
            envoi={envoi}
            renvoye={renvoye}
            onSubmit={soumettreCodeCourriel}
            onRenvoyer={renvoyerCode}
          />
        )}

        {etape === 'verification' && (
          <VerificationEcran
            code={code}
            setCode={setCode}
            erreur={erreur}
            envoi={envoi}
            onSubmit={soumettreVerification}
            onBasculerRecuperation={() => { setEtape('recuperation'); setErreur(null); }}
          />
        )}

        {etape === 'recuperation' && (
          <RecuperationEcran
            codeRecup={codeRecup}
            setCodeRecup={setCodeRecup}
            erreur={erreur}
            envoi={envoi}
            onSubmit={soumettreRecuperation}
            onRetour={() => { setEtape('verification'); setErreur(null); }}
          />
        )}

        {etape === 'parametres' && statut && (
          <ParametresEcran statut={statut} onActiver={demarrerEnrolement} onRetour={() => setLocation(from)} />
        )}
      </motion.div>
    </div>
  );
}

// ── Écrans ────────────────────────────────────────────────────────────────

function EnTete({ icon, titre, description }: { icon: React.ReactNode; titre: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-3 mb-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        {icon}
      </div>
      <div>
        <h1 className="text-xl font-bold text-foreground">{titre}</h1>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}

function ChampCode({ code, setCode, autoFocus }: { code: string; setCode: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="flex justify-center">
      <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus={autoFocus}>
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map(i => <InputOTPSlot key={i} index={i} />)}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}

function EnrolementEcran({ enrolement, code, setCode, erreur, envoi, onSubmit }: {
  enrolement: EtatEnrolement; code: string; setCode: (v: string) => void;
  erreur: string | null; envoi: boolean; onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <>
      <EnTete
        icon={<ShieldAlert className="h-6 w-6" />}
        titre="Activer la double authentification"
        description="Obligatoire pour les comptes ayant accès aux données financières."
      />
      <div className="flex flex-col items-center gap-4">
        {/* ── Sur un téléphone, le QR code ne sert à RIEN (ticket 4.20) ─────
            On ne photographie pas un code affiché sur l'écran qu'on tient.
            L'appui sur l'URI `otpauth://` ouvre directement Google
            Authenticator, 1Password ou l'application installée — c'est le
            chemin normal en mobilité, et il passe donc AVANT le QR.

            Le lien s'affiche partout, pas seulement sous un point de rupture :
            un poste de bureau peut aussi avoir un gestionnaire de mots de
            passe installé, et l'appui y fonctionne tout autant. */}
        <a
          href={enrolement.otpauthUri}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-primary bg-primary/10 px-4 py-3 text-sm font-medium text-primary"
          data-testid="lien-application-authentification"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          Ouvrir mon application d’authentification
        </a>

        <div className="flex w-full items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          ou
          <span className="h-px flex-1 bg-border" />
        </div>

        <img
          src={enrolement.qrDataUri}
          alt="QR code à scanner avec votre application d'authentification"
          className="rounded-lg border border-card-border h-44 w-44"
        />
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          Scannez ce code depuis un AUTRE appareil. Ni l’un ni l’autre ?{' '}
          Saisissez cette clé à la main :{' '}
          <span className="font-mono-nums select-all">{enrolement.secret}</span>
        </p>
        <form onSubmit={onSubmit} className="w-full space-y-4 mt-2">
          <ChampCode code={code} setCode={setCode} autoFocus />
          {erreur && <p className="text-sm text-destructive text-center">{erreur}</p>}
          <Button type="submit" className="w-full" disabled={envoi || code.length !== 6}>
            {envoi ? 'Vérification…' : 'Valider le code'}
          </Button>
        </form>
      </div>
    </>
  );
}

function CodesRecuperationEcran({ codes, confirme, setConfirme, onContinuer }: {
  codes: string[]; confirme: boolean; setConfirme: (v: boolean) => void; onContinuer: () => void;
}) {
  const [copie, setCopie] = useState(false);
  return (
    <>
      <EnTete
        icon={<KeyRound className="h-6 w-6" />}
        titre="Vos codes de récupération"
        description="Notez-les dans un endroit sûr — ils ne seront plus jamais affichés."
      />
      <div className="rounded-lg border border-card-border bg-muted/40 p-4 grid grid-cols-2 gap-2 font-mono-nums text-sm">
        {codes.map(c => <div key={c}>{c}</div>)}
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full mt-3"
        onClick={() => {
          navigator.clipboard?.writeText(codes.join('\n')).then(() => {
            setCopie(true);
            setTimeout(() => setCopie(false), 2000);
          });
        }}
      >
        {copie ? <><Check className="h-4 w-4 mr-2" />Copié</> : <><Copy className="h-4 w-4 mr-2" />Copier les codes</>}
      </Button>
      <p className="text-xs text-muted-foreground mt-3">
        Chacun de ces codes ne peut être utilisé qu'une seule fois, si vous perdez
        l'accès à votre application d'authentification.
      </p>
      <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
        <input type="checkbox" checked={confirme} onChange={e => setConfirme(e.target.checked)} className="h-4 w-4" />
        J'ai noté ces codes dans un endroit sûr
      </label>
      <Button type="button" className="w-full mt-4" disabled={!confirme} onClick={onContinuer}>
        Continuer
      </Button>
    </>
  );
}

function VerificationEcran({ code, setCode, erreur, envoi, onSubmit, onBasculerRecuperation }: {
  code: string; setCode: (v: string) => void; erreur: string | null; envoi: boolean;
  onSubmit: (e: React.FormEvent) => void; onBasculerRecuperation: () => void;
}) {
  return (
    <>
      <EnTete
        icon={<ShieldCheck className="h-6 w-6" />}
        titre="Vérification en deux étapes"
        description="Entrez le code affiché par votre application d'authentification."
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <ChampCode code={code} setCode={setCode} autoFocus />
        {erreur && <p className="text-sm text-destructive text-center">{erreur}</p>}
        <Button type="submit" className="w-full" disabled={envoi || code.length !== 6}>
          {envoi ? 'Vérification…' : 'Valider'}
        </Button>
      </form>
      <button
        type="button"
        onClick={onBasculerRecuperation}
        className="mt-4 text-xs text-muted-foreground hover:text-foreground underline w-full text-center"
      >
        Utiliser un code de récupération
      </button>
    </>
  );
}

function RecuperationEcran({ codeRecup, setCodeRecup, erreur, envoi, onSubmit, onRetour }: {
  codeRecup: string; setCodeRecup: (v: string) => void; erreur: string | null; envoi: boolean;
  onSubmit: (e: React.FormEvent) => void; onRetour: () => void;
}) {
  return (
    <>
      <EnTete
        icon={<KeyRound className="h-6 w-6" />}
        titre="Code de récupération"
        description="Utilisez l'un des dix codes reçus lors de l'activation du MFA."
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <input
          type="text"
          value={codeRecup}
          onChange={e => setCodeRecup(e.target.value)}
          placeholder="XXXX-XXXX-XX"
          autoFocus
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono-nums text-center tracking-widest"
        />
        {erreur && <p className="text-sm text-destructive text-center">{erreur}</p>}
        <Button type="submit" className="w-full" disabled={envoi || !codeRecup.trim()}>
          {envoi ? 'Vérification…' : 'Valider'}
        </Button>
      </form>
      <button
        type="button"
        onClick={onRetour}
        className="mt-4 text-xs text-muted-foreground hover:text-foreground underline w-full text-center"
      >
        Revenir au code à 6 chiffres
      </button>
    </>
  );
}

function ParametresEcran({ statut, onActiver, onRetour }: {
  statut: EtatStatut; onActiver: () => void; onRetour: () => void;
}) {
  return (
    <>
      <EnTete
        icon={statut.enabled ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
        titre="Double authentification"
        description={statut.enabled
          ? 'La double authentification est activée sur votre compte.'
          : "Vous pouvez activer la double authentification même si elle n'est pas obligatoire pour votre rôle."}
      />
      {statut.enabled && statut.recoveryCodesRemaining !== undefined && (
        <p className="text-sm text-muted-foreground text-center mb-4">
          {statut.recoveryCodesRemaining} code{statut.recoveryCodesRemaining > 1 ? 's' : ''} de récupération restant{statut.recoveryCodesRemaining > 1 ? 's' : ''}.
        </p>
      )}
      {!statut.enabled && (
        <Button type="button" className="w-full mb-3" onClick={onActiver}>
          Activer la double authentification
        </Button>
      )}
      <Button type="button" variant="outline" className="w-full" onClick={onRetour}>
        Retour
      </Button>
    </>
  );
}

/**
 * L'écran que voit un artisan qui n'a installé aucune application.
 *
 * Écrit pour quelqu'un qui n'est pas à l'aise : une seule chose à faire, dite
 * en une phrase, et le mot « code » plutôt que « second facteur ». Aucun
 * jargon, aucune abréviation, aucune notion à comprendre avant d'agir.
 */
function CodeCourrielEcran({
  destinataire, code, setCode, erreur, envoi, renvoye, onSubmit, onRenvoyer,
}: {
  /** L'adresse où le code est parti. Entière : c'est ce qui rend une coquille visible. */
  destinataire?: string;
  code: string;
  setCode: (v: string) => void;
  erreur: string | null;
  envoi: boolean;
  renvoye: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onRenvoyer: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-xl font-bold">Vérifions que c'est bien vous</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Nous venons de vous envoyer un code à six chiffres par e-mail.
          Ouvrez votre messagerie et recopiez-le ici.
        </p>
        {/*
          * L'ADRESSE, EN ENTIER. Le 30/08/2026, un compte a été créé avec
          * « contac@nodaq.fr » — un « t » manquant. L'écran disait « code
          * envoyé » sans dire OÙ, et il a fallu interroger la base de
          * production pour trouver la coquille. Affichée, elle se voit en
          * trois secondes.
          */}
        {destinataire && (
          <p className="text-sm font-medium break-all">
            Envoyé à <span className="text-primary">{destinataire}</span>
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {/*
          * Le composant à six cases déjà utilisé par l'écran de vérification.
          * Une case par chiffre : on voit où on en est, et le pavé numérique
          * sort tout seul sur téléphone.
          */}
        <div className="flex justify-center">
          <InputOTP maxLength={6} value={code} onChange={setCode} autoFocus>
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map(i => <InputOTPSlot key={i} index={i} />)}
            </InputOTPGroup>
          </InputOTP>
        </div>

        {erreur && <p className="text-sm text-destructive">{erreur}</p>}
        {renvoye && !erreur && (
          <p className="text-sm text-primary">
            Un nouveau code vient de partir. Le précédent ne fonctionne plus.
          </p>
        )}

        <Button type="submit" className="w-full h-11" disabled={envoi || code.length !== 6}>
          {envoi ? 'Vérification…' : 'Continuer'}
        </Button>
      </form>

      <div className="space-y-3 border-t border-card-border pt-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Le code est valable dix minutes. Pensez à regarder dans les indésirables :
          c'est là qu'il atterrit le plus souvent la première fois.
        </p>
        <button
          type="button"
          onClick={onRenvoyer}
          className="text-sm text-primary hover:underline"
        >
          Je n'ai rien reçu — m'envoyer un nouveau code
        </button>

        {/*
          * La sortie. Sans elle, une lettre manquante enferme quelqu'un devant
          * six cases vides sans aucun recours : le code partira toujours à la
          * mauvaise adresse, quel que soit le nombre de renvois.
          */}
        <a href="/login" className="block text-sm text-muted-foreground hover:underline">
          Ce n'est pas votre adresse ? Recommencer avec une autre
        </a>
      </div>

      {/*
        * Dit une fois, à l'endroit où la question se pose. Un utilisateur qui
        * vient de saisir un code se demande s'il devra le refaire chaque jour :
        * y répondre ici évite l'abandon au deuxième passage.
        */}
      <p className="text-xs text-muted-foreground">
        Sur cet appareil, nous ne vous le redemanderons pas avant trois mois.
      </p>
    </div>
  );
}
