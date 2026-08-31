/**
 * Mot de passe oublié — /mot-de-passe-oublie, page PUBLIQUE.
 *
 * Rendue nue, hors de l'AppShell : celui qui a oublié son mot de passe n'a
 * évidemment pas de session, et la coquille appellerait `/auth/me` pour
 * recevoir un 401.
 *
 * ── LA PHRASE QUI NE DIT RIEN, ET POURQUOI ELLE EST ÉCRITE AINSI ────────────
 *
 * « Si un compte existe pour cette adresse, un code vient de partir. » Cette
 * formulation est délibérée : le serveur répond la même chose que l'adresse
 * existe ou non, et l'écran doit dire la même chose que lui. Annoncer « code
 * envoyé » sur une adresse inconnue serait un mensonge ; annoncer « compte
 * introuvable » ferait de ce formulaire un annuaire de vos clients.
 *
 * Le prix est qu'une faute de frappe reste silencieuse. C'est assumé, et la
 * phrase est construite pour que l'utilisateur comprenne de lui-même qu'il
 * doit vérifier son adresse s'il ne reçoit rien.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, MailCheck } from 'lucide-react';

const API = '/api';

type Etape = 'demande' | 'code';

export default function MotDePasseOubliePage() {
  const [, setLocation] = useLocation();
  const [etape, setEtape] = useState<Etape>('demande');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function demander(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const r = await fetch(`${API}/auth/mot-de-passe/oublie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setErreur(d.error ?? "L'envoi n'a pas abouti. Réessayez dans un instant.");
        return;
      }
      setEtape('code');
    } catch {
      setErreur('Connexion impossible. Vérifiez votre accès à internet.');
    } finally {
      setEnCours(false);
    }
  }

  async function reinitialiser(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      const r = await fetch(`${API}/auth/mot-de-passe/reinitialiser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), motDePasse }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErreur(d.error ?? 'Ce code ne convient pas.');
        return;
      }
      // On ne connecte PAS automatiquement : le serveur non plus. Ouvrir une
      // session sur la foi d'un code reçu par courriel contournerait le mot de
      // passe qu'on vient de faire choisir.
      setLocation('/login?reinitialise=1');
    } catch {
      setErreur('Connexion impossible. Vérifiez votre accès à internet.');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <p className="text-sm font-medium text-muted-foreground">nodaq</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {etape === 'demande' ? 'Mot de passe oublié' : 'Choisissez un nouveau mot de passe'}
        </h1>

        {etape === 'demande' ? (
          <form onSubmit={demander} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Votre adresse e-mail</Label>
              <Input
                id="email" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@votre-entreprise.fr"
              />
            </div>
            <Button type="submit" className="w-full" disabled={enCours || !email.trim()}>
              {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Recevoir un code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={reinitialiser} className="mt-6 space-y-4">
            <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Si un compte existe pour cette adresse, un code à six chiffres
                vient de partir. Il est valable dix minutes.
              </span>
            </p>
            <div className="space-y-2">
              <Label htmlFor="code">Code reçu par courriel</Label>
              <Input
                id="code" inputMode="numeric" autoComplete="one-time-code" required
                value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="123456" maxLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mdp">Nouveau mot de passe</Label>
              <Input
                id="mdp" type="password" autoComplete="new-password" required
                value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Au moins 10 caractères.</p>
            </div>
            <Button
              type="submit" className="w-full"
              disabled={enCours || !code.trim() || motDePasse.length < 10}
            >
              {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Changer mon mot de passe'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Changer votre mot de passe vous déconnectera de tous vos appareils.
            </p>
          </form>
        )}

        {erreur && (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {erreur}
          </p>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <a href="/login" className="underline hover:text-foreground">
            Retour à la connexion
          </a>
        </p>
      </div>
    </div>
  );
}
