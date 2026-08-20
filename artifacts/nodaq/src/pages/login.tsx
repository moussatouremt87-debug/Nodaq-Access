import { useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';
import { useLocation } from 'wouter';

export default function LoginPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  // Redirect back to the page the user was trying to reach
  const searchStr = typeof window !== 'undefined' ? window.location.search : '';
  const params = new URLSearchParams(searchStr);
  const returnTo = params.get('from') ?? '/';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: 'Connexion impossible',
          description: (data as any)?.error ?? 'Email ou mot de passe incorrect',
          variant: 'destructive',
        });
        return;
      }
      const data = await res.json().catch(() => ({}));
      await qc.invalidateQueries({ queryKey: ['auth-me'] });
      // MFA (ticket 4.15) — OWNER/ACCOUNTANT sans second facteur prouvé pour
      // CETTE session : la connexion a réussi, mais /mfa reste à traverser
      // avant la destination initialement visée.
      if (data?.mfaStatus === 'enroll_required' || data?.mfaStatus === 'verify_required') {
        setLocation(`/mfa?from=${encodeURIComponent(returnTo)}`);
        return;
      }
      setLocation(returnTo);
    } catch {
      toast({ title: 'Erreur de connexion', description: 'Impossible de joindre le serveur', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-6 sm:p-8 shadow-xl"
      >
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LogIn className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground">Connexion à NODAQ</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Entrez vos identifiants pour accéder à votre espace
            </p>
          </div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="vous@exemple.fr"
              autoFocus
              autoComplete="email"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe</Label>
            <div className="relative">
              <Input
                id="password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading || !email || !password}
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Première connexion ?{' '}
          <a href="/register" className="underline hover:text-foreground">
            Créer un compte
          </a>
        </p>
      </motion.div>
    </div>
  );
}
