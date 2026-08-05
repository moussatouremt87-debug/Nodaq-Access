import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { AFFAIRE_STATUS_OPTIONS } from '@/components/status-badge';
import { useCreateAffaireMutation, useUpdateAffaireMutation } from '@/hooks/use-affaires';

const schema = z.object({
  label: z.string().min(1, 'Le libellé est requis'),
  clientName: z.string().optional(),
  status: z.string().optional(),
  quotedAmountCents: z.coerce.number().optional(),
  invoicedAmountCents: z.coerce.number().optional(),
  marginCents: z.coerce.number().optional(),
  notes: z.string().optional(),
  startDate: z.string().optional(),
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
  const { createAffaire, isPending: creating } = useCreateAffaireMutation();
  const { updateAffaire, isPending: updating } = useUpdateAffaireMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: '',
      clientName: '',
      status: 'PROSPECT',
      quotedAmountCents: undefined,
      invoicedAmountCents: undefined,
      marginCents: undefined,
      notes: '',
      startDate: '',
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
        notes: affaire?.notes ?? '',
        startDate: affaire?.startDate ? affaire.startDate.slice(0, 10) : '',
      });
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
          <DialogTitle>{isEdit ? "Modifier l'affaire" : 'Nouvelle affaire'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Mettez à jour les informations de cette affaire.'
              : 'Renseignez les informations de la nouvelle affaire.'}
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
                    <FormLabel>Date de début</FormLabel>
                    <FormControl>
                      <Input type="date" data-testid="input-affaire-start" {...field} />
                    </FormControl>
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
                {isEdit ? 'Enregistrer' : "Créer l'affaire"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
