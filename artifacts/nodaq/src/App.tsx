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
