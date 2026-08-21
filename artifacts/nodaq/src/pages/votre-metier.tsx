import { useState, useEffect } from 'react';
import { Building2, Save } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useVertical, useUpdateVerticalMutation } from '@/hooks/use-vertical';
import { verticalChoices, affaireWords, verticalPack, type Vertical } from '@nodaq/shared';

// US-A1.1 : ce réglage lisait/écrivait sa propre liste de 5 secteurs ad hoc,
// disjointe du moteur de vocabulaire (`verticalPacks.ts`) — un tenant ayant
// choisi "commerce" ici n'avait par exemple AUCUN mot de métier associé
// ailleurs dans l'app. Cet écran est désormais une simple vue sur le même
// moteur que l'onboarding (`useVertical`, `verticalChoices`).

const { cible, ancien } = verticalChoices();

export default function VotreMetierPage() {
  const { toast } = useToast();
  const { vertical, isLoading } = useVertical();
  const { updateVertical, isPending } = useUpdateVerticalMutation();

  const [selected, setSelected] = useState<Vertical>('industrie_btp');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (vertical) {
      setSelected(vertical as Vertical);
      setDirty(false);
    }
  }, [vertical]);

  const handleChange = (v: Vertical) => {
    setSelected(v);
    setDirty(v !== (vertical ?? 'industrie_btp'));
  };

  const handleSave = () => {
    updateVertical(selected, {
      onSuccess: () => {
        setDirty(false);
        toast({ title: 'Métier enregistré' });
      },
      onError: () => toast({ title: 'Erreur', description: 'Sauvegarde échouée', variant: 'destructive' }),
    });
  };

  const words = affaireWords(selected);
  const pack = verticalPack(selected);

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Plateforme"
        title="Votre métier"
        description="Configurez votre secteur d'activité pour personnaliser le vocabulaire et les modules proposés."
        actions={
          <Button
            onClick={handleSave}
            disabled={!dirty || isPending}
            className="gap-1.5"
          >
            <Save className="h-4 w-4" />
            {isPending ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
        }
      />

      <div className="px-5 md:px-8 pt-6 max-w-lg space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-card-border bg-card p-6 space-y-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent">
                  <Building2 className="h-5 w-5 text-sidebar-foreground/70" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Votre métier</h3>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    Il détermine le mot que le produit emploie pour vos affaires et les modules
                    proposés par défaut. Il sert aussi à la veille réglementaire, quand elle est activée.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="choix-metier" className="text-sm font-medium text-foreground">Métier :</label>
                <select
                  id="choix-metier"
                  value={selected}
                  onChange={e => handleChange(e.target.value as Vertical)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <optgroup label="Métiers">
                    {cible.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Ancien découpage">
                    {ancien.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                Aperçu : « {words.newLabel} », « {words.noneLabel} », {words.plural} en cours,
                « {pack.proposalWord} ».
              </div>
            </div>

            {!dirty && (
              <p className="text-xs text-muted-foreground">
                Secteur actuel : <span className="text-foreground font-medium">{pack.label}</span>.
                Modifiez le secteur ci-dessus pour activer l'enregistrement.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
