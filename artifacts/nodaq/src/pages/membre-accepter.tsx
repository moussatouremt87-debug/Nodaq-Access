/**
 * Page publique d'acceptation d'une invitation — /membres/accepter/:token
 * Accessible sans authentification.
 * Récupère l'aperçu via GET /api/membres/inviter/:token puis accepte via
 * POST /api/membres/inviter/:token/accepter — qui connecte automatiquement
 * la personne, comme /auth/register.
 */
import { useState } from 'react';
import { useRoute, useLocation, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useApercuInvitation, useAccepterInvitation, getApercuInvitationQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Clock, XCircle, UserPlus, Loader2, Eye, EyeOff } from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  MEMBER: 'membre',
  ACCOUNTANT: 'comptable',
};

export default function MembreAccepterPage() {
  const [, params] = useRoute('/membres/accepter/:token');
  const token = params?.token ?? '';
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const [nom, setNom] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);

  const { data, isLoading, error } = useApercuInvitation(token, {
    query: { queryKey: getApercuInvitationQueryKey(token), enabled: !!token, retry: false },
  });

  const accepterMut = useAccepterInvitation({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: ['auth-me'] });
        setLocation('/');
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 8) return;
    if (!data?.compteExistant && !nom.trim()) return;
    accepterMut.mutate({
      token,
      data: data?.compteExistant ? { password } : { nom: nom.trim(), password },
    });
  };

  if (!token) {
    return <ErrorScreen title="Lien invalide" message="Ce lien ne contient pas de jeton d'invitation." />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return <ErrorScreen title="Lien invalide ou expiré" message="Ce lien d'invitation n'existe pas ou a expiré." />;
  }

  if (data.expire) {
    return (
      <StatusScreen
        icon={<Clock className="h-12 w-12 text-yellow-500" />}
        title="Invitation expirée"
        message={`L'invitation à rejoindre ${data.tenantNom} n'est plus valable. Demandez à votre administrateur de vous envoyer un nouveau lien.`}
      />
    );
  }

  if (data.dejaAcceptee) {
    return (
      <StatusScreen
        icon={<CheckCircle2 className="h-12 w-12 text-green-500" />}
        title="Invitation déjà acceptée"
        message={`Cette invitation a déjà été utilisée. Connectez-vous avec votre compte pour accéder à ${data.tenantNom}.`}
        showLogin
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-8 shadow-xl">
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <UserPlus className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Rejoindre {data.tenantNom}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Vous avez été invité(e) en tant que {ROLE_LABELS[data.roleOffert] ?? data.roleOffert} — {data.email}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!data.compteExistant && (
            <div className="space-y-1.5">
              <Label htmlFor="nom">Votre nom complet</Label>
              <Input
                id="nom"
                type="text"
                value={nom}
                onChange={e => setNom(e.target.value)}
                placeholder="Prénom Nom"
                autoFocus
                required
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="password">
              {data.compteExistant ? 'Votre mot de passe' : 'Choisissez un mot de passe'}{' '}
              <span className="text-muted-foreground text-xs">(min. 8 caractères)</span>
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={data.compteExistant ? 'current-password' : 'new-password'}
                autoFocus={data.compteExistant}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={show ? 'Masquer' : 'Afficher'}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {data.compteExistant && (
              <p className="text-xs text-muted-foreground">
                Vous avez déjà un compte NODAQ avec cette adresse — connectez-vous pour rejoindre cet espace.
              </p>
            )}
          </div>

          {accepterMut.isError && (
            <p className="text-sm text-destructive">{(accepterMut.error as Error).message}</p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={
              accepterMut.isPending ||
              password.length < 8 ||
              (!data.compteExistant && !nom.trim())
            }
          >
            {accepterMut.isPending
              ? 'Connexion en cours…'
              : `Rejoindre ${data.tenantNom}`}
          </Button>
        </form>
      </div>
    </div>
  );
}

function StatusScreen({ icon, title, message, showLogin }: {
  icon: React.ReactNode; title: string; message: string; showLogin?: boolean;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="flex justify-center">{icon}</div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{message}</p>
        {showLogin && (
          <Button asChild className="w-full">
            <Link href="/login">Se connecter</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <StatusScreen icon={<XCircle className="h-12 w-12 text-destructive" />} title={title} message={message} />
  );
}
