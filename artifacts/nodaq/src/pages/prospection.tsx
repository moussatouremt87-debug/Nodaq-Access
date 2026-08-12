/**
 * Prospection — signaux publics.
 *
 * Quatre sources indépendantes (appels d'offres, sous-traitance, syndics de
 * copropriété, permis de construire). Chacune gère seule ses états : une
 * section fonctionnelle ne dépend jamais d'une source non configurée
 * ailleurs. Aucun fournisseur n'est visé par défaut sur ce déploiement —
 * chaque section affiche honnêtement pourquoi elle est silencieuse.
 */
import { AlertTriangle, Gavel, Hammer, Building2, FileSignature } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { fmtDate, fmtEUR } from '@/lib/format';
import {
  useAppelsOffres,
  useSousTraitance,
  useSyndics,
  usePermisConstruire,
} from '@/hooks/use-prospection-publique';

function BandeauSilence({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5 flex gap-3" data-testid="bandeau-silence">
      <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function Section({
  icon: Icon,
  titre,
  description,
  children,
}: {
  icon: typeof Gavel;
  titre: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">{titre}</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">{description}</p>
      {children}
    </section>
  );
}

function SourceFooter({ label, url }: { label: string; url: string }) {
  return (
    <p className="text-[11px] text-muted-foreground pt-2 border-t border-border/60 mt-2">
      Source : {label} —{' '}
      <a href={url} target="_blank" rel="noreferrer" className="underline">
        {url}
      </a>
    </p>
  );
}

export default function Prospection() {
  const appelsOffres = useAppelsOffres();
  const sousTraitance = useSousTraitance();
  const syndics = useSyndics();
  const permis = usePermisConstruire();

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Commercial"
        title="Prospection"
        description="Des signaux publics pour trouver vos prochains chantiers — jamais un particulier démarché sans base légale."
      />

      <div className="px-5 md:px-8 pt-6 space-y-8">
        <Section
          icon={Gavel}
          titre="Appels d'offres"
          description="Avis de marchés publics du BTP dans votre zone (BOAMP)."
        >
          {appelsOffres.isLoading ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : appelsOffres.isError ? (
            <div className="p-4 text-sm text-destructive rounded-xl border border-card-border bg-card">
              Impossible de charger les appels d'offres.
            </div>
          ) : appelsOffres.data?.raisonSilence ? (
            <BandeauSilence message={appelsOffres.data.messageSilence ?? ''} />
          ) : appelsOffres.data?.marches.length === 0 ? (
            <Empty className="py-8 rounded-xl border border-dashed border-card-border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Gavel />
                </EmptyMedia>
                <EmptyTitle>Aucun marché récent</EmptyTitle>
                <EmptyDescription>Rien de publié dans votre zone pour le moment.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="rounded-xl border border-card-border bg-card divide-y divide-border">
              {appelsOffres.data?.marches.map((m, i) => (
                <div key={i} className="p-3 text-sm" data-testid={`marche-${i}`}>
                  <div className="font-medium text-foreground">{m.objet ?? 'Marché public'}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {m.acheteur} {m.dateLimiteReponse ? `· réponse avant le ${fmtDate(m.dateLimiteReponse)}` : ''}
                  </div>
                </div>
              ))}
              {appelsOffres.data && appelsOffres.data.marches.length > 0 && (
                <div className="p-3">
                  <SourceFooter
                    label={appelsOffres.data.marches[0]!.source.label}
                    url={appelsOffres.data.marches[0]!.source.url}
                  />
                </div>
              )}
            </div>
          )}
        </Section>

        <Section
          icon={Hammer}
          titre="Sous-traitance"
          description="Entreprises venant de remporter un marché public près de chez vous — piste de sous-traitance."
        >
          {sousTraitance.isLoading ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : sousTraitance.isError ? (
            <div className="p-4 text-sm text-destructive rounded-xl border border-card-border bg-card">
              Impossible de charger la sous-traitance.
            </div>
          ) : sousTraitance.data?.raisonSilence ? (
            <BandeauSilence message={sousTraitance.data.messageSilence ?? ''} />
          ) : sousTraitance.data && sousTraitance.data.agregats.length === 0 && sousTraitance.data.titulairesProfessionnels.length === 0 ? (
            <Empty className="py-8 rounded-xl border border-dashed border-card-border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Hammer />
                </EmptyMedia>
                <EmptyTitle>Rien à signaler</EmptyTitle>
                <EmptyDescription>Aucun volume suffisant pour publier un signal dans votre zone.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="rounded-xl border border-card-border bg-card divide-y divide-border">
              {sousTraitance.data?.agregats.map((a, i) => (
                <div key={i} className="p-3 text-sm flex items-center justify-between" data-testid={`agregat-decp-${i}`}>
                  <span className="text-foreground">{a.secteur} — {a.zone}</span>
                  <span className="font-mono-nums text-muted-foreground">{a.occurrences} marché(s)</span>
                </div>
              ))}
              {sousTraitance.data?.titulairesProfessionnels.map((t, i) => (
                <div key={`pro-${i}`} className="p-3 text-sm" data-testid={`titulaire-${i}`}>
                  <div className="font-medium text-foreground">{t.titulaireNom}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.objet} {t.montant ? `· ${fmtEUR(t.montant * 100)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          icon={Building2}
          titre="Syndics de copropriété"
          description="Syndics professionnels de votre secteur — l'entretien des parties communes revient chaque année."
        >
          {syndics.isLoading ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : syndics.isError ? (
            <div className="p-4 text-sm text-destructive rounded-xl border border-card-border bg-card">
              Impossible de charger les syndics.
            </div>
          ) : syndics.data?.raisonSilence ? (
            <BandeauSilence message={syndics.data.messageSilence ?? ''} />
          ) : syndics.data && syndics.data.agregats.length === 0 && syndics.data.syndicsProfessionnels.length === 0 ? (
            <Empty className="py-8 rounded-xl border border-dashed border-card-border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Building2 />
                </EmptyMedia>
                <EmptyTitle>Aucun syndic identifié</EmptyTitle>
                <EmptyDescription>Rien dans votre commune pour le moment.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="rounded-xl border border-card-border bg-card divide-y divide-border">
              {syndics.data?.syndicsProfessionnels.map((s, i) => (
                <div key={i} className="p-3 text-sm" data-testid={`syndic-${i}`}>
                  <div className="font-medium text-foreground">{s.nomSyndic}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.commune}</div>
                </div>
              ))}
              {syndics.data?.agregats.map((a, i) => (
                <div key={`agr-${i}`} className="p-3 text-sm flex items-center justify-between" data-testid={`agregat-syndic-${i}`}>
                  <span className="text-muted-foreground">Copropriétés en syndic bénévole — {a.commune}</span>
                  <span className="font-mono-nums text-muted-foreground">{a.occurrences}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          icon={FileSignature}
          titre="Permis de construire"
          description="Permis, déclarations préalables et permis d'aménager récemment accordés dans votre zone."
        >
          {permis.isLoading ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : permis.isError ? (
            <div className="p-4 text-sm text-destructive rounded-xl border border-card-border bg-card">
              Impossible de charger les permis.
            </div>
          ) : permis.data?.raisonSilence ? (
            <BandeauSilence message={permis.data.messageSilence ?? ''} />
          ) : permis.data && permis.data.pistesProfessionnelles.length === 0 && permis.data.informationsParticuliers.length === 0 ? (
            <Empty className="py-8 rounded-xl border border-dashed border-card-border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSignature />
                </EmptyMedia>
                <EmptyTitle>Aucun permis récent</EmptyTitle>
                <EmptyDescription>Rien de publié dans votre zone pour le moment.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-3">
              {permis.data && permis.data.pistesProfessionnelles.length > 0 && (
                <div className="rounded-xl border border-card-border bg-card divide-y divide-border">
                  {permis.data.pistesProfessionnelles.map((p, i) => (
                    <div key={i} className="p-3 text-sm" data-testid={`permis-pro-${i}`}>
                      <div className="font-medium text-foreground">{p.nomDemandeur}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.nature} · {p.commune} {p.dateOctroi ? `· ${fmtDate(p.dateOctroi)}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {permis.data && permis.data.informationsParticuliers.length > 0 && (
                <div className="rounded-xl border border-card-border bg-muted/30 divide-y divide-border">
                  <p className="p-3 text-[11px] text-muted-foreground">
                    Ces particuliers sont une information — pas une piste à contacter. Aucun numéro,
                    aucun e-mail, et aucune action de contact n'est proposée ici.
                  </p>
                  {permis.data.informationsParticuliers.map((p, i) => (
                    <div key={i} className="p-3 text-sm" data-testid={`permis-particulier-${i}`}>
                      <div className="text-foreground">{p.nomDemandeur}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.adresse} · {p.nature}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
