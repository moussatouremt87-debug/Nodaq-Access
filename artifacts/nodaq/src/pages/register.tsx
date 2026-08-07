import { useState } from 'react';
import { motion } from 'framer-motion';
import { UserPlus, Eye, EyeOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';
import { useLocation, Link } from 'wouter';

export default function RegisterPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nom, setNom] = useState('');
  const [tenantNom, setTenantNom] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (password.length < 10) {
      toast({ title: 'Mot de passe trop court', description: 'Au moins 10 caractères requis', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, nom, tenantNom }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: 'Inscription impossible',
          description: (data as any)?.error ?? 'Une erreur est survenue',
          variant: 'destructive',
        });
        return;
      }
      await qc.invalidateQueries({ queryKey: ['auth-me'] });
      // Première inscription : envoyer vers l'onboarding pour renseigner le profil entreprise
      setLocation('/onboarding');
    } catch {
      toast({ title: 'Erreur', description: 'Impossible de joindre le serveur', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-8 shadow-xl"
      >
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <UserPlus className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground">Créer votre espace</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Inscription en tant qu'administrateur de votre cabinet
            </p>
          </div>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tenantNom">Nom de votre cabinet / entreprise</Label>
            <Input
              id="tenantNom"
              type="text"
              value={tenantNom}
              onChange={e => setTenantNom(e.target.value)}
              placeholder="Mon cabinet"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nom">Votre nom complet</Label>
            <Input
              id="nom"
              type="text"
              value={nom}
              onChange={e => setNom(e.target.value)}
              placeholder="Jean Dupont"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="vous@exemple.fr"
              autoComplete="email"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe <span className="text-muted-foreground text-xs">(min. 10 caractères)</span></Label>
            <div className="relative">
              <Input
                id="password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••"
                autoComplete="new-password"
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
          </div>

          <Button type="submit" className="w-full" disabled={loading || !email || !password}>
            {loading ? 'Création en cours…' : 'Créer mon espace NODAQ'}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Déjà inscrit ?{' '}
          <Link href="/login" className="underline hover:text-foreground">
            Se connecter
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
