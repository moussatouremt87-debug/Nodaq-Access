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
import { useVertical } from '@/hooks/use-vertical';
import { apiFetch } from '@/lib/auth';

const API = '/api';

export function ObjectifsParametres() {
  const { toast } = useToast();
  const { words } = useVertical();
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

  /**
   * L'ÉCHO — ce que la borne ne peut pas faire.
   *
   * Une borne attrape `35` au lieu de `3500`, mais pas 120 000 centimes saisis
   * en croyant écrire des euros : 1 200 € reste plausible pour une très petite
   * structure, et refuser une valeur plausible refuserait aussi des cas
   * légitimes.
   *
   * Ce qu'une borne ne peut pas distinguer, l'utilisateur le voit d'un coup
   * d'œil : personne ne laisse passer « 100 € par mois » pour une entreprise
   * avec trois salariés. On rend donc la valeur comprise, mise en forme, et
   * ramenée à une échelle que l'artisan connaît — le mois.
   */
  const echoCharges = (() => {
    const annuel = Number(chargesEuros);
    if (!Number.isFinite(annuel) || annuel <= 0) return null;
    const fmt = (n: number) =>
      n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    return `${fmt(annuel)} de charges fixes par an, soit ${fmt(annuel / 12)} par mois.`;
  })();

  const echoTaux = (() => {
    const pct = Number(tauxPct);
    if (!Number.isFinite(pct) || pct <= 0) return null;
    const reste = Math.round(pct);
    return `Sur 100 € facturés, il vous reste ${reste} € après matériaux et sous-traitance.`;
  })();

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
      {echoCharges && (
        <p className="mb-1 text-xs font-medium text-primary" data-testid="echo-charges">
          {echoCharges}
        </p>
      )}
      <p className="mb-4 text-xs text-muted-foreground">
        Ce que vous payez même sans {words.singular} : loyer, assurances, salaires permanents,
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
      {echoTaux && (
        <p className="mb-1 text-xs font-medium text-primary" data-testid="echo-taux">
          {echoTaux}
        </p>
      )}
      <p className="mb-4 text-xs text-muted-foreground">
        Sur 100 € facturés, ce qu'il vous reste <strong>après</strong> les matériaux et la
        sous-traitance — avant vos frais fixes. Ce n'est pas votre marge
        finale.
      </p>

      <Button onClick={() => enregistrer.mutate()} disabled={!valide || enregistrer.isPending}>
        {enregistrer.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Enregistrer
      </Button>
    </div>
  );
}
