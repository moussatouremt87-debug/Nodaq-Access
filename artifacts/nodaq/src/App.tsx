import { Switch, Route } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
      <Toaster />
    </QueryClientProvider>
  );
}
