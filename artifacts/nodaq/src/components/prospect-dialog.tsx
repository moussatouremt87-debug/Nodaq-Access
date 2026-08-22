import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Prospect } from '@workspace/api-client-react';
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
import { PROSPECT_STAGE_OPTIONS, PROSPECT_SOURCE_OPTIONS } from '@/components/status-badge';
import { useCreateProspectMutation, useUpdateProspectMutation } from '@/hooks/use-prospects';

const schema = z.object({
  name: z.string().min(1, 'Le nom est requis'),
  companyName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Email invalide').optional().or(z.literal('')),
  stage: z.string().optional(),
  source: z.string().optional(),
  estimatedValueCents: z.coerce.number().min(0, 'La valeur ne peut pas être négative').optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function ProspectDialog({
  open,
  onOpenChange,
  prospect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prospect?: Prospect | null;
}) {
  const isEdit = !!prospect;
  const { createProspect, isPending: creating } = useCreateProspectMutation();
  const { updateProspect, isPending: updating } = useUpdateProspectMutation();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      companyName: '',
      phone: '',
      email: '',
      stage: 'NOUVEAU',
      source: 'AUTRE',
      estimatedValueCents: undefined,
      notes: '',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: prospect?.name ?? '',
        companyName: prospect?.companyName ?? '',
        phone: prospect?.phone ?? '',
        email: prospect?.email ?? '',
        stage: prospect?.stage ?? 'NOUVEAU',
        source: prospect?.source ?? 'AUTRE',
        estimatedValueCents:
          prospect?.estimatedValueCents != null ? prospect.estimatedValueCents / 100 : undefined,
        notes: prospect?.notes ?? '',
      });
    }
  }, [open, prospect, form]);

  const onSubmit = (values: FormValues) => {
    const payload = {
      name: values.name,
      companyName: values.companyName || undefined,
      phone: values.phone || undefined,
      email: values.email || undefined,
      stage: values.stage,
      source: values.source,
      estimatedValueCents:
        values.estimatedValueCents != null && !Number.isNaN(values.estimatedValueCents)
          ? Math.round(values.estimatedValueCents * 100)
          : undefined,
      notes: values.notes || undefined,
    };

    if (isEdit && prospect) {
      updateProspect(prospect.id, payload, () => onOpenChange(false));
    } else {
      createProspect(payload, () => onOpenChange(false));
    }
  };

  const pending = creating || updating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier le prospect' : 'Nouveau prospect'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Mettez à jour ce contact.' : 'Ajoutez un nouveau contact commercial.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom</FormLabel>
                    <FormControl>
                      <Input placeholder="Claire Dumont" data-testid="input-prospect-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Société (si professionnel)</FormLabel>
                    <FormControl>
                      <Input placeholder="Dumont Architecture" data-testid="input-prospect-company" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Téléphone</FormLabel>
                    <FormControl>
                      <Input placeholder="06 12 34 56 78" data-testid="input-prospect-phone" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="claire@dumont-arch.fr" data-testid="input-prospect-email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="stage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Étape</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-prospect-stage">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROSPECT_STAGE_OPTIONS.map((opt) => (
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
              <FormField
                control={form.control}
                name="source"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-prospect-source">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROSPECT_SOURCE_OPTIONS.map((opt) => (
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
            <FormField
              control={form.control}
              name="estimatedValueCents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valeur estimée (€)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      placeholder="3200"
                      data-testid="input-prospect-value"
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
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={3} data-testid="input-prospect-notes" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending} data-testid="button-submit-prospect">
                {isEdit ? 'Enregistrer' : 'Ajouter le prospect'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
