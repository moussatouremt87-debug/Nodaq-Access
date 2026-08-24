import { useState } from 'react';
import {
  ScrollText, Upload, Download, KeyRound, Webhook, Copy, Check, FileBarChart, Send,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from '@/components/ui/empty';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { toDateString } from '@nodaq/shared';

const API = '/api';

// US-A2.6 : aucune plateforme agréée n'est encore contractée. Cet écran
// couvre ce qui est livrable sans elle — dépôt manuel d'un Factur-X reçu
// (extraction automatique du SIREN/montant/date, aucune ressaisie), et le
// paramétrage prêt à recevoir un flux automatisé le jour où un contrat
// existe (voir lib/plateforme-agreee).

type DocumentRecu = {
  id: string;
  source: 'manuel' | 'api';
  fournisseurSiren: string | null;
  montantTtcCents: number | null;
  dateFacture: string | null;
  byteSize: number;
  receivedAt: string;
};

function fmtMontant(cents: number | null): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function useStatut() {
  return useQuery({
    queryKey: ['facturation-electronique-statut'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/facturation-electronique`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<{ paConfiguree: boolean; webhookConfigure: boolean }>;
    },
  });
}

function useDocuments() {
  return useQuery({
    queryKey: ['facturation-electronique-documents'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/facturation-electronique/documents`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<{ documents: DocumentRecu[]; total: number }>;
    },
  });
}

export default function FacturationElectroniquePage() {
  const qc = useQueryClient();
  const { data: statut, isLoading: statutLoading } = useStatut();
  const { data, isLoading, isError } = useDocuments();
  const documents = data?.documents ?? [];

  const invalider = () => {
    qc.invalidateQueries({ queryKey: ['facturation-electronique-statut'] });
    qc.invalidateQueries({ queryKey: ['facturation-electronique-documents'] });
  };

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Plateforme"
        title="Facturation électronique"
        description="Réception obligatoire des factures fournisseurs au format électronique, dès le 1er septembre 2026."
      />

      <div className="px-5 md:px-8 pt-6 space-y-6 max-w-3xl">
        <ParametragePaCard statut={statut} loading={statutLoading} onChange={invalider} />

        <EReportingCard paConfiguree={statut?.paConfiguree ?? false} />

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Documents reçus</h2>
          <UploadButton onSaved={invalider} />
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-destructive">Impossible de charger les documents.</div>
        ) : documents.length === 0 ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon"><ScrollText /></EmptyMedia>
              <EmptyTitle>Aucun document reçu</EmptyTitle>
              <EmptyDescription>
                Déposez un Factur-X reçu d'un fournisseur pour le capturer sans ressaisie.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
            <>
            {/* Sous `md:`, des CARTES — mêmes composants qu'au tableau. */}
            <div className="md:hidden divide-y divide-border">
              {documents.map((doc) => (
                <div key={doc.id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono-nums text-foreground truncate min-w-0">{doc.fournisseurSiren ?? '—'}</span>
                    <span className="font-mono-nums tabular-nums font-semibold text-foreground shrink-0">
                      {fmtMontant(doc.montantTtcCents)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span>{doc.dateFacture ? fmtDate(doc.dateFacture) : '—'}</span>
                    <span className="whitespace-nowrap">reçu le {fmtDate(doc.receivedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">Fournisseur (SIREN)</th>
                    <th className="px-4 py-3 font-medium text-right">Montant TTC</th>
                    <th className="px-4 py-3 font-medium">Date facture</th>
                    <th className="px-4 py-3 font-medium">Reçu le</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} className="border-b border-border last:border-0 hover-elevate">
                      <td className="px-5 py-3 font-mono-nums text-foreground">{doc.fournisseurSiren ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono-nums tabular-nums">{fmtMontant(doc.montantTtcCents)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{doc.dateFacture ? fmtDate(doc.dateFacture) : '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(doc.receivedAt)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{doc.source === 'manuel' ? 'Dépôt manuel' : 'Plateforme agréée'}</td>
                      <td className="px-3 py-3 text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" asChild>
                          <a href={`${API}/facturation-electronique/documents/${doc.id}/pdf`} target="_blank" rel="noreferrer" title="Télécharger">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          </div>
        )}
      </div>
    </div>
  );
}

function ParametragePaCard({
  statut,
  loading,
  onChange,
}: {
  statut?: { paConfiguree: boolean; webhookConfigure: boolean };
  loading: boolean;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [cleApi, setCleApi] = useState('');
  const [webhookGenere, setWebhookGenere] = useState<{ secret: string; webhookPath: string } | null>(null);
  const [copie, setCopie] = useState(false);

  const enregistrerCle = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`${API}/facturation-electronique`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleApi }),
      });
      if (!res.ok) throw new Error('Sauvegarde échouée');
    },
    onSuccess: () => {
      setCleApi('');
      onChange();
      toast({ title: 'Clé enregistrée' });
    },
    onError: () => toast({ title: 'Erreur', description: 'Sauvegarde échouée', variant: 'destructive' }),
  });

  const revoquerCle = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`${API}/facturation-electronique`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleApi: null }),
      });
      if (!res.ok) throw new Error('Révocation échouée');
    },
    onSuccess: () => { onChange(); toast({ title: 'Clé révoquée' }); },
  });

  const genererWebhook = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`${API}/facturation-electronique/webhook-secret`, { method: 'POST' });
      if (!res.ok) throw new Error('Génération échouée');
      return res.json() as Promise<{ secret: string; webhookPath: string }>;
    },
    onSuccess: (d) => { setWebhookGenere(d); onChange(); },
  });

  const copier = async (valeur: string) => {
    await navigator.clipboard.writeText(valeur);
    setCopie(true);
    setTimeout(() => setCopie(false), 2000);
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent">
          <KeyRound className="h-5 w-5 text-sidebar-foreground/70" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Connexion à une plateforme agréée</h3>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Aucune plateforme agréée n'est encore raccordée. Renseignez la clé API dès qu'un
            contrat existe — en attendant, déposez vos documents reçus manuellement ci-dessous.
          </p>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <>
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">Clé API</Label>
            {statut?.paConfiguree ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-primary flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> Clé enregistrée
                </span>
                <Button variant="outline" size="sm" onClick={() => revoquerCle.mutate()} disabled={revoquerCle.isPending}>
                  Révoquer
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={cleApi}
                  onChange={(e) => setCleApi(e.target.value)}
                  placeholder="Clé fournie par la plateforme agréée"
                  className="flex-1"
                  data-testid="input-pa-cle-api"
                />
                <Button onClick={() => enregistrerCle.mutate()} disabled={!cleApi.trim() || enregistrerCle.isPending}>
                  Enregistrer
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center gap-1.5">
              <Webhook className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-sm font-medium text-foreground">Secret de réception automatisée</Label>
            </div>
            {webhookGenere ? (
              <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm space-y-2">
                <p className="text-xs text-muted-foreground">
                  Copiez ce secret maintenant — il ne sera plus jamais affiché.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs bg-background rounded px-2 py-1.5 truncate">
                    {webhookGenere.secret}
                  </code>
                  <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => copier(webhookGenere.secret)}>
                    {copie ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground font-mono">{webhookGenere.webhookPath}</p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {statut?.webhookConfigure ? 'Un secret est déjà configuré.' : 'Aucun secret configuré.'}
                </span>
                <Button variant="outline" size="sm" onClick={() => genererWebhook.mutate()} disabled={genererWebhook.isPending}>
                  {statut?.webhookConfigure ? 'Régénérer' : 'Générer'}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function moisCourant(): { debut: string; fin: string } {
  const now = new Date();
  // toDateString (@nodaq/shared) lit les composants LOCAUX — un .toISOString()
  // ici convertirait en UTC et ferait glisser le jour d'un cran dans tout
  // fuseau en avance sur UTC (ex. Europe/Paris l'été), exactement le
  // problème déjà tranché par ce helper ailleurs dans le produit.
  return {
    debut: toDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    fin: toDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

type EReportingApercu = {
  transactionCount: number;
  totalCents: number;
  outOfPeriodCount: number;
  unusableCount: number;
  otherCurrencyCount: number;
};

function EReportingCard({ paConfiguree }: { paConfiguree: boolean }) {
  const { toast } = useToast();
  const defaut = moisCourant();
  const [periodeDebut, setPeriodeDebut] = useState(defaut.debut);
  const [periodeFin, setPeriodeFin] = useState(defaut.fin);
  const [tvaDeclareeEuros, setTvaDeclareeEuros] = useState('');

  const { data: apercu, isLoading, isError } = useQuery({
    queryKey: ['e-reporting-apercu', periodeDebut, periodeFin],
    queryFn: async () => {
      const sp = new URLSearchParams({ periodeDebut, periodeFin });
      const res = await apiFetch(`${API}/e-reporting/apercu?${sp}`);
      if (!res.ok) throw new Error('Fetch failed');
      return res.json() as Promise<EReportingApercu>;
    },
  });

  const declarer = useMutation({
    mutationFn: async () => {
      const tvaDeclareeCents = Math.round(parseFloat(tvaDeclareeEuros || '0') * 100);
      const res = await apiFetch(`${API}/e-reporting/declarer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeDebut, periodeFin, tvaDeclareeCents }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Déclaration impossible');
      }
      return res.json();
    },
    onSuccess: () => toast({ title: 'E-reporting transmis' }),
    onError: (err: Error) => toast({ title: 'Erreur', description: err.message, variant: 'destructive' }),
  });

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent">
          <FileBarChart className="h-5 w-5 text-sidebar-foreground/70" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">E-reporting</h3>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Obligatoire dès le 1er septembre 2026, quelle que soit la taille de votre entreprise.
            La TVA n'est pas calculée automatiquement — déclarez-la vous-même avant transmission.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          {/* `htmlFor`/`id` : le libellé était visuellement présent mais
              rattaché à rien — un lecteur d'écran annonçait « champ date »
              sans dire laquelle (US-A8.2). */}
          <Label htmlFor="periode-debut" className="text-xs text-muted-foreground">Début de période</Label>
          <Input id="periode-debut" type="date" value={periodeDebut} onChange={(e) => setPeriodeDebut(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="periode-fin" className="text-xs text-muted-foreground">Fin de période</Label>
          <Input id="periode-fin" type="date" value={periodeFin} onChange={(e) => setPeriodeFin(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : isError || !apercu ? (
        <div className="text-sm text-destructive">Impossible de calculer l'aperçu pour cette période.</div>
      ) : (
        <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1.5 text-sm" data-testid="e-reporting-apercu">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Transactions dans la période</span>
            <span className="font-mono-nums tabular-nums text-foreground">{apercu.transactionCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total HT</span>
            <span className="font-mono-nums tabular-nums text-foreground">
              {(apercu.totalCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            </span>
          </div>
          {apercu.outOfPeriodCount > 0 && (
            <div className="text-xs text-muted-foreground">
              {apercu.outOfPeriodCount} facture(s) hors période exclue(s).
            </div>
          )}
          {apercu.unusableCount > 0 && (
            <div className="text-xs text-muted-foreground">
              {apercu.unusableCount} facture(s) sans montant/date exploitable.
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-foreground">TVA à déclarer (€)</Label>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={tvaDeclareeEuros}
          onChange={(e) => setTvaDeclareeEuros(e.target.value)}
          placeholder="0.00"
          data-testid="input-tva-declaree"
        />
      </div>

      <Button
        onClick={() => declarer.mutate()}
        disabled={!paConfiguree || !tvaDeclareeEuros || declarer.isPending}
        className="gap-1.5"
      >
        <Send className="h-4 w-4" /> {declarer.isPending ? 'Transmission...' : 'Déclarer'}
      </Button>
      {!paConfiguree && (
        <p className="text-xs text-muted-foreground">
          Renseignez une clé API PA ci-dessus pour activer la transmission.
        </p>
      )}
    </div>
  );
}

function UploadButton({ onSaved }: { onSaved: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiFetch(`${API}/facturation-electronique/documents`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: 'Erreur',
          description: (err as { error?: string }).error ?? 'Dépôt impossible',
          variant: 'destructive',
        });
        return;
      }
      onSaved();
      toast({ title: 'Document capturé', description: 'SIREN, montant et date extraits automatiquement.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button asChild className="gap-1.5" disabled={saving}>
      <label className="cursor-pointer">
        <Upload className="h-4 w-4" /> {saving ? 'Dépôt...' : 'Déposer un document reçu'}
        <input type="file" accept="application/pdf" className="hidden" onChange={handleFile} disabled={saving} />
      </label>
    </Button>
  );
}
