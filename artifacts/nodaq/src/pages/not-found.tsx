import { Link } from 'wouter';
import { TerminalSquare, AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

export default function NotFound() {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="max-w-md w-full animate-stagger-in">
        <Empty className="rounded-xl border border-card-border bg-card p-10 shadow-sm">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive mb-6">
              <AlertOctagon className="h-8 w-8" />
            </EmptyMedia>
            <EmptyTitle className="text-2xl">Terminal déconnecté</EmptyTitle>
            <EmptyDescription className="text-base">
              Erreur 404 — La route opérationnelle demandée n'existe pas ou a été archivée.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link href="/">
              <Button size="lg" className="gap-2">
                <TerminalSquare className="h-4 w-4" />
                Retourner au cockpit
              </Button>
            </Link>
          </EmptyContent>
        </Empty>
      </div>
    </div>
  );
}
