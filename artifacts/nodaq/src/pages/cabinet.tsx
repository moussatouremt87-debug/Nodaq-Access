/**
 * Console cabinet (US-A5.2) — le portefeuille de clients d'un utilisateur
 * membre de plusieurs espaces, et l'export consolidé de leurs comptes de
 * résultat.
 *
 * Volontairement une simple LISTE, pas un tableau de bord consolidé : chaque
 * chiffre affiché ici vient d'un espace différent, avec son propre secteur et
 * son propre vocabulaire. Agréger des montants entre clients n'aurait pas de
 * sens comptable — on ouvre l'espace du client pour voir ses chiffres.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Building2, FileDown, ArrowRight, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useMesEspaces, useBasculerEspace, type Espace } from '@/hooks/use-cabinet';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';
const CURRENT_YEAR = new Date().getFullYear();

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Propriétaire',
  ACCOUNTANT: 'Comptable',
  MEMBER: 'Collaborateur',
};

export default function Cabinet() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: auth } = useAuth();
  const { espaces, isLoading } = useMesEspaces();
  const basculer = useBasculerEspace();
  const [enBascule, setEnBascule] = useState<string | null>(null);
  const [annee, setAnnee] = useState(CURRENT_YEAR);

  const tenantCourant = auth?.authenticated === true && 'tenantId' in auth ? auth.tenantId : undefined;

  const ouvrirEspace = (espace: Espace) => {
    if (espace.tenantId === tenantCourant) { setLocation('/'); return; }
    setEnBascule(espace.tenantId);
    basculer.mutate(espace.tenantId, {
      onSuccess: () => {
        setEnBascule(null);
        toast({ title: 'Espace ouvert', description: espace.tenantNom });
        setLocation('/');
      },
      onError: () => {
        setEnBascule(null);
        toast({
          title: 'Bascule impossible',
          description: `Impossible d'ouvrir l'espace ${espace.tenantNom}.`,
          variant: 'destructive',
        });
      },
    });
  };

  const exporterConsolide = () => {
    window.open(`${API}/cabinet/export?from=${annee}-01-01&to=${annee}-12-31`, '_blank');
  };

  const annees = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

  return (
    <div className="pb-20">
      <PageHeader
        eyebrow="Cabinet"
        title="Vos clients"
        description="Les espaces auxquels vous avez accès. Chacun garde son secteur et son vocabulaire propres."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={annee}
              onChange={e => setAnnee(Number(e.target.value))}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm font-mono-nums"
              aria-label="Exercice à exporter"
            >
              {annees.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exporterConsolide}>
              <FileDown className="h-4 w-4" /> Export consolidé
            </Button>
          </div>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6 max-w-4xl">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : espaces.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Building2 /></EmptyMedia>
              <EmptyTitle>Aucun espace</EmptyTitle>
              <EmptyDescription>
                Vous n'avez accès à aucun espace de travail pour le moment.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-2"
          >
            {espaces.map(espace => {
              const actif = espace.tenantId === tenantCourant;
              const bascule = enBascule === espace.tenantId;
              return (
                <motion.div
                  key={espace.tenantId}
                  variants={itemVariants}
                  className={`rounded-xl border bg-card p-4 transition-colors ${
                    actif ? 'border-primary/40 bg-primary/5' : 'border-card-border hover-elevate'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <Building2 className="h-5 w-5 mt-0.5 shrink-0 text-primary" />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-foreground">{espace.tenantNom}</span>
                        {actif && (
                          <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            Espace courant
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                        <span>{espace.secteurLabel}</span>
                        <span aria-hidden>·</span>
                        <span>{ROLE_LABEL[espace.role] ?? espace.role}</span>
                        {/* `null` pour un simple collaborateur : aucune donnée
                            financière ne lui est rendue pour cet espace. */}
                        {espace.affairesEnCours !== null && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="font-mono-nums">
                              {espace.affairesEnCours} en cours
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <Button
                      variant={actif ? 'ghost' : 'outline'}
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={() => ouvrirEspace(espace)}
                      disabled={bascule}
                    >
                      {bascule
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <ArrowRight className="h-4 w-4" />}
                      Ouvrir
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        <p className="text-xs text-muted-foreground">
          L'export consolidé reprend le compte de résultat au Plan Comptable Général de
          chaque client où vous avez un accès financier, dans un seul fichier — même
          structure pour tous, quel que soit leur secteur.
        </p>
      </div>
    </div>
  );
}
