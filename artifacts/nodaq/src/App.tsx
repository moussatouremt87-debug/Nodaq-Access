import { Switch, Route } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/theme-context';
import { AppShell } from '@/components/app-shell';
import { Toaster } from '@/components/ui/toaster';
import NotFound from '@/pages/not-found';
import Cockpit from '@/pages/cockpit';
import Affaires from '@/pages/affaires';
import Contrats from '@/pages/contrats';
import Factures from '@/pages/factures';
import Prospects from '@/pages/prospects';
import Brief from '@/pages/brief';
import Chat from '@/pages/chat';
import Devis from '@/pages/devis';
import Classeur from '@/pages/classeur';
import Marge from '@/pages/marge';
import Rapports from '@/pages/rapports';
import Echeancier from '@/pages/echeancier';
import Equipe from '@/pages/equipe';
import Connecteurs from '@/pages/connecteurs';
import Parametres from '@/pages/parametres';
import VotreMetier from '@/pages/votre-metier';
import Login from '@/pages/login';
import { useAuth } from '@/hooks/use-auth';
import { useLocation } from 'wouter';

/** HOC: redirects to /login if not authenticated */
function PlatformRoute(Page: React.ComponentType) {
  return function Protected() {
    const { data, isLoading } = useAuth();
    const [, setLocation] = useLocation();

    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center p-12 text-muted-foreground text-sm">
          Vérification de l'accès...
        </div>
      );
    }
    if (!data?.authenticated) {
      // Redirect to login, preserving the intended destination
      const from = encodeURIComponent(window.location.pathname);
      setLocation(`/login?from=${from}`);
      return null;
    }
    return <Page />;
  };
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function AppRouter() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Cockpit} />
        <Route path="/affaires" component={Affaires} />
        <Route path="/contrats" component={Contrats} />
        <Route path="/factures" component={Factures} />
        <Route path="/prospects" component={Prospects} />
        <Route path="/brief" component={Brief} />
        <Route path="/chat" component={Chat} />
        <Route path="/devis" component={Devis} />
        <Route path="/classeur" component={Classeur} />
        <Route path="/marge" component={Marge} />
        <Route path="/rapports" component={Rapports} />
        <Route path="/echeancier" component={Echeancier} />
        <Route path="/equipe" component={PlatformRoute(Equipe)} />
        <Route path="/votre-metier" component={PlatformRoute(VotreMetier)} />
        <Route path="/connecteurs" component={PlatformRoute(Connecteurs)} />
        <Route path="/parametres" component={PlatformRoute(Parametres)} />
        <Route path="/login" component={Login} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AppRouter />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
