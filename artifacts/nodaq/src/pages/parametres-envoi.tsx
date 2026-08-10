/**
 * Authentification du domaine d'envoi.
 *
 * L'écran dit à l'artisan CE QU'IL DOIT CRÉER, enregistrement par
 * enregistrement, avec le nom DNS exact et ce qu'il faut y mettre. Un « domaine
 * non vérifié » sans autre précision n'aide personne : il faut nommer la ligne
 * manquante.
 *
 * L'avertissement de délivrabilité en mode repli est affiché en permanence, pas
 * seulement au premier passage : un repli silencieux ferait croire que tout va
 * bien pendant que les devis tombent en indésirables.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, XCircle, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/auth';
import { containerVariants, itemVariants } from '@/lib/motion-variants';

const API = '/api';

type Parametres = {
  mode: 'domaine_authentifie' | 'repli_nodaq';
  domaine: string | null;
  emailExpediteur: string | null;
  nomExpediteur: string | null;
  dkimSelecteur: string | null;
  dkimValeur: string | null;
  verifieLe: string | null;
};

type Reponse = {
  parametres: Parametres | null;
  spfIncludeConfigure: boolean;
  avertissementDelivrabilite: boolean;
  messageAvertissement: string | null;
};

type Etat = {
  type: 'SPF' | 'DKIM' | 'DMARC';
  nom: string;
  present: boolean;
  conforme: boolean;
  valeurTrouvee: string | null;
  message: string;
  commentFaire: string;
};

type Diagnostic = { conforme: boolean; enregistrements: Etat[]; manquants: string[] };

export default function ParametresEnvoi() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [form, setForm] = useState<Partial<Parametres>>({});

  const { data, isLoading } = useQuery<Reponse>({
    queryKey: ['parametres-envoi'],
    queryFn: async () => {
      const r = await apiFetch(`${API}/parametres-envoi`);
      if (!r.ok) throw new Error('Chargement impossible');
      const j: Reponse = await r.json();
      if (j.parametres) setForm(j.parametres);
      return j;
    },
  });

  const enregistrer = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`${API}/parametres-envoi`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: form.mode ?? 'repli_nodaq',
          domaine: form.domaine ?? null,
          emailExpediteur: form.emailExpediteur ?? null,
          nomExpediteur: form.nomExpediteur ?? null,
          dkimSelecteur: form.dkimSelecteur ?? null,
          dkimValeur: form.dkimValeur ?? null,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Enregistrement impossible');
      return r.json();
    },
    onSuccess: () => {
      setDiagnostic(null);
      toast({ title: 'Paramètres enregistrés', description: 'Lancez la vérification DNS.' });
      void queryClient.invalidateQueries({ queryKey: ['parametres-envoi'] });
    },
    onError: (e: Error) => toast({ title: 'Échec', description: e.message, variant: 'destructive' }),
  });

  const verifier = useMutation({
    mutationFn: async (): Promise<Diagnostic> => {
      const r = await apiFetch(`${API}/parametres-envoi/verifier`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Vérification impossible');
      return r.json();
    },
    onSuccess: (d) => {
      setDiagnostic(d);
      void queryClient.invalidateQueries({ queryKey: ['parametres-envoi'] });
      toast({
        title: d.conforme ? 'Domaine authentifié' : 'Configuration incomplète',
        description: d.conforme
          ? 'Vos documents partiront désormais de votre domaine.'
          : `${d.manquants.length} enregistrement(s) à corriger.`,
        variant: d.conforme ? 'default' : 'destructive',
      });
    },
    onError: (e: Error) => toast({ title: 'Échec', description: e.message, variant: 'destructive' }),
  });

  const maj = (patch: Partial<Parametres>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex items-center gap-2">
        <Send className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">Envoi de vos documents</h1>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          {data?.avertissementDelivrabilite && (
            <div className="mb-5 flex gap-3 rounded-xl border border-yellow-400/25 bg-yellow-400/5 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-400" />
              <div className="text-sm">
                <div className="mb-1 font-medium text-yellow-400">Délivrabilité dégradée</div>
                {data.messageAvertissement}
              </div>
            </div>
          )}

          {data?.spfIncludeConfigure === false && (
            <div className="mb-5 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
              Le service d'envoi n'est pas configuré côté serveur (<code>EMAIL_SPF_INCLUDE</code>).
              L'authentification de domaine ne peut pas être proposée.
            </div>
          )}

          <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-3">
            <motion.div variants={itemVariants} className="rounded-xl border border-card-border bg-card p-4 space-y-3">
              <div className="text-sm font-medium">Votre domaine</div>
              <Input
                placeholder="toituremartin.fr"
                value={form.domaine ?? ''}
                onChange={(e) => maj({ domaine: e.target.value || null, mode: 'domaine_authentifie' })}
              />
              <Input
                placeholder="contact@toituremartin.fr"
                value={form.emailExpediteur ?? ''}
                onChange={(e) => maj({ emailExpediteur: e.target.value || null })}
              />
              <Input
                placeholder="Nom affiché — Toiture Martin"
                value={form.nomExpediteur ?? ''}
                onChange={(e) => maj({ nomExpediteur: e.target.value || null })}
              />

              <div className="pt-2 text-xs text-muted-foreground">
                Sélecteur et valeur DKIM : recopiez-les depuis la console de votre service d'envoi.
              </div>
              <Input
                placeholder="Sélecteur DKIM"
                value={form.dkimSelecteur ?? ''}
                onChange={(e) => maj({ dkimSelecteur: e.target.value || null })}
              />
              <Input
                placeholder="Valeur DKIM (v=DKIM1; k=rsa; p=…)"
                value={form.dkimValeur ?? ''}
                onChange={(e) => maj({ dkimValeur: e.target.value || null })}
              />

              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending}>
                  {enregistrer.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Enregistrer
                </Button>
                <Button
                  variant="outline"
                  onClick={() => verifier.mutate()}
                  disabled={verifier.isPending || !form.domaine}
                >
                  {verifier.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Vérifier le DNS
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { maj({ mode: 'repli_nodaq' }); enregistrer.mutate(); }}
                >
                  Rester en envoi nodaq.fr
                </Button>
              </div>
            </motion.div>

            {diagnostic && (
              <motion.div variants={itemVariants} className="space-y-2">
                {diagnostic.enregistrements.map((e) => (
                  <div
                    key={e.nom}
                    className={`rounded-xl border p-4 ${
                      e.conforme ? 'border-primary/25 bg-primary/5' : 'border-yellow-400/25 bg-yellow-400/5'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      {e.conforme ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : (
                        <XCircle className="h-4 w-4 text-yellow-400" />
                      )}
                      <span className="text-sm font-medium">{e.type}</span>
                      <code className="truncate text-xs text-muted-foreground">{e.nom}</code>
                    </div>
                    <div className="text-sm">{e.message}</div>
                    {!e.conforme && (
                      <div className="mt-2 text-xs text-muted-foreground">{e.commentFaire}</div>
                    )}
                    {e.valeurTrouvee && !e.conforme && (
                      <div className="mt-2 break-all rounded bg-muted p-2 text-[11px] font-mono-nums">
                        Trouvé : {e.valeurTrouvee}
                      </div>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </motion.div>
        </>
      )}
    </div>
  );
}
