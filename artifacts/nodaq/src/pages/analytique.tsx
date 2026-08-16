/**
 * 4.11 — Page analytique
 *
 * Spec rules enforced here:
 * §8  : each tile name IS the explanation sentence
 * §9  : max 3 things per tile (phrase · explication · action)
 * §10 : 4 de tête = row of tiles; single number = tile never chart; area if single series
 * §11 : palette #fcfcfb surface, #2a78d6 blue; state colors with icon+word only
 * §12 : mobile-first 390 px; period filter ONE line; table view always accessible
 * §13 : forbidden vocabulary never in labels
 *
 * THREE ABSOLUTES (§§1-3 of spec):
 *   1. No cross-client comparison, even anonymised.
 *   2. No individual performance metrics.
 *   3. No figures below minimum thresholds.
 */
import { useState, useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { PeriodSelector } from '@/components/analytique/period-selector';
import { IndicateurTuile, HeroTuile } from '@/components/analytique/indicateur-tuile';
import { EvolutionChart } from '@/components/analytique/evolution-chart';
import { ConcentrationChart, type ClientShare } from '@/components/analytique/concentration-chart';
import { useIndicateurs, useIndicateurSerie } from '@/hooks/use-analytics';
import { buildPhrase } from '@/lib/analytics-format';
import { useVertical } from '@/hooks/use-vertical';
import { fmtEURCompact } from '@/lib/format';
import type { PeriodeMode, ComparaisonMode, IndicateurResult } from '@/hooks/use-analytics';

// ── Helpers ────────────────────────────────────────────────────────────────────

function byId(data: IndicateurResult[] | undefined, id: string): IndicateurResult | undefined {
  return data?.find((r) => r.id === id);
}

// ── Sections ──────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mt-8 mb-3 first:mt-0">
      {children}
    </h2>
  );
}

// ── Ca Series chart (used for the evolution section) ──────────────────────────

function CaEvolution({ periode }: { periode: PeriodeMode }) {
  const { data: caFactureSerie, isLoading } = useIndicateurSerie('ca_facture', 12);
  return (
    <EvolutionChart
      data={caFactureSerie ?? []}
      loading={isLoading}
      unite="centimes HT"
      titre="CA facturé mois par mois"
    />
  );
}

