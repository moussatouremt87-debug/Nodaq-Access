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

/**
 * Le nom d'un signal de chantier : son ADRESSE.
 *
 * Sitadel anonymise les personnes physiques — sur un échantillon réel, 44
 * permis de particuliers sur 100 ne portent aucun nom de demandeur. Nommer la
 * ligne par `nomDemandeur` produisait donc, le plus souvent, une ligne vide au
 * dessus du détail : une liste de rien.
 *
 * L'adresse, elle, est publiée. C'est aussi ce dont l'artisan a besoin : il ne
 * peut pas appeler ce particulier, mais il passe devant le chantier.
 *
 * Le repli descend jusqu'à la commune seule, puis à une mention explicite —
 * jamais une chaîne vide, qui rendrait la ligne incliquable à l'œil.
 */
function adresseChantier(p: {
  adresse: string | null;
  codePostal: string | null;
  commune: string | null;
}): string {
  const localite = [p.codePostal, p.commune].filter(Boolean).join(' ').trim();
  const rue = (p.adresse ?? '').trim();
  if (rue && localite && !rue.includes(localite)) return `${rue}, ${localite}`;
  return rue || localite || 'Adresse non publiée';
}

/** La superficie du terrain, ou `null` — jamais « 0 m² ». */
function fmtSuperficie(m2: number | null): string | null {
  return m2 !== null && m2 > 0 ? `${m2.toLocaleString('fr-FR')} m² de terrain` : null;
}

/**
 * Ce que l'écran dit quand les permis ne se chargent pas.
 *
 * `apiFetch` rejette avec le CORPS de la réponse en message (voir les hooks) :
 * quand le serveur a rédigé une explication — quota de la source atteint — il
 * faut la relayer telle quelle plutôt que d'y substituer un « impossible »
 * générique. Le repli ne sert que si le corps n'est pas exploitable, par
 * exemple quand c'est le réseau qui a lâché.
 */
function messageErreurPermis(err: unknown): string {
  const brut = err instanceof Error ? err.message : "";
  try {
    const corps = JSON.parse(brut) as { error?: unknown };
    if (typeof corps.error === "string" && corps.error.trim().length > 0) return corps.error;
  } catch {
    // Pas du JSON : ce n'est pas le serveur qui a parlé.
  }
  return (
    "Les permis n'ont pas pu être récupérés pour le moment. Ce n'est pas une " +
    "perte : réessayez dans quelques minutes."
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
            /*
             * Le message vient du SERVEUR quand il en donne un.
             *
             * « Impossible de charger les permis » a été affiché pendant des
             * jours alors que la source répondait simplement 429 : son quota
             * mensuel était atteint. Un plafond qui se lève tout seul n'est
             * pas une panne, et le dire ainsi faisait croire que nodaq était
             * cassé — exactement ce que la règle 3 bis interdit.
             */
            <BandeauSilence message={messageErreurPermis(permis.error)} />
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
              {permis.data?.donneesDu && (
                <p
                  className="rounded-xl border border-card-border bg-muted/30 p-3 text-[11px] text-muted-foreground"
                  data-testid="permis-donnees-datees"
                >
                  La source n'a pas répondu à l'instant : voici les permis tels qu'ils
                  étaient le {fmtDate(permis.data.donneesDu)}. Ils restent valables — les
                  autorisations d'urbanisme sont publiées au mois.
                </p>
              )}
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
                    Des chantiers autorisés chez des particuliers, près de chez vous. C'est un
                    repère de terrain, pas une liste à démarcher : la source ne publie ni nom,
                    ni numéro, ni e-mail, et aucune action de contact n'est proposée ici.
                  </p>
                  {permis.data.informationsParticuliers.map((p, i) => (
                    <LignePiste
                      key={i}
                      testId={`permis-particulier-${i}`}
                      onClick={() => setPiste({
                        titre: adresseChantier(p),
                        sousTitre: p.nature,
                        champs: [
                          { libelle: 'Nature', valeur: p.nature },
                          { libelle: 'Adresse', valeur: p.adresse },
                          { libelle: 'Commune', valeur: [p.codePostal, p.commune].filter(Boolean).join(' ') },
                          { libelle: 'Terrain', valeur: fmtSuperficie(p.superficieTerrain) },
                          { libelle: 'Accordé le', valeur: p.dateOctroi ? fmtDate(p.dateOctroi) : null },
                          // Affiché SEULEMENT s'il existe — la source anonymise
                          // les particuliers, donc c'est presque toujours vide,
                          // et `PanneauPiste` n'affiche pas les champs vides.
                          { libelle: 'Demandeur', valeur: p.nomDemandeur },
                        ],
                        // Une information publique portée par le permis, pas
                        // une cible. Le panneau n'offre aucun moyen de
                        // contact, et le dit — c'est le même refus que celui
                        // qui gate `PERMIS_AFFICHER_PISTES_PRO`, tenu jusque
                        // dans le détail.
                        mention:
                          "Signal de chantier : des travaux sont autorisés à cette adresse. Ce "
                          + "n'est PAS une piste à démarcher — un particulier ne se contacte pas "
                          + "à froid par e-mail ou par téléphone. Aucun contact n'est proposé, "
                          + "et aucun ne le sera.",
                        source: p.source,
                      })}
                    >
                      <div className="text-sm">
                        {/*
                          L'ADRESSE nomme la ligne, jamais `nomDemandeur` : la
                          source anonymise les particuliers, et cette ligne
                          rendait donc un titre VIDE au-dessus du détail.
                        */}
                        <div className="font-medium text-foreground">{adresseChantier(p)}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {[p.nature, fmtSuperficie(p.superficieTerrain),
                            p.dateOctroi ? fmtDate(p.dateOctroi) : null]
                            .filter(Boolean).join(' · ')}
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
