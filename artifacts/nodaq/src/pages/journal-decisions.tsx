/**
 * Journal des décisions — US-A6.4.
 *
 * Ce que l'assistant a proposé, ce que l'humain en a décidé. Écran destiné à
 * être ouvert le jour d'un contrôle ou d'un litige : la lisibilité prime sur
 * la densité, et le contenu exact proposé doit rester atteignable — c'est lui
 * qui fait la preuve, pas le résumé.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ScrollText, FileDown, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';
import { apiFetch } from '@/lib/auth';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type Decision = 'APPROUVEE' | 'REJETEE' | 'EXPIREE';

type LigneJournal = {
  actionId: string;
  actionType: string;
  actionLabel: string;
  actionPayload: unknown;
  decision: Decision;
  decideeLe: string;
  decideeParEmail: string | null;
};

/**
 * Chaque décision porte sa forme ET sa couleur. Un contrôleur qui parcourt la
 * liste doit distinguer un refus d'une expiration sans lire le libellé.
 */
const META: Record<Decision, { label: string; classe: string; Icone: typeof CheckCircle2 }> = {
  APPROUVEE: {
    label: 'Approuvée',
    classe: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    Icone: CheckCircle2,
  },
  REJETEE: {
    label: 'Rejetée',
    classe: 'bg-destructive/10 text-destructive border-destructive/25',
    Icone: XCircle,
  },
  EXPIREE: {
    label: 'Expirée sans décision',
    classe: 'bg-muted text-muted-foreground border-border',
    Icone: Clock,
  },
};

const CURRENT_YEAR = new Date().getFullYear();

export default function JournalDecisions() {
  const [annee, setAnnee] = useState(CURRENT_YEAR);
  const [ouverte, setOuverte] = useState<string | null>(null);

  const from = `${annee}-01-01`;
  const to = `${annee}-12-31`;

  const { data, isLoading, isError } = useQuery<LigneJournal[]>({
    queryKey: ['journal-decisions', from, to],
    queryFn: async () => {
      const res = await apiFetch(`${API}/journal-decisions?from=${from}&to=${to}`);
      if (!res.ok) throw new Error('Chargement impossible');
      return res.json();
    },
  });

  const lignes = data ?? [];
  const annees = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

  const compte = (d: Decision) => lignes.filter((l) => l.decision === d).length;

  const dateLisible = (iso: string) =>
    new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));

  return (
    <div className="pb-20">
      <PageHeader
        eyebrow="Plateforme"
        title="Journal des décisions"
        description="Ce que l'assistant a proposé, et ce que vous en avez décidé. Conservé de façon immuable."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={annee}
              onChange={(e) => setAnnee(Number(e.target.value))}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm font-mono-nums"
              aria-label="Exercice"
            >
              {annees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => window.open(`${API}/journal-decisions/export?from=${from}&to=${to}`, '_blank')}
            >
              <FileDown className="h-4 w-4" /> Exporter
            </Button>
          </div>
        }
      />

      <div className="px-5 md:px-8 pt-6 space-y-6 max-w-4xl">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-3 gap-3"
        >
          {(['APPROUVEE', 'REJETEE', 'EXPIREE'] as const).map((d) => (
            <motion.div
              key={d}
              variants={itemVariants}
              className="rounded-xl border border-card-border bg-card p-4"
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
                {META[d].label}
              </div>
              <div className="text-xl font-semibold font-mono-nums">{compte(d)}</div>
            </motion.div>
          ))}
        </motion.div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-destructive">
            Impossible de charger le journal.
          </div>
        ) : lignes.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ScrollText /></EmptyMedia>
              <EmptyTitle>Aucune décision sur cette période</EmptyTitle>
              <EmptyDescription>
                Les actions proposées par l'assistant et vos décisions apparaîtront ici.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-2">
            {lignes.map((l) => {
              const meta = META[l.decision];
              const Icone = meta.Icone;
              const cle = `${l.actionId}-${l.decideeLe}`;
              const deplie = ouverte === cle;
              return (
                <div
                  key={cle}
                  className="rounded-xl border border-card-border bg-card overflow-hidden"
                >
                  <div className="flex items-start gap-3 p-4">
                    <Icone className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-foreground">{l.actionLabel}</span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.classe}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                        <span className="font-mono-nums">{dateLisible(l.decideeLe)}</span>
                        <span aria-hidden>·</span>
                        {/* Une expiration n'a pas d'auteur : le dire, plutôt que
                            de laisser un blanc qu'on lirait comme une perte. */}
                        <span>{l.decideeParEmail ?? 'Aucune décision humaine'}</span>
                      </div>
                    </div>
                    {l.actionPayload != null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 gap-1 text-xs"
                        onClick={() => setOuverte(deplie ? null : cle)}
                      >
                        {deplie ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        Contenu exact
                      </Button>
                    )}
                  </div>
                  {deplie && l.actionPayload != null && (
                    /* Le contenu proposé, tel quel. C'est la pièce qui fait
                       preuve — on ne la reformule pas. */
                    <pre className="border-t border-border bg-muted/20 px-4 py-3 text-[11px] leading-relaxed overflow-x-auto">
                      {JSON.stringify(l.actionPayload, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Ce journal ne peut être ni modifié ni effacé depuis l'application : l'immuabilité
          est appliquée par la base de données elle-même. L'export produit un fichier CSV
          lisible par un tiers, sans NODAQ.
        </p>
      </div>
    </div>
  );
}
