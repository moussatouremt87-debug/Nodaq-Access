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
import Prospection from '@/pages/prospection';
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
import Cabinet from '@/pages/cabinet';
import Echeancier from '@/pages/echeancier';
import ChargesRecurrentes from '@/pages/charges-recurrentes';
import PrevisionnelTresorerie from '@/pages/previsionnel-tresorerie';
import Equipe from '@/pages/equipe';
import Connecteurs from '@/pages/connecteurs';
import Parametres from '@/pages/parametres';
import VotreMetier from '@/pages/votre-metier';
import Onboarding from '@/pages/onboarding';
import Reprise from '@/pages/reprise';
import FacturationElectronique from '@/pages/facturation-electronique';
import Login from '@/pages/login';
import Register from '@/pages/register';
import DevisAccepter from '@/pages/devis-accepter';
import MembreAccepter from '@/pages/membre-accepter';
import Mfa from '@/pages/mfa';
import { useAuth, FINANCIAL_ROLES, type MembershipRole } from '@/hooks/use-auth';

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
    if (!('role' in data)) {
      const from = encodeURIComponent(window.location.pathname);
      setLocation(`/mfa?from=${from}`);
      return null;
    }
    return <Page />;
  };
}

/** HOC: requires authenticated + one of `allowedRoles`; other roles → 403 page */
function RoleRoute(Page: React.ComponentType, allowedRoles: readonly MembershipRole[]) {
  return function RoleProtected() {
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
    if (!('role' in data)) {
      const from = encodeURIComponent(window.location.pathname);
      setLocation(`/mfa?from=${from}`);
      return null;
    }
    if (!allowedRoles.includes(data.role)) {
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

/**
 * ROUTES PUBLIQUES — rendues NUES, hors de l'AppShell.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Elles étaient rendues À L'INTÉRIEUR de l'AppShell. Le client de          ║
 * ║  l'artisan, qui n'a aucune session, voyait donc la barre de navigation    ║
 * ║  complète du logiciel : Cockpit, Affaires, Factures, Marge, Fiscal,      ║
 * ║  Équipe, Connecteurs, Paramètres — et le sélecteur de thème.             ║
 * ║                                                                           ║
 * ║  Deux conséquences. Il croit être entré dans le logiciel de quelqu'un    ║
 * ║  d'autre, sur la page même où on lui demande de s'engager. Et quiconque  ║
 * ║  détient un lien de devis obtient la carte complète des fonctions du      ║
 * ║  produit.                                                                 ║
 * ║                                                                           ║
 * ║  Effet de bord corrigé du même coup : l'AppShell appelle `useIsOwner()`,  ║
 * ║  donc `GET /api/auth/me`. La page publique émettait une requête           ║
 * ║  authentifiée et recevait 401 dans la console du client.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * La garde `app-routes.test.ts` échoue si l'une d'elles retourne dans la
 * coquille.
 */
export const ROUTES_PUBLIQUES = [
  '/devis/accepter/:token',
  '/membres/accepter/:token',
  '/login',
  '/register',
  '/mfa',
] as const;

function AppRouter() {
  return (
    <Switch>
      {/* ── Routes PUBLIQUES : aucune navigation, aucun thème, rien de l'app ── */}
      <Route path="/devis/accepter/:token" component={DevisAccepter} />
      <Route path="/membres/accepter/:token" component={MembreAccepter} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      {/* MFA (ticket 4.15) — une identité en attente de second facteur n'a
          pas de `role` : l'AppShell, qui appelle useIsOwner(), choquerait. */}
      <Route path="/mfa" component={Mfa} />

      {/* Tout le reste vit dans l'application interne. */}
      <Route component={ApplicationInterne} />
    </Switch>
  );
}

function ApplicationInterne() {
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
              {/* Les routes publiques sont montées PLUS HAUT, hors de cette
                  coquille. Ne pas les remettre ici. */}
              {/* All business routes require authentication */}
              <Route path="/" component={PlatformRoute(Cockpit)} />
              <Route path="/affaires/:id" component={PlatformRoute(AffaireDetail)} />
              <Route path="/affaires" component={PlatformRoute(Affaires)} />
              <Route path="/contrats" component={PlatformRoute(Contrats)} />
              <Route path="/factures" component={RoleRoute(Factures, FINANCIAL_ROLES)} />
              <Route path="/avoirs" component={RoleRoute(Avoirs, FINANCIAL_ROLES)} />
              <Route path="/prospects" component={PlatformRoute(Prospects)} />
              <Route path="/prospection" component={PlatformRoute(Prospection)} />
              <Route path="/brief" component={PlatformRoute(Brief)} />
              <Route path="/chat" component={PlatformRoute(Chat)} />
              <Route path="/devis" component={PlatformRoute(Devis)} />
              <Route path="/classeur" component={PlatformRoute(Classeur)} />
              <Route path="/analytique" component={PlatformRoute(Analytique)} />
              <Route path="/marge" component={RoleRoute(Marge, FINANCIAL_ROLES)} />
              <Route path="/pointages" component={PlatformRoute(Pointages)} />
              <Route path="/devis/dictee" component={PlatformRoute(DevisDictee)} />
              <Route path="/parametres/envoi" component={PlatformRoute(ParametresEnvoi)} />
              <Route path="/rapports" component={RoleRoute(Rapports, FINANCIAL_ROLES)} />
              <Route path="/compte-resultat" component={RoleRoute(CompteResultat, FINANCIAL_ROLES)} />
              <Route path="/cabinet" component={RoleRoute(Cabinet, FINANCIAL_ROLES)} />
              <Route path="/echeancier" component={RoleRoute(Echeancier, FINANCIAL_ROLES)} />
              <Route path="/charges-recurrentes" component={RoleRoute(ChargesRecurrentes, FINANCIAL_ROLES)} />
              <Route path="/previsionnel-tresorerie" component={RoleRoute(PrevisionnelTresorerie, FINANCIAL_ROLES)} />
              <Route path="/equipe" component={RoleRoute(Equipe, ['OWNER'])} />
              <Route path="/votre-metier" component={PlatformRoute(VotreMetier)} />
              <Route path="/connecteurs" component={RoleRoute(Connecteurs, ['OWNER'])} />
              <Route path="/parametres" component={RoleRoute(Parametres, ['OWNER'])} />
              <Route path="/onboarding" component={RoleRoute(Onboarding, ['OWNER'])} />
              <Route path="/reprise" component={RoleRoute(Reprise, ['OWNER'])} />
              <Route path="/facturation-electronique" component={RoleRoute(FacturationElectronique, ['OWNER'])} />
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
