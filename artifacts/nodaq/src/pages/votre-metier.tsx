import { useState, useEffect } from 'react';
import { Building2, Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';

const API = '/api';

type MetierData = { metier: string };

const SECTEURS: { value: string; label: string }[] = [
  { value: 'industrie_btp',       label: 'Industrie / BTP (ancien découpage)' },
  { value: 'commerce',            label: 'Commerce / Distribution' },
  { value: 'services_conseil',    label: 'Services / Conseil' },
  { value: 'sante',               label: 'Santé' },
  { value: 'autre',               label: 'Autre' },
];

const VOCAB: Record<string, { nouveau: string; aucun: string; pluriel: string }> = {
  industrie_btp:    { nouveau: 'Nouveau chantier',   aucun: 'Aucun chantier',   pluriel: 'chantiers en cours' },
  commerce:         { nouveau: 'Nouvelle commande',  aucun: 'Aucune commande',  pluriel: 'commandes en cours' },
  services_conseil: { nouveau: 'Nouvelle mission',   aucun: 'Aucune mission',   pluriel: 'missions en cours' },
  sante:            { nouveau: 'Nouveau dossier',    aucun: 'Aucun dossier',    pluriel: 'dossiers en cours' },
  autre:            { nouveau: 'Nouvelle affaire',   aucun: 'Aucune affaire',   pluriel: 'affaires en cours' },
};

function useMetier() {
  return useQuery<MetierData>({
    queryKey: ['votre-metier'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/votre-metier`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json();
    },
  });
}

export default function VotreMetierPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useMetier();

  const [selected, setSelected] = useState('industrie_btp');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setSelected(data.metier);
      setDirty(false);
    }
  }, [data]);

  const handleChange = (v: string) => {
    setSelected(v);
    setDirty(v !== (data?.metier ?? 'industrie_btp'));
  };

  const saveMut = useMutation({
    mutationFn: async (metier: string) => {
      const res = await apiFetch(`${API}/votre-metier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metier }),
      });
      if (!res.ok) throw new Error('Sauvegarde échouée');
      return res.json() as Promise<MetierData>;
    },
    onSuccess: (d) => {
      qc.setQueryData(['votre-metier'], d);
      setDirty(false);
      toast({ title: 'Métier enregistré' });
    },
    onError: (err: Error) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  const vocab = VOCAB[selected] ?? VOCAB['autre'];
  const sectorLabel = SECTEURS.find(s => s.value === selected)?.label ?? selected;

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Plateforme"
        title="Votre métier"
        description="Configurez votre secteur d'activité pour personnaliser le vocabulaire et les modules proposés."
        actions={
          <Button
            onClick={() => saveMut.mutate(selected)}
            disabled={!dirty || saveMut.isPending}
            className="gap-1.5"
          >
            <Save className="h-4 w-4" />
            {saveMut.isPending ? 'Enregistrement...' : 'Enregistrer'}
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
                <label className="text-sm font-medium text-foreground">Métier :</label>
                <select
                  value={selected}
                  onChange={e => handleChange(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {SECTEURS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                Aperçu : « {vocab.nouveau} », « {vocab.aucun} », {vocab.pluriel}.
              </div>
            </div>

            {!dirty && (
              <p className="text-xs text-muted-foreground">
                Secteur actuel : <span className="text-foreground font-medium">{sectorLabel}</span>.
                Modifiez le secteur ci-dessus pour activer l'enregistrement.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
