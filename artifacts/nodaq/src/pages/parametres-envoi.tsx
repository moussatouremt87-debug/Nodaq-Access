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
  mode: 'domaine_authentifie' | 'smtp_artisan' | 'repli_nodaq';
  domaine: string | null;
  emailExpediteur: string | null;
  nomExpediteur: string | null;
  dkimSelecteur: string | null;
  dkimValeur: string | null;
  verifieLe: string | null;
  smtpHote: string | null;
  smtpPort: number | null;
  smtpUtilisateur: string | null;
};

type Reponse = {
  parametres: Parametres | null;
  /** Un mot de passe est-il enregistré ? Jamais la valeur — elle ne sort pas du serveur. */
  smtpMotDePasseEnregistre: boolean;
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
  /**
   * Le mot de passe SMTP n'entre QUE dans un sens : le serveur ne le rend
   * jamais, donc il ne peut pas être pré-rempli. `null` = ne pas y toucher,
   * ce qui permet de réenregistrer les autres champs sans le ressaisir.
   */
  const [motDePasse, setMotDePasse] = useState<string | null>(null);

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
          smtpHote: form.smtpHote ?? null,
          smtpPort: form.smtpPort ?? null,
          smtpUtilisateur: form.smtpUtilisateur ?? null,
          // `undefined` disparaît du JSON : le serveur comprend « ne pas y
          // toucher ». Une chaîne vide, elle, serait refusée par le schéma —
          // c'est voulu, on ne veut pas d'un mot de passe vide.
          ...(motDePasse !== null ? { smtpMotDePasse: motDePasse } : {}),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Enregistrement impossible');
      return r.json();
    },
    onSuccess: () => {
      setDiagnostic(null);
      // Le champ se vide dès l'enregistrement : le mot de passe ne reste pas
      // dans l'état du navigateur plus longtemps que nécessaire.
      setMotDePasse(null);
      toast({ title: 'Paramètres enregistrés', description: 'Lancez la vérification DNS.' });
      void queryClient.invalidateQueries({ queryKey: ['parametres-envoi'] });
    },
    onError: (e: Error) => toast({ title: 'Échec', description: e.message, variant: 'destructive' }),
  });

  /**
   * Enrôlement automatique du domaine.
   *
   * Remplace le geste manuel — un humain qui enrôlait dans la console du
   * fournisseur, relevait le sélecteur DKIM et le recopiait — qui cessait de
   * tenir vers le dixième client.
   *
   * En cas de 503, le déploiement n'est pas configuré : on le DIT, sans
   * laisser croire qu'une préparation est en cours. Le chemin manuel reste
   * ouvert.
   */
  const enroler = useMutation({
    mutationFn: async () => {
      const r = await apiFetch(`${API}/parametres-envoi/enroler`, { method: 'POST' });
      const j = (await r.json().catch(() => ({}))) as { error?: string; replManuel?: boolean };
      if (!r.ok) throw new Error(j.error ?? "Enrôlement impossible");
      return j;
    },
    onSuccess: () => {
      setDiagnostic(null);
      toast({
        title: 'Domaine préparé',
        description: 'Publiez les trois enregistrements, puis lancez la vérification.',
      });
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

          {/* Quand le service d'envoi n'est pas configuré, on MASQUE le
              formulaire au lieu de l'afficher inerte. L'écran affichait
              simultanément « l'authentification ne peut pas être proposée » et
              le formulaire qui la propose, avec « Enregistrer » actif et
              « Vérifier » désactivé : il se contredisait. */}
          {data?.spfIncludeConfigure === false && (
            <div className="space-y-4">
              <div className="rounded-xl border border-card-border bg-card p-5 text-sm">
                <div className="mb-2 font-medium">L'envoi depuis votre domaine n'est pas encore disponible</div>
                <p className="text-muted-foreground">
                  Le service d'envoi n'est pas encore raccordé de notre côté. En attendant, vos
                  documents partent depuis nodaq.fr avec votre adresse en « répondre à ».
                  Nous vous préviendrons dès que vous pourrez authentifier votre domaine.
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { maj({ mode: 'repli_nodaq' }); enregistrer.mutate(); }}
                disabled={enregistrer.isPending}
              >
                Continuer avec l'envoi depuis nodaq.fr
              </Button>
            </div>
          )}

          {/* Rendu CONDITIONNEL et non masquage CSS : une classe `hidden`
              laisse les champs dans le DOM, donc atteignables au clavier et
              par un lecteur d'écran, et l'écran continue de proposer ce qu'il
              vient de déclarer impossible. */}
          {data?.spfIncludeConfigure !== false && (
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

              {/* ── SMTP de l'artisan ────────────────────────────────────────
                  Ajout du lot chiffrement, dans le formulaire EXISTANT : cet
                  écran a d'autres défauts, ils font l'objet d'un autre lot et
                  on ne le redessine pas ici.

                  Le mot de passe n'est jamais pré-rempli parce que le serveur
                  ne le rend jamais — pas même masqué. L'écran dit seulement
                  s'il y en a un. */}
              <div className="rounded-lg border border-card-border p-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Ou envoyez depuis votre propre messagerie
                </div>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    placeholder="smtp.votre-messagerie.fr"
                    value={form.smtpHote ?? ''}
                    onChange={(e) => maj({ smtpHote: e.target.value || null, mode: 'smtp_artisan' })}
                    data-testid="input-smtp-hote"
                  />
                  <Input
                    className="w-24"
                    placeholder="587"
                    inputMode="numeric"
                    value={form.smtpPort ?? ''}
                    onChange={(e) =>
                      maj({ smtpPort: e.target.value ? Number(e.target.value) : null })
                    }
                    data-testid="input-smtp-port"
                  />
                </div>
                <Input
                  placeholder="Identifiant — contact@toituremartin.fr"
                  value={form.smtpUtilisateur ?? ''}
                  onChange={(e) => maj({ smtpUtilisateur: e.target.value || null })}
                  data-testid="input-smtp-utilisateur"
                />
                <Input
                  type="password"
                  placeholder={
                    data?.smtpMotDePasseEnregistre
                      ? 'Mot de passe enregistré — saisir pour le remplacer'
                      : 'Mot de passe de votre messagerie'
                  }
                  value={motDePasse ?? ''}
                  onChange={(e) => setMotDePasse(e.target.value || null)}
                  data-testid="input-smtp-motdepasse"
                />
                <div className="text-xs text-muted-foreground">
                  Votre mot de passe est chiffré avant d'être enregistré. Il ne
                  s'affiche plus jamais, ici ou ailleurs.
                </div>
              </div>

              {/* On ne demande PLUS le sélecteur ni la valeur DKIM.
                  Un couvreur de cinq salariés n'a pas de console de service
                  d'envoi : la demande était irréalisable pour l'utilisateur
                  visé, sur le dernier écran d'une fonction dont dépend
                  l'arrivée de ses devis.

                  Tant que l'enrôlement automatique n'est pas branché, la seule
                  question posée est le nom de domaine, et l'écran dit
                  honnêtement comment la suite arrive. */}
              {/* L'enrôlement est désormais BRANCHÉ : l'écran propose le geste
                  au lieu de promettre qu'un humain le fera. Quand il n'est pas
                  configuré sur ce déploiement, la route rend 503 et l'écran le
                  dit — sans laisser croire que quelque chose est en cours. */}
              <div className="rounded-lg border border-card-border bg-muted/40 p-3 text-xs text-muted-foreground">
                {data?.parametres?.dkimSelecteur
                  ? "Votre domaine est enrôlé. Publiez les trois enregistrements ci-dessous chez votre hébergeur, puis lancez la vérification."
                  : "Nous préparons l'authentification de votre domaine et vous rendons les trois lignes à recopier chez votre hébergeur. Vous n'avez rien à chercher de votre côté."}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => enroler.mutate()}
                  disabled={enroler.isPending || !form.domaine}
                  data-testid="bouton-enroler"
                >
                  {enroler.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {data?.parametres?.dkimSelecteur ? "Ré-enrôler le domaine" : "Préparer mon domaine"}
                </Button>
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
                  variant="outline"
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
          )}
        </>
      )}
    </div>
  );
}
