/**
 * Page publique d'acceptation d'un devis — /devis/accepter/:token
 * Accessible sans authentification.
 * Récupère les métadonnées du devis via GET /api/public/devis/:token/accept-page
 * puis soumet "bon pour accord" via POST /api/public/devis/:token/accept.
 */
import { useState } from 'react';
import { useRoute } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Clock, XCircle, FileText, Loader2 } from 'lucide-react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const API = `${BASE}/api`;

type AcceptPageData = {
  reference: string;
  clientName: string;
  totalTTCCents: number;
  validUntil?: string | null;
  alreadyAccepted: boolean;
  acceptedAt?: string;
  acceptedBy?: string;
  expired?: boolean;
};

export default function DevisAccepterPage() {
  const [, params] = useRoute('/devis/accepter/:token');
  const token = params?.token ?? '';

  const [signataire, setSignataire] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState('');

  const { data, isLoading, error } = useQuery<AcceptPageData>({
    queryKey: ['devis-accept-page', token],
    queryFn: async () => {
      const res = await fetch(`${API}/public/devis/${token}/accept-page`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Lien invalide');
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const acceptMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API}/public/devis/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signataire: signataire.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Erreur lors de l\'acceptation');
      return res.json();
    },
    onSuccess: (data) => {
      setAccepted(true);
      setAcceptedAt(data.acceptedAt ?? new Date().toISOString());
    },
  });

  if (!token) {
    return <ErrorScreen title="Lien invalide" message="Ce lien ne contient pas de jeton d'acceptation." />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return <ErrorScreen title="Lien invalide ou expiré" message="Ce lien d'acceptation n'existe pas ou a expiré." />;
  }

  if (data.expired) {
    return (
      <StatusScreen
        icon={<Clock className="h-12 w-12 text-yellow-500" />}
        title="Devis expiré"
        message={`Le devis ${data.reference} n'est plus valable depuis le ${data.validUntil ? new Date(data.validUntil).toLocaleDateString('fr-FR') : '—'}. Contactez votre prestataire pour obtenir un devis actualisé.`}
      />
    );
  }

  if (data.alreadyAccepted || accepted) {
    const when = accepted ? acceptedAt : data.acceptedAt;
    const by = accepted ? signataire : data.acceptedBy;
    return (
      <StatusScreen
        icon={<CheckCircle2 className="h-12 w-12 text-green-500" />}
        title="Devis accepté"
        message={`Le devis ${data.reference} a été accepté${by ? ` par ${by}` : ''}${when ? ` le ${new Date(when).toLocaleDateString('fr-FR', { dateStyle: 'long' })}` : ''}. Votre prestataire a été notifié.`}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-4">
              <FileText className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Acceptation de devis</h1>
          <p className="text-muted-foreground text-sm">
            Vous êtes invité(e) à accepter le devis suivant.
          </p>
        </div>

        {/* Devis summary card */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Référence</p>
              <p className="font-semibold text-lg">{data.reference}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Montant TTC</p>
              <p className="font-bold text-xl text-primary">
                {(data.totalTTCCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
              </p>
            </div>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Client</p>
            <p className="font-medium">{data.clientName}</p>
          </div>
          {data.validUntil && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Valable jusqu'au {new Date(data.validUntil).toLocaleDateString('fr-FR', { dateStyle: 'long' })}
            </div>
          )}
        </div>

        {/* Acceptance form */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="signataire">Votre nom complet *</Label>
            <Input
              id="signataire"
              value={signataire}
              onChange={e => setSignataire(e.target.value)}
              placeholder="Prénom Nom"
              autoComplete="name"
              className="text-base"
            />
            <p className="text-xs text-muted-foreground">
              En saisissant votre nom et en cliquant sur « Accepter », vous donnez votre accord pour ce devis (bon pour accord électronique).
            </p>
          </div>

          {acceptMut.isError && (
            <p className="text-sm text-destructive">
              {(acceptMut.error as Error).message}
            </p>
          )}

          <Button
            className="w-full gap-2"
            size="lg"
            disabled={!signataire.trim() || acceptMut.isPending}
            onClick={() => acceptMut.mutate()}
          >
            {acceptMut.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin" />Acceptation en cours…</>
              : <><CheckCircle2 className="h-4 w-4" />Accepter ce devis</>
            }
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Cette page est sécurisée. Votre accord est horodaté et transmis à votre prestataire.
        </p>
      </div>
    </div>
  );
}

function StatusScreen({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="flex justify-center">{icon}</div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <StatusScreen icon={<XCircle className="h-12 w-12 text-destructive" />} title={title} message={message} />
  );
}
