/**
 * Paramétrage du seuil de rentabilité — deux champs, et une explication.
 *
 * Ces deux valeurs ne sont dérivées de rien : la comptabilité du produit ne
 * distingue pas les charges fixes des charges variables, et « Autres achats
 * (61-62) » mélange le loyer et la sous-traitance. Les deviner produirait un
 * seuil faux — le chiffre sur lequel un patron décide d'embaucher.
 *
 * D'où l'aide sur la marge : c'est la notion que les artisans confondent le
 * plus souvent avec la marge commerciale.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';

const API = '/api';

export function ObjectifsParametres() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [chargesEuros, setChargesEuros] = useState('');
  const [tauxPct, setTauxPct] = useState('');

  useQuery({
    queryKey: ['parametres-objectifs'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/parametres`);
      if (!r.ok) throw new Error('Chargement impossible');
      const j = (await r.json()) as Record<string, string>;
      const charges = j['objectifs.charges_fixes_annuelles_cents'];
      const taux = j['objectifs.taux_marge_bp'];
      if (charges) setChargesEuros(String(Number(charges) / 100));
      if (taux) setTauxPct(String(Number(taux) / 100));
      return j;
    },
  });

  const enregistrer = useMutation({
    mutationFn: async () => {
      // Stockés en centimes et en points de base : jamais en flottants
      // d'euros ni en pourcentages, qui ne s'additionnent pas exactement.
      const r = await apiFetch(`${API}/parametres`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'objectifs.charges_fixes_annuelles_cents': String(Math.round(Number(chargesEuros) * 100)),
          'objectifs.taux_marge_bp': String(Math.round(Number(tauxPct) * 100)),
        }),
      });
      if (!r.ok) throw new Error('Enregistrement impossible');
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Objectif enregistré', description: 'Votre seuil apparaît sur le cockpit.' });
      void queryClient.invalidateQueries({ queryKey: ['cockpit-objectifs'] });
    },
    onError: (e: Error) => toast({ title: 'Échec', description: e.message, variant: 'destructive' }),
  });

  const valide = Number(chargesEuros) > 0 && Number(tauxPct) > 0 && Number(tauxPct) <= 100;

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Target className="h-4 w-4 text-primary" /> Seuil de rentabilité
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Le chiffre d'affaires à partir duquel votre entreprise couvre ses frais. Nous ne
        le devinons pas : ces deux valeurs n'existent nulle part dans vos données.
      </p>

      <label className="mb-1 block text-xs text-muted-foreground" htmlFor="charges-fixes">
        Charges fixes annuelles (€)
      </label>
      <Input
        id="charges-fixes"
        type="number"
        inputMode="decimal"
        placeholder="120000"
        className="mb-1"
        value={chargesEuros}
        onChange={(e) => setChargesEuros(e.target.value)}
      />
      <p className="mb-4 text-xs text-muted-foreground">
        Ce que vous payez même sans chantier : loyer, assurances, salaires permanents,
        crédits, comptable.
      </p>

      <label className="mb-1 block text-xs text-muted-foreground" htmlFor="taux-marge">
        Taux de marge sur coûts variables (%)
      </label>
      <Input
        id="taux-marge"
        type="number"
        inputMode="decimal"
        placeholder="35"
        className="mb-1"
        value={tauxPct}
        onChange={(e) => setTauxPct(e.target.value)}
      />
      <p className="mb-4 text-xs text-muted-foreground">
        Sur 100 € facturés, ce qu'il vous reste <strong>après</strong> les matériaux et la
        sous-traitance de ce chantier — avant vos frais fixes. Ce n'est pas votre marge
        finale.
      </p>

      <Button onClick={() => enregistrer.mutate()} disabled={!valide || enregistrer.isPending}>
        {enregistrer.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Enregistrer
      </Button>
    </div>
  );
}
