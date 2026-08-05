import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Contrat } from '@workspace/api-client-react';
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
import { CONTRAT_CADENCE_OPTIONS, CONTRAT_STATUS_OPTIONS } from '@/components/status-badge';
import { useCreateContratMutation, useUpdateContratMutation } from '@/hooks/use-contrats';

const schema = z.object({
  label: z.string().min(1, 'Le libellé est requis'),
  clientName: z.string().optional(),
  cadence: z.string().min(1),
  amountCents: z.coerce.number().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ContratDialog({
  open,
  onOpenChange,
  contrat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contrat?: Contrat | null;
}) {
  const isEdit = !!contrat;
  const { createContrat, isPending: creating } = useCreateContratMutation();
  const { updateContrat, isPending: updating } = useUpdateContratMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: '',
      clientName: '',
      cadence: 'mensuel',
      amountCents: undefined,
      status: 'ACTIF',
      startDate: '',
      endDate: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        label: contrat?.label ?? '',
        clientName: contrat?.clientName ?? '',
        cadence: contrat?.cadence ?? 'mensuel',
        amountCents: contrat?.amountCents != null ? contrat.amountCents / 100 : undefined,
        status: contrat?.status ?? 'ACTIF',
        startDate: contrat?.startDate ? contrat.startDate.slice(0, 10) : '',
        endDate: contrat?.endDate ? contrat.endDate.slice(0, 10) : '',
        notes: contrat?.notes ?? '',
      });
    }
  }, [open, contrat, form]);

  const onSubmit = (values: FormValues) => {
    const payload = {
      label: values.label,
      clientName: values.clientName || undefined,
      cadence: values.cadence as any,
      amountCents:
        values.amountCents != null && !Number.isNaN(values.amountCents)
          ? Math.round(values.amountCents * 100)
          : undefined,
      startDate: values.startDate || undefined,
      endDate: values.endDate || undefined,
      notes: values.notes || undefined,
    };

    if (isEdit && contrat) {
      updateContrat(contrat.id, { ...payload, status: values.status }, () => onOpenChange(false));
    } else {
      createContrat(payload, () => onOpenChange(false));
    }
  };

  const pending = creating || updating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier le contrat' : 'Nouveau contrat récurrent'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Mettez à jour ce contrat récurrent.'
              : 'Renseignez les informations du nouveau contrat.'}
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
                    <Input placeholder="Maintenance infogérée" data-testid="input-contrat-label" {...field} />
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
                      <Input placeholder="Boulangerie Ferrand" data-testid="input-contrat-client" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cadence"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cadence</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-contrat-cadence">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CONTRAT_CADENCE_OPTIONS.map((opt) => (
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
                name="amountCents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Montant (€)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="450"
                        data-testid="input-contrat-amount"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isEdit && (
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Statut</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-contrat-status">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CONTRAT_STATUS_OPTIONS.map((opt) => (
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
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date de début</FormLabel>
                    <FormControl>
                      <Input type="date" data-testid="input-contrat-start" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date de fin</FormLabel>
                    <FormControl>
                      <Input type="date" data-testid="input-contrat-end" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={3} data-testid="input-contrat-notes" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending} data-testid="button-submit-contrat">
                {isEdit ? 'Enregistrer' : 'Créer le contrat'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
