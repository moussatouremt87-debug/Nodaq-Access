import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X } from 'lucide-react';
import { habilitationsSuggereesParVertical } from '@nodaq/shared';
import type { Affaire } from '@workspace/api-client-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AFFAIRE_STATUS_OPTIONS } from '@/components/status-badge';
import { useCreateAffaireMutation, useUpdateAffaireMutation } from '@/hooks/use-affaires';
import { useVertical } from '@/hooks/use-vertical';

const schema = z.object({
  label: z.string().min(1, 'Le libellé est requis'),
  clientName: z.string().optional(),
  status: z.string().optional(),
  quotedAmountCents: z.coerce.number().optional(),
  invoicedAmountCents: z.coerce.number().optional(),
  marginCents: z.coerce.number().optional(),
  montantVenduHt: z.coerce.number().optional(),
  avancementPct: z.coerce.number().min(0).max(100).optional(),
  notes: z.string().optional(),
  startDate: z.string().optional(),
  dateFinPrevue: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function AffaireDialog({
  open,
  onOpenChange,
  affaire,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  affaire?: Affaire | null;
}) {
  const isEdit = !!affaire;
  const { vertical, words } = useVertical();
  const { createAffaire, isPending: creating } = useCreateAffaireMutation();
  const { updateAffaire, isPending: updating } = useUpdateAffaireMutation();

  // US-A4.4 — géré hors du formulaire react-hook-form : une liste de chaînes
  // avec ajout/suppression n'a pas besoin de useFieldArray pour ça, même
  // choix que côté membre (equipe.tsx). `type` sert de clé de correspondance
  // avec les habilitations détenues par un salarié — un libellé libre EST sa
  // propre clé (deux saisies identiques se correspondent), une suggestion
  // porte une clé stable.
  const [habilitationsRequises, setHabilitationsRequises] = useState<string[]>([]);
  const [novType, setNovType] = useState('__libre__');
  const [novLibre, setNovLibre] = useState('');
  const suggestions = habilitationsSuggereesParVertical(vertical);

  const libelleHabilitation = (type: string) => suggestions.find((s) => s.type === type)?.libelle ?? type;

  const ajouterHabilitation = () => {
    const valeur = novType !== '__libre__' ? novType : novLibre.trim();
    if (!valeur || habilitationsRequises.includes(valeur)) return;
    setHabilitationsRequises((hs) => [...hs, valeur]);
    setNovType('__libre__');
    setNovLibre('');
  };

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: '',
      clientName: '',
      status: 'PROSPECT',
      quotedAmountCents: undefined,
      invoicedAmountCents: undefined,
      marginCents: undefined,
      montantVenduHt: undefined,
      avancementPct: undefined,
      notes: '',
      startDate: '',
      dateFinPrevue: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        label: affaire?.label ?? '',
        clientName: affaire?.clientName ?? '',
        status: affaire?.status ?? 'PROSPECT',
        quotedAmountCents: affaire?.quotedAmountCents != null ? affaire.quotedAmountCents / 100 : undefined,
        invoicedAmountCents: affaire?.invoicedAmountCents != null ? affaire.invoicedAmountCents / 100 : undefined,
        marginCents: affaire?.marginCents != null ? affaire.marginCents / 100 : undefined,
        montantVenduHt: affaire?.montantVenduHt != null ? affaire.montantVenduHt / 100 : undefined,
        avancementPct: affaire?.avancementPct ?? undefined,
        notes: affaire?.notes ?? '',
        startDate: affaire?.startDate ? affaire.startDate.slice(0, 10) : '',
        dateFinPrevue: affaire?.dateFinPrevue ? affaire.dateFinPrevue.slice(0, 10) : '',
      });
      setHabilitationsRequises(affaire?.habilitationsRequises ?? []);
      setNovType('__libre__');
      setNovLibre('');
    }
  }, [open, affaire, form]);

  const onSubmit = (values: FormValues) => {
    const payload = {
      label: values.label,
      clientName: values.clientName || undefined,
      status: values.status || undefined,
      quotedAmountCents:
        values.quotedAmountCents != null && !Number.isNaN(values.quotedAmountCents)
          ? Math.round(values.quotedAmountCents * 100)
          : undefined,
      notes: values.notes || undefined,
      startDate: values.startDate || undefined,
      habilitationsRequises,
    };

    if (isEdit && affaire) {
      updateAffaire(
        affaire.id,
        {
          ...payload,
          invoicedAmountCents:
            values.invoicedAmountCents != null && !Number.isNaN(values.invoicedAmountCents)
              ? Math.round(values.invoicedAmountCents * 100)
              : undefined,
          marginCents:
            values.marginCents != null && !Number.isNaN(values.marginCents)
              ? Math.round(values.marginCents * 100)
              : undefined,
          montantVenduHt:
            values.montantVenduHt != null && !Number.isNaN(values.montantVenduHt)
              ? Math.round(values.montantVenduHt * 100)
              : undefined,
          avancementPct:
            values.avancementPct != null && !Number.isNaN(values.avancementPct)
              ? values.avancementPct
              : undefined,
          dateFinPrevue: values.dateFinPrevue || undefined,
        },
        () => onOpenChange(false),
      );
    } else {
      createAffaire(payload, () => onOpenChange(false));
    }
  };

  const pending = creating || updating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Modifier ${words.definite}` : words.newLabel}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Mettez à jour ${words.definite}.`
              : `Renseignez les informations pour créer ${words.indefinite}.`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Libellé</FormLabel>
                  <FormControl>
                    <Input placeholder="Refonte site vitrine" data-testid="input-affaire-label" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="clientName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client</FormLabel>
                    <FormControl>
                      <Input placeholder="Atelier Lumière SAS" data-testid="input-affaire-client" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Statut</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-affaire-status">
                          <SelectValue placeholder="Statut" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {AFFAIRE_STATUS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="quotedAmountCents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Montant devisé (€)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="4200"
                        data-testid="input-affaire-quoted"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date de début des travaux</FormLabel>
                    <FormControl>
                      <Input type="date" data-testid="input-affaire-start" {...field} />
                    </FormControl>
                    {/* « Date de début doit correspondre à quoi ? (date de début
                        du chantier ? date de saisie du chantier ?) » — la
                        question a été posée telle quelle au test. La date de
                        SAISIE est une métadonnée système, elle ne se demande
                        jamais. */}
                    <p className="text-xs text-muted-foreground">
                      Laissez vide si la date n'est pas encore fixée.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {isEdit && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="invoicedAmountCents"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Montant facturé (€)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          data-testid="input-affaire-invoiced"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="marginCents"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Marge (€)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          data-testid="input-affaire-margin"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
            {isEdit && (
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="montantVenduHt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Montant vendu (€)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          data-testid="input-affaire-vendu"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="avancementPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Avancement (%)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          data-testid="input-affaire-avancement"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dateFinPrevue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fin prévue</FormLabel>
                      <FormControl>
                        <Input type="date" data-testid="input-affaire-fin-prevue" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Habilitations requises (facultatif)</Label>
              {habilitationsRequises.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {habilitationsRequises.map((type) => (
                    <Badge key={type} variant="secondary" className="gap-1 pr-1" data-testid="badge-habilitation-requise">
                      {libelleHabilitation(type)}
                      <button
                        type="button"
                        onClick={() => setHabilitationsRequises((hs) => hs.filter((t) => t !== type))}
                        className="rounded-full hover:bg-muted-foreground/20"
                        aria-label={`Retirer ${libelleHabilitation(type)}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Select value={novType} onValueChange={setNovType}>
                  <SelectTrigger className="flex-1" data-testid="select-habilitation-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__libre__">Autre (préciser)</SelectItem>
                    {suggestions.map((s) => (
                      <SelectItem key={s.type} value={s.type}>{s.libelle}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {novType === '__libre__' && (
                  <Input
                    value={novLibre}
                    onChange={(e) => setNovLibre(e.target.value)}
                    placeholder="ex. Carte professionnelle"
                    className="flex-1"
                    data-testid="input-habilitation-libre"
                  />
                )}
                <Button type="button" variant="outline" onClick={ajouterHabilitation} data-testid="button-ajouter-habilitation">
                  Ajouter
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Un salarié affecté sans cette habilitation reçoit un avertissement — jamais un blocage.
              </p>
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Contexte, contraintes, échéances..." data-testid="input-affaire-notes" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending} data-testid="button-submit-affaire">
                {isEdit ? 'Enregistrer' : `Créer ${words.indefinite}`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
