import { Switch, Route, useLocation } from 'wouter';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/theme-context';
import { AppShell } from '@/components/app-shell';
import { NavProgressBar } from '@/components/nav-progress-bar';
import { Toaster } from '@/components/ui/toaster';
import NotFound from '@/pages/not-found';
import Cockpit from '@/pages/cockpit';
import Affaires from '@/pages/affaires';
import AffaireDetail from '@/pages/affaire-detail';
import Contrats from '@/pages/contrats';
import Factures from '@/pages/factures';
import Avoirs from '@/pages/avoirs';
import Prospects from '@/pages/prospects';
import Brief from '@/pages/brief';
import Chat from '@/pages/chat';
import Devis from '@/pages/devis';
import Classeur from '@/pages/classeur';
import Marge from '@/pages/marge';
import Pointages from '@/pages/pointages';
import DevisDictee from '@/pages/devis-dictee';
import ParametresEnvoi from '@/pages/parametres-envoi';
import Analytique from '@/pages/analytique';
import Rapports from '@/pages/rapports';
import CompteResultat from '@/pages/compte-resultat';
import Echeancier from '@/pages/echeancier';
import Equipe from '@/pages/equipe';
import Connecteurs from '@/pages/connecteurs';
import Parametres from '@/pages/parametres';
import VotreMetier from '@/pages/votre-metier';
import Onboarding from '@/pages/onboarding';
import Reprise from '@/pages/reprise';
import Login from '@/pages/login';
import Register from '@/pages/register';
import DevisAccepter from '@/pages/devis-accepter';
import { useAuth } from '@/hooks/use-auth';

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

/** HOC: requires authenticated + OWNER role; MEMBER → 403 page */
function OwnerRoute(Page: React.ComponentType) {
  return function OwnerProtected() {
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
      const from = encodeURIComponent(window.location.pathname);
      setLocation(`/login?from=${from}`);
      return null;
    }
    if (data.role !== 'OWNER') {
      return (
        <div className="flex flex-col items-center justify-center h-full p-12 gap-3 text-center">
          <div className="text-2xl font-semibold text-foreground">Accès restreint</div>
          <div className="text-sm text-muted-foreground max-w-xs">
            Cette section est réservée aux administrateurs du compte. Contactez votre OWNER pour y accéder.
          </div>
        </div>
      );
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
  const [location] = useLocation();
  const reducedMotion = useReducedMotion();

  // Use the top-level segment as the page key so /affaires and /affaires/:id
  // share the same transition key — no extra flash when drilling into a detail.
  const pageKey = '/' + (location.split('/')[1] ?? '');

  return (
    <>
      <NavProgressBar />
      <AppShell>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pageKey}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? {} : { opacity: 0, y: -4 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <Switch>
              {/* Public routes — no auth required */}
              <Route path="/login" component={Login} />
              <Route path="/register" component={Register} />
              <Route path="/devis/accepter/:token" component={DevisAccepter} />

              {/* All business routes require authentication */}
              <Route path="/" component={PlatformRoute(Cockpit)} />
              <Route path="/affaires/:id" component={PlatformRoute(AffaireDetail)} />
              <Route path="/affaires" component={PlatformRoute(Affaires)} />
              <Route path="/contrats" component={PlatformRoute(Contrats)} />
              <Route path="/factures" component={PlatformRoute(Factures)} />
              <Route path="/avoirs" component={PlatformRoute(Avoirs)} />
              <Route path="/prospects" component={PlatformRoute(Prospects)} />
              <Route path="/brief" component={PlatformRoute(Brief)} />
              <Route path="/chat" component={PlatformRoute(Chat)} />
              <Route path="/devis" component={PlatformRoute(Devis)} />
              <Route path="/classeur" component={PlatformRoute(Classeur)} />
              <Route path="/analytique" component={PlatformRoute(Analytique)} />
              <Route path="/marge" component={PlatformRoute(Marge)} />
              <Route path="/pointages" component={PlatformRoute(Pointages)} />
              <Route path="/devis/dictee" component={PlatformRoute(DevisDictee)} />
              <Route path="/parametres/envoi" component={PlatformRoute(ParametresEnvoi)} />
              <Route path="/rapports" component={PlatformRoute(Rapports)} />
              <Route path="/compte-resultat" component={PlatformRoute(CompteResultat)} />
              <Route path="/echeancier" component={PlatformRoute(Echeancier)} />
              <Route path="/equipe" component={PlatformRoute(Equipe)} />
              <Route path="/votre-metier" component={PlatformRoute(VotreMetier)} />
              <Route path="/connecteurs" component={PlatformRoute(Connecteurs)} />
              <Route path="/parametres" component={PlatformRoute(Parametres)} />
              <Route path="/onboarding" component={OwnerRoute(Onboarding)} />
              <Route path="/reprise" component={OwnerRoute(Reprise)} />
              <Route component={NotFound} />
            </Switch>
          </motion.div>
        </AnimatePresence>
      </AppShell>
    </>
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
