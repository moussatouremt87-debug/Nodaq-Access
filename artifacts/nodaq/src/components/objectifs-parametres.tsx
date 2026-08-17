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
 *
 * US-A3.3 — RÉPARTITION PAR CATÉGORIE. Un taux unique est arbitraire pour un
 * commerce dont les marges varient fortement selon le rayon (alimentaire vs
 * bazar, par exemple). Repliée par défaut : ça ne concerne qu'une minorité
 * de profils, et la majorité ne doit pas voir un formulaire plus complexe
 * pour autant. Ce n'est PAS une donnée de vente réelle — le catalogue ne
 * porte aucun coût, aucune ligne de facture ne s'y rattache — c'est une
 * déclaration, comme le taux unique qu'elle remplace.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Target, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useVertical } from '@/hooks/use-vertical';
import { apiFetch } from '@/lib/auth';

const API = '/api';

type CategorieRow = { id: string; libelle: string; tauxPct: string; partPct: string };

const nouvelleCategorie = (): CategorieRow => ({
  id: crypto.randomUUID(), libelle: '', tauxPct: '', partPct: '',
});

/**
 * Moyenne du taux de marge pondérée par la part de CA — même formule que
 * `tauxMargePondere` (lib/shared) : normalisée par la somme réelle des
 * parts, pas par une hypothèse de 100 %. Dupliquée ici volontairement pour
 * un aperçu instantané, sans aller-retour réseau.
 */
function tauxPondereApercu(categories: CategorieRow[]): number | null {
  const valides = categories
    .map((c) => ({ taux: Number(c.tauxPct), part: Number(c.partPct) }))
    .filter((c) => Number.isFinite(c.taux) && c.taux > 0 && Number.isFinite(c.part) && c.part > 0);
  if (valides.length === 0) return null;
  const sommeParts = valides.reduce((s, c) => s + c.part, 0);
  if (sommeParts <= 0) return null;
  const sommePonderee = valides.reduce((s, c) => s + c.taux * c.part, 0);
  return sommePonderee / sommeParts;
}