function MargeEvolution() {
  const { data: margeSerie, isLoading } = useIndicateurSerie('marge_pour_100_euros', 12);
  return (
    <EvolutionChart
      data={margeSerie ?? []}
      loading={isLoading}
      unite="€ sur 100 €"
      titre="Ce qu'il vous reste sur 100 € — évolution"
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Analytique() {
  const [periode, setPeriode] = useState<PeriodeMode>('12_mois');
  // Spec §5: default = meme_periode_n1 (not periode_precedente)
  const [comparaison, setComparaison] = useState<ComparaisonMode>('meme_periode_n1');

  const { data, isLoading } = useIndicateurs({ periode, comparaison });
  const { words, delaiPaiementUsuelJours } = useVertical();
  // US-A3.1 : un profil à encaissement comptant (délai usuel 0 j) n'a quasi
  // aucun délai de paiement à mesurer — `delai_paiement_client` cède sa place
  // en tuile hero à `ca_encaisse`, plus pertinent pour ce cycle. Permutation
  // à DEUX positions fixes seulement (ici et "Votre activité" ci-dessous),
  // même moteur, même 14 indicateurs : aucune nouvelle formule.
  const encaissementComptant = delaiPaiementUsuelJours === 0;

  // Build all phrases from raw results
  const phrases = useMemo(() => {
    if (!data) return {};
    return Object.fromEntries(data.map((r) => [r.id, buildPhrase(r, words)]));
  }, [data, words]);

  function ph(id: string) {
    return phrases[id] ?? { phrase: '—', sous: null, explication: '' };
  }

  function comp(id: string) {
    return byId(data, id)?.comparaison;
  }

  // Concentration chart data — built from concentration_client detail
  const concentrationData = useMemo<ClientShare[]>(() => {
    const r = byId(data, 'concentration_client');
    if (!r || r.donneesInsuffisantes) return [];
    const topClient = r.detail?.topClient as string | undefined;
    const topPct = r.valeur ?? 0;
    if (!topClient) return [];
    const autres = 100 - topPct;
    const result: ClientShare[] = [{ client: topClient, pct: topPct }];
    if (autres > 0) result.push({ client: 'Autres clients', pct: autres });
    return result;
  }, [data]);

  return (
    // Spec §11: surface claire #fcfcfb
    <div className="min-h-full bg-[#fcfcfb]">
      <PageHeader
        title="Mesurer votre activité"
        description={`Période : ${byId(data, 'ca_facture')?.periode.label ?? '…'}`}
      />

      <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">

        {/* Period filter — ONE line above everything (spec §12) */}
        <div className="mb-6">
          <PeriodSelector
            periode={periode}
            comparaison={comparaison}
            onPeriodeChange={setPeriode}
            onComparaisonChange={setComparaison}
          />
        </div>

        {/* ── Les chiffres du moment ──────────────────────────────────────── */}
        {/* Spec §10: 4 de tête = rangée de tuiles, héros ≥ 48 px */}
        <SectionTitle>Les chiffres du moment</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* horizon_travail */}
          <HeroTuile
            valeurFormatted={
              (() => {
                const r = byId(data, 'horizon_travail');
                if (!r || r.donneesInsuffisantes) return '—';
                const v = r.valeur ?? 0;
                const d = new Date();
                d.setDate(d.getDate() + v);
                return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(d);
              })()
            }
            context="Horizon de travail"
            sous={(() => {
              const r = byId(data, 'horizon_travail');
              if (!r || r.donneesInsuffisantes) return 'Pas encore assez de données';
              return `${r.valeur} jours de carnet`;
            })()}
            comparaison={comp('horizon_travail')}
            explication={ph('horizon_travail').explication}
            action={ph('horizon_travail').action}
            tone={ph('horizon_travail').tone}
            loading={isLoading}
          />

          {/* argent_qui_dort */}
          <HeroTuile
            valeurFormatted={
              (() => {
                const r = byId(data, 'argent_qui_dort');
                if (!r || r.donneesInsuffisantes) return '—';
                return fmtEURCompact(r.valeur ?? 0);
              })()
            }
            context="dorment chez vos clients"
            sous={(() => {
              const r = byId(data, 'argent_qui_dort');
              const plus60 = r?.detail?.plus60Jours as number | undefined;
              if (plus60 && plus60 > 0) return `dont ${fmtEURCompact(plus60)} à plus de 60 jours`;
              return null;
            })()}
            comparaison={comp('argent_qui_dort')}
            explication={ph('argent_qui_dort').explication}
            action={ph('argent_qui_dort').action}
            tone={ph('argent_qui_dort').tone}
            loading={isLoading}
          />

          {/* marge_pour_100_euros */}
          <HeroTuile
            valeurFormatted={
              (() => {
                const r = byId(data, 'marge_pour_100_euros');
                if (!r || r.donneesInsuffisantes) return '—';
                return `${Math.round(r.valeur ?? 0)} €`;
              })()
            }
            context="restent sur 100 € facturés"
            sous={null}
            comparaison={comp('marge_pour_100_euros')}
            explication={ph('marge_pour_100_euros').explication}
            tone={ph('marge_pour_100_euros').tone}
            loading={isLoading}
          />

          {/* delai_paiement_client (délai standard) — ca_encaisse (comptant) */}
          {encaissementComptant ? (
            <HeroTuile
              valeurFormatted={
                (() => {
                  const r = byId(data, 'ca_encaisse');
                  if (!r || r.donneesInsuffisantes) return '—';
                  return fmtEURCompact(r.valeur ?? 0);
                })()
              }
              context="encaissés"
              sous={null}
              comparaison={comp('ca_encaisse')}
              explication={ph('ca_encaisse').explication}
              tone={ph('ca_encaisse').tone}
              loading={isLoading}
            />
          ) : (
            <HeroTuile
              valeurFormatted={
                (() => {
                  const r = byId(data, 'delai_paiement_client');
                  if (!r || r.donneesInsuffisantes) return '—';
                  return `${r.valeur} j`;
                })()
              }
              context="délai de paiement moyen"
              sous={null}
              comparaison={comp('delai_paiement_client')}
              explication={ph('delai_paiement_client').explication}
              tone={ph('delai_paiement_client').tone}
              loading={isLoading}
            />
          )}
        </div>

        {/* ── Votre activité ─────────────────────────────────────────────── */}
        <SectionTitle>Votre activité</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <IndicateurTuile phrase={ph('ca_facture')} comparaison={comp('ca_facture')} loading={isLoading} />
          {encaissementComptant ? (
            <IndicateurTuile phrase={ph('delai_paiement_client')} comparaison={comp('delai_paiement_client')} loading={isLoading} />
          ) : (
            <IndicateurTuile phrase={ph('ca_encaisse')} comparaison={comp('ca_encaisse')} loading={isLoading} />
          )}
        </div>

        {/* Area chart — single series, no legend (spec §10 + §12) */}
        <div className="rounded-xl border border-border bg-card p-4">
          <CaEvolution periode={periode} />
        </div>

        {/* Résultat */}
        <div className="mt-3">
          <IndicateurTuile phrase={ph('resultat_exploitation_estime')} comparaison={comp('resultat_exploitation_estime')} loading={isLoading} />
        </div>

        {/* ── Le travail qui vient ───────────────────────────────────────── */}
        <SectionTitle>Le travail qui vient</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IndicateurTuile phrase={ph('carnet_commandes_euros')} comparaison={comp('carnet_commandes_euros')} loading={isLoading} />
          <IndicateurTuile phrase={ph('taux_signature_devis')} comparaison={comp('taux_signature_devis')} loading={isLoading} />
          <IndicateurTuile phrase={ph('montant_moyen_affaire')} comparaison={comp('montant_moyen_affaire')} loading={isLoading} />
          <IndicateurTuile phrase={ph('delai_reponse_devis')} comparaison={comp('delai_reponse_devis')} loading={isLoading} />
        </div>

        {/* ── Production ────────────────────────────────────────────────── */}
        <SectionTitle>Production</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <IndicateurTuile phrase={ph('ecart_devise_realise')} comparaison={comp('ecart_devise_realise')} loading={isLoading} />
          <IndicateurTuile phrase={ph('jours_factures_sur_payes')} loading={isLoading} />
        </div>

        {/* ── Concentration client ───────────────────────────────────────── */}
        <SectionTitle>Concentration</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <IndicateurTuile phrase={ph('concentration_client')} comparaison={comp('concentration_client')} loading={isLoading} />
          {/* Horizontal stacked bars — NEVER a pie chart (spec §10) */}
          <div className="rounded-xl border border-border bg-card p-4">
            <ConcentrationChart data={concentrationData} loading={isLoading} />
          </div>
        </div>

      </div>
    </div>
  );
}
