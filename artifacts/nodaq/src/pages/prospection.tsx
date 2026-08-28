/**
 * Prospection — signaux publics.
 *
 * Quatre sources indépendantes (appels d'offres, sous-traitance, syndics de
 * copropriété, permis de construire). Chacune gère seule ses états : une
 * section fonctionnelle ne dépend jamais d'une source non configurée
 * ailleurs. Aucun fournisseur n'est visé par défaut sur ce déploiement —
 * chaque section affiche honnêtement pourquoi elle est silencieuse.
 */
import { useState } from 'react';
import { AlertTriangle, Gavel, Hammer, Building2, FileSignature } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { PanneauPiste, LignePiste, type PisteDetail } from '@/components/piste-detail';
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

  // Une seule piste ouverte à la fois, et un seul panneau pour les quatre
  // sources — voir `piste-detail.tsx` pour pourquoi.
  const [piste, setPiste] = useState<PisteDetail | null>(null);

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
                <LignePiste
                  key={i}
                  testId={`marche-${i}`}
                  onClick={() => setPiste({
                    titre: m.objet ?? 'Marché public',
                    sousTitre: m.acheteur,
                    champs: [
                      { libelle: 'Acheteur', valeur: m.acheteur },
                      { libelle: 'Procédure', valeur: m.natureProcedure },
                      { libelle: 'Publié le', valeur: m.dateParution ? fmtDate(m.dateParution) : null },
                      { libelle: 'Réponse avant', valeur: m.dateLimiteReponse ? fmtDate(m.dateLimiteReponse) : null },
                      { libelle: 'Adresse', valeur: m.adresse },
                      { libelle: 'Départements', valeur: m.departements.join(', ') },
                      // Les codes CPV sont ce qui a fait retenir ce marché
                      // pour ce métier : les montrer, c'est rendre le filtre
                      // vérifiable plutôt qu'opaque.
                      { libelle: 'Codes CPV', valeur: m.cpv.join(', ') },
                    ],
                    source: m.source,
                  })}
                >
                  <div className="text-sm">
                    <div className="font-medium text-foreground">{m.objet ?? 'Marché public'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {[m.acheteur,
                        m.dateParution ? `publié le ${fmtDate(m.dateParution)}` : null,
                        m.dateLimiteReponse ? `réponse avant le ${fmtDate(m.dateLimiteReponse)}` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </LignePiste>
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
                <LignePiste
                  key={`pro-${i}`}
                  testId={`titulaire-${i}`}
                  onClick={() => setPiste({
                    titre: t.titulaireNom ?? 'Titulaire',
                    sousTitre: t.objet,
                    champs: [
                      { libelle: 'SIREN', valeur: t.titulaireSiren },
                      { libelle: 'Objet', valeur: t.objet },
                      { libelle: 'Montant', valeur: t.montant ? fmtEUR(t.montant * 100) : null },
                      { libelle: 'Notifié le', valeur: t.dateNotification ? fmtDate(t.dateNotification) : null },
                      { libelle: 'Secteur', valeur: t.secteur },
                      { libelle: 'Zone', valeur: t.zone },
                    ],
                    source: t.source,
                  })}
                >
                  <div className="text-sm">
                    <div className="font-medium text-foreground">{t.titulaireNom}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t.objet} {t.montant ? `· ${fmtEUR(t.montant * 100)}` : ''}
                    </div>
                  </div>
                </LignePiste>
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
                <LignePiste
                  key={i}
                  testId={`syndic-${i}`}
                  onClick={() => setPiste({
                    titre: s.nomSyndic ?? 'Syndic',
                    sousTitre: s.commune,
                    champs: [
                      { libelle: 'Commune', valeur: s.commune },
                      { libelle: 'Code postal', valeur: s.codePostal },
                    ],
                    source: s.source,
                    // Le registre est DÉCLARATIF, sans contrôle a posteriori,
                    // et sa couverture est estimée aux deux tiers. Le dire
                    // ici, au moment où l'artisan décide d'appeler — pas
                    // seulement dans une note de bas de page.
                    mention:
                      "Registre déclaratif, rempli par les syndics eux-mêmes et sans contrôle. "
                      + "Vérifiez que le mandat est toujours en cours avant d'appeler.",
                  })}
                >
                  <div className="text-sm">
                    <div className="font-medium text-foreground">{s.nomSyndic}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.commune}</div>
                  </div>
                </LignePiste>
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
                    <LignePiste
                      key={i}
                      testId={`permis-pro-${i}`}
                      onClick={() => setPiste({
                        titre: p.nomDemandeur ?? 'Demandeur',
                        sousTitre: p.nature,
                        champs: [
                          { libelle: 'Nature', valeur: p.nature },
                          { libelle: 'Numéro', valeur: p.numero },
                          { libelle: 'Adresse', valeur: p.adresse },
                          { libelle: 'Commune', valeur: [p.codePostal, p.commune].filter(Boolean).join(' ') },
                          { libelle: 'Accordé le', valeur: p.dateOctroi ? fmtDate(p.dateOctroi) : null },
                        ],
                        source: p.source,
                      })}
                    >
                      <div className="text-sm">
                        <div className="font-medium text-foreground">{p.nomDemandeur}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.nature} · {p.commune} {p.dateOctroi ? `· ${fmtDate(p.dateOctroi)}` : ''}
                        </div>
                      </div>
                    </LignePiste>
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
                    <LignePiste
                      key={i}
                      testId={`permis-particulier-${i}`}
                      onClick={() => setPiste({
                        titre: p.nomDemandeur ?? 'Demandeur particulier',
                        sousTitre: p.nature,
                        champs: [
                          { libelle: 'Nature', valeur: p.nature },
                          { libelle: 'Adresse', valeur: p.adresse },
                          { libelle: 'Commune', valeur: [p.codePostal, p.commune].filter(Boolean).join(' ') },
                          { libelle: 'Accordé le', valeur: p.dateOctroi ? fmtDate(p.dateOctroi) : null },
                        ],
                        // Une information publique portée par le permis, pas
                        // une cible. Le panneau n'offre aucun moyen de
                        // contact, et le dit — c'est le même refus que celui
                        // qui gate `PERMIS_AFFICHER_PISTES_PRO`, tenu jusque
                        // dans le détail.
                        mention:
                          "Information publique portée par le permis — ce n'est PAS une piste à "
                          + "démarcher. Aucun contact n'est proposé, et aucun ne le sera.",
                        // Les informations particuliers ne portent pas de
                        // source individuelle : c'est celle de la section.
                        source: permis.data!.pistesProfessionnelles[0]?.source
                          ?? { label: 'Permis de construire', url: '' },
                      })}
                    >
                      <div className="text-sm">
                        <div className="text-foreground">{p.nomDemandeur}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.adresse} · {p.nature}
                        </div>
                      </div>
                    </LignePiste>
                  ))}
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      <PanneauPiste piste={piste} onClose={() => setPiste(null)} />
    </div>
  );
}