export function ObjectifsParametres() {
  const { toast } = useToast();
  const { words } = useVertical();
  const queryClient = useQueryClient();
  const [chargesEuros, setChargesEuros] = useState('');
  const [tauxPct, setTauxPct] = useState('');
  const [repartitionActive, setRepartitionActive] = useState(false);
  const [categories, setCategories] = useState<CategorieRow[]>([nouvelleCategorie(), nouvelleCategorie()]);

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

      const repartitionBrute = j['objectifs.repartition_marge_json'];
      if (repartitionBrute) {
        try {
          const parsed = JSON.parse(repartitionBrute) as Array<{ libelle: string; tauxMargeBps: number; partCaBps: number }>;
          if (Array.isArray(parsed) && parsed.length > 0) {
            setRepartitionActive(true);
            setCategories(parsed.map((c) => ({
              id: crypto.randomUUID(),
              libelle: c.libelle,
              tauxPct: String(c.tauxMargeBps / 100),
              partPct: String(c.partCaBps / 100),
            })));
          }
        } catch {
          // JSON malformé en base (ne devrait jamais arriver) — reste en mode taux unique.
        }
      }
      return j;
    },
  });

  const enregistrer = useMutation({
    mutationFn: async () => {
      // Stockés en centimes et en points de base : jamais en flottants
      // d'euros ni en pourcentages, qui ne s'additionnent pas exactement.
      const updates: Record<string, string> = {
        'objectifs.charges_fixes_annuelles_cents': String(Math.round(Number(chargesEuros) * 100)),
      };
      if (repartitionActive) {
        updates['objectifs.repartition_marge_json'] = JSON.stringify(
          categories
            .filter((c) => c.libelle.trim() && Number(c.tauxPct) > 0 && Number(c.partPct) > 0)
            .map((c) => ({
              libelle: c.libelle.trim(),
              tauxMargeBps: Math.round(Number(c.tauxPct) * 100),
              partCaBps: Math.round(Number(c.partPct) * 100),
            })),
        );
      } else {
        updates['objectifs.taux_marge_bp'] = String(Math.round(Number(tauxPct) * 100));
        // Efface explicitement une répartition existante : sans ça, un
        // utilisateur qui désactive le mode et enregistre son taux unique
        // resterait piégé sur une ancienne répartition toujours active côté
        // serveur (`resoudreTauxMargeBps` la préfère au taux unique).
        updates['objectifs.repartition_marge_json'] = '[]';
      }

      const r = await apiFetch(`${API}/parametres`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Enregistrement impossible');
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Objectif enregistré', description: 'Votre seuil apparaît sur le cockpit.' });
      void queryClient.invalidateQueries({ queryKey: ['cockpit-objectifs'] });
    },
    onError: (e: Error) => toast({ title: 'Échec', description: e.message, variant: 'destructive' }),
  });

  const chargesValides = Number(chargesEuros) > 0;
  const categoriesValides = categories.filter(
    (c) => c.libelle.trim() && Number(c.tauxPct) > 0 && Number(c.tauxPct) <= 100 && Number(c.partPct) > 0,
  );
  const valide = chargesValides && (
    repartitionActive
      ? categoriesValides.length > 0
      : Number(tauxPct) > 0 && Number(tauxPct) <= 100
  );

  const tauxPondereEnCours = repartitionActive ? tauxPondereApercu(categories) : null;

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

  const majCategorie = (id: string, patch: Partial<CategorieRow>) =>
    setCategories((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const ajouterCategorie = () => setCategories((rows) => [...rows, nouvelleCategorie()]);
  const retirerCategorie = (id: string) => setCategories((rows) => rows.filter((r) => r.id !== id));

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Target className="h-4 w-4 text-primary" /> Seuil de rentabilité
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Le chiffre d'affaires à partir duquel votre entreprise couvre ses frais. Nous ne
        le devinons pas : ces valeurs n'existent nulle part dans vos données.
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

      <div className="mb-3 flex items-start gap-2.5">
        <Checkbox
          id="repartition-active"
          checked={repartitionActive}
          onCheckedChange={(v) => setRepartitionActive(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor="repartition-active" className="text-sm font-normal leading-snug cursor-pointer">
          Mes marges varient selon mes produits — je préfère répartir par catégorie plutôt
          qu'un taux unique
        </Label>
      </div>

      {!repartitionActive ? (
        <>
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
        </>
      ) : (
        <div className="mb-4 space-y-2" data-testid="repartition-categories">
          <p className="text-xs text-muted-foreground">
            Une ligne par catégorie de produits/prestations — libellé, taux de marge et part de
            votre chiffre d'affaires. Les parts n'ont pas besoin de sommer exactement à 100 %.
          </p>
          {categories.map((c, i) => (
            <div key={c.id} className="grid grid-cols-[1fr_90px_90px_32px] gap-2 items-end">
              <div className="space-y-1">
                {i === 0 && <Label className="text-xs">Catégorie</Label>}
                <Input
                  placeholder="ex. Alimentaire"
                  value={c.libelle}
                  onChange={(e) => majCategorie(c.id, { libelle: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                {i === 0 && <Label className="text-xs">Marge %</Label>}
                <Input
                  type="number" inputMode="decimal" placeholder="20"
                  value={c.tauxPct}
                  onChange={(e) => majCategorie(c.id, { tauxPct: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                {i === 0 && <Label className="text-xs">Part du CA %</Label>}
                <Input
                  type="number" inputMode="decimal" placeholder="60"
                  value={c.partPct}
                  onChange={(e) => majCategorie(c.id, { partPct: e.target.value })}
                />
              </div>
              <div className={i === 0 ? 'pt-5' : ''}>
                <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => retirerCategorie(c.id)} disabled={categories.length <= 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={ajouterCategorie}>
            <Plus className="h-3.5 w-3.5" /> Ajouter une catégorie
          </Button>
          {tauxPondereEnCours !== null && (
            <p className="pt-1 text-xs font-medium text-primary" data-testid="echo-taux-pondere">
              Taux de marge moyen pondéré : {tauxPondereEnCours.toFixed(1)} %.
            </p>
          )}
        </div>
      )}

      <Button onClick={() => enregistrer.mutate()} disabled={!valide || enregistrer.isPending}>
        {enregistrer.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Enregistrer
      </Button>
    </div>
  );
}
