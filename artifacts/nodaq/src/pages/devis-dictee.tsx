/**
 * Devis dicté — relecture avant émission.
 *
 * L'écran qui rend la dictée utilisable : chaque ligne est modifiable,
 * supprimable, et une ligne peut être ajoutée. La provenance du prix est
 * TOUJOURS visible — catalogue, saisi, ou à compléter — parce qu'un prix dont
 * on ignore l'origine ne se signe pas.
 *
 * Le total affiché ici est indicatif : c'est le serveur qui recalcule à la
 * création du devis, et c'est lui qui fait foi.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useLocation } from 'wouter';
import { Mic, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';
import { fmtEUR } from '@/lib/format';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type Provenance = 'catalogue' | 'alias' | 'a_completer';

type Ligne = {
  libelle: string;
  quantite: number | null;
  unite: string | null;
  prixUnitaireHtCents: number | null;
  tauxTva: number | null;
  provenance: Provenance;
  catalogueLigneId: string | null;
};

type Proposition = {
  lignes: Ligne[];
  totalHtCents: number;
  lignesChiffrees: number;
  lignesACompleter: number;
  decoupageIllisible: boolean;
  catalogueVide: boolean;
};

const ETIQUETTE: Record<Provenance, { texte: string; classe: string }> = {
  catalogue: { texte: 'catalogue', classe: 'text-primary' },
  alias: { texte: 'appris', classe: 'text-primary' },
  a_completer: { texte: 'à compléter', classe: 'text-yellow-400' },
};

export default function DevisDictee() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [texte, setTexte] = useState('');
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [clientName, setClientName] = useState('');
  const [avertissements, setAvertissements] = useState<{ illisible: boolean; catalogueVide: boolean }>({
    illisible: false,
    catalogueVide: false,
  });

  const proposer = useMutation({
    mutationFn: async (): Promise<Proposition> => {
      const r = await apiFetch(`${API}/devis/dictee/proposer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texte }),
      });
      if (!r.ok) {
        const corps = await r.json().catch(() => ({}));
        throw new Error(corps.error ?? 'Proposition impossible');
      }
      return r.json();
    },
    onSuccess: (p) => {
      setLignes(p.lignes);
      setAvertissements({ illisible: p.decoupageIllisible, catalogueVide: p.catalogueVide });
    },
    onError: (e: Error) => toast({ title: 'Échec', description: e.message, variant: 'destructive' }),
  });

  const creerDevis = useMutation({
    mutationFn: async () => {
      // On n'envoie AUCUN total : le serveur recalcule, et c'est lui qui fait foi.
      const lines = (lignes ?? [])
        .filter((l) => l.prixUnitaireHtCents !== null && l.quantite !== null)
        .map((l) => ({
          description: l.libelle,
          quantity: l.quantite!,
          unitPriceCents: l.prixUnitaireHtCents!,
          vatRate: l.tauxTva ?? 20,
          ...(l.unite ? { unit: l.unite } : {}),
        }));
      const r = await apiFetch(`${API}/devis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName, lines }),
      });
      if (!r.ok) {
        const corps = await r.json().catch(() => ({}));
        throw new Error(corps.error ?? 'Création impossible');
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: 'Devis créé', description: 'Relisez-le avant de l’envoyer.' });
      navigate('/devis');
    },
    onError: (e: Error) => toast({ title: 'Échec', description: e.message, variant: 'destructive' }),
  });

  const majLigne = (i: number, patch: Partial<Ligne>) =>
    setLignes((ls) => (ls ?? []).map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const total = (lignes ?? []).reduce(
    (acc, l) =>
      l.prixUnitaireHtCents !== null && l.quantite !== null
        ? acc + l.prixUnitaireHtCents * l.quantite
        : acc,
    0,
  );
  const aCompleter = (lignes ?? []).filter(
    (l) => l.prixUnitaireHtCents === null || l.quantite === null,
  ).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-center gap-2">
        <Mic className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Devis dicté</h1>
      </div>

      <Textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={4}
        placeholder="Dictez ou collez la transcription : « pose de cloison BA13, trente mètres carrés, plus la peinture… »"
        className="mb-3"
      />
      <Button
        onClick={() => proposer.mutate()}
        disabled={texte.trim().length === 0 || proposer.isPending}
        className="mb-6 w-full sm:w-auto"
      >
        {proposer.isPending ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyse…</>
        ) : (
          'Proposer les lignes'
        )}
      </Button>

      {avertissements.catalogueVide && (
        <div className="mb-4 flex gap-2 rounded-xl border border-yellow-400/25 bg-yellow-400/5 p-4 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
          <div>
            Votre catalogue est vide : aucun prix ne peut être proposé. Renseignez vos tarifs,
            ou lancez la reprise depuis vos devis déjà émis.
          </div>
        </div>
      )}
      {avertissements.illisible && (
        <div className="mb-4 flex gap-2 rounded-xl border border-yellow-400/25 bg-yellow-400/5 p-4 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
          <div>Le découpage n’a rien donné d’exploitable. Ajoutez les lignes à la main.</div>
        </div>
      )}

      {lignes !== null && (
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-2">
          {lignes.map((l, i) => (
            <motion.div
              key={`${l.libelle}-${i}`}
              variants={itemVariants}
              className="rounded-xl border border-card-border bg-card p-4"
            >
              <div className="mb-2 flex items-start gap-2">
                <Input
                  value={l.libelle}
                  onChange={(e) => majLigne(i, { libelle: e.target.value })}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Supprimer la ligne"
                  onClick={() => setLignes((ls) => (ls ?? []).filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="Qté"
                  className="h-9 w-24 text-right font-mono-nums"
                  value={l.quantite ?? ''}
                  onChange={(e) =>
                    majLigne(i, { quantite: e.target.value === '' ? null : Number(e.target.value) })
                  }
                />
                <Input
                  placeholder="unité"
                  className="h-9 w-20"
                  value={l.unite ?? ''}
                  onChange={(e) => majLigne(i, { unite: e.target.value || null })}
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="Prix HT (€)"
                  className="h-9 w-32 text-right font-mono-nums"
                  value={l.prixUnitaireHtCents === null ? '' : l.prixUnitaireHtCents / 100}
                  onChange={(e) =>
                    majLigne(i, {
                      prixUnitaireHtCents:
                        e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                      // Un prix retouché à la main n'est plus « du catalogue » :
                      // le dire, sinon l'écran ment sur l'origine du chiffre.
                      provenance: e.target.value === '' ? 'a_completer' : l.provenance,
                    })
                  }
                />
                <span className={`text-[11px] uppercase tracking-wide ${ETIQUETTE[l.provenance].classe}`}>
                  {ETIQUETTE[l.provenance].texte}
                </span>
              </div>
            </motion.div>
          ))}

          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              setLignes((ls) => [
                ...(ls ?? []),
                {
                  libelle: '',
                  quantite: null,
                  unite: null,
                  prixUnitaireHtCents: null,
                  tauxTva: 20,
                  provenance: 'a_completer',
                  catalogueLigneId: null,
                },
              ])
            }
          >
            <Plus className="mr-2 h-4 w-4" /> Ajouter une ligne
          </Button>

          <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total HT chiffré</span>
              <span className="font-mono-nums text-2xl font-semibold">{fmtEUR(total)}</span>
            </div>
            {aCompleter > 0 && (
              <div className="mb-3 text-xs text-yellow-400">
                {aCompleter} ligne(s) sans prix ne sont pas comptées dans ce total.
              </div>
            )}
            <Input
              placeholder="Nom du client"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="mb-3"
            />
            <Button
              className="w-full"
              size="lg"
              disabled={clientName.trim().length === 0 || creerDevis.isPending || total === 0}
              onClick={() => creerDevis.mutate()}
            >
              {creerDevis.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Création…</>
              ) : (
                'Créer le devis'
              )}
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
