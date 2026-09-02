'use client';

import { isValidEmail, normalizeEmail } from '@alphaink/shared';
import { FlaskConical, Plus, Send, TriangleAlert, X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toastWarning } from '@/lib/toast';
import { cn } from '@/lib/utils';

import { MAX_TEST_RECIPIENTS } from './constants';
import type { AutomationPayload } from './types';
import { useSendAutomationTest } from './use-automation-actions';

export interface TestModeCardProps {
  automationId: string;
  draft: AutomationPayload;
  /** Vero quando ci sono modifiche non salvate: il test usa la versione salvata. */
  dirty?: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<AutomationPayload>) => void;
  className?: string;
}

/**
 * Modalità test e invio di prova.
 *
 * Con la modalità test attiva il motore continua ad arruolare i contatti ma
 * recapita le email solo agli indirizzi elencati qui: è il modo sicuro di
 * provare un flusso su un'automazione già collegata al negozio.
 */
export function TestModeCard({
  automationId,
  draft,
  dirty = false,
  disabled = false,
  onChange,
  className,
}: TestModeCardProps) {
  const fieldId = React.useId();
  const [pending, setPending] = React.useState('');
  const [stepId, setStepId] = React.useState<string>(draft.steps[0]?.id ?? '');
  const sendTest = useSendAutomationTest();

  const recipients = draft.testRecipients ?? [];
  const selectedStep = draft.steps.find((step) => step.id === stepId) ?? draft.steps[0] ?? null;

  React.useEffect(() => {
    if (draft.steps.some((step) => step.id === stepId)) return;
    setStepId(draft.steps[0]?.id ?? '');
  }, [draft.steps, stepId]);

  const addRecipient = () => {
    const email = normalizeEmail(pending);
    if (!email) return;
    if (!isValidEmail(email)) {
      toastWarning('Indirizzo non valido.', email);
      return;
    }
    if (recipients.includes(email)) {
      setPending('');
      return;
    }
    if (recipients.length >= MAX_TEST_RECIPIENTS) {
      toastWarning(`Massimo ${MAX_TEST_RECIPIENTS} indirizzi di prova.`);
      return;
    }
    onChange({ testRecipients: [...recipients, email] });
    setPending('');
  };

  const removeRecipient = (email: string) => {
    onChange({ testRecipients: recipients.filter((row) => row !== email) });
  };

  const canSend =
    !sendTest.isPending && recipients.length > 0 && Boolean(selectedStep) && Boolean(automationId);

  return (
    <Card className={cn('border-warning/40', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="size-4 text-warning-foreground" aria-hidden="true" />
          Modalità test e invio di prova
        </CardTitle>
        <CardDescription>
          Gli indirizzi elencati ricevono le email al posto dei clienti quando la modalità test è
          attiva.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <Switch
            id={`${fieldId}-test-mode`}
            checked={draft.testMode}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ testMode: checked })}
          />
          <div className="min-w-0">
            <Label htmlFor={`${fieldId}-test-mode`} className="text-sm">
              Modalità test attiva
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Nessuna email raggiunge i clienti: gli invii vengono dirottati sugli indirizzi di
              prova.
            </p>
          </div>
        </div>

        {draft.testMode && recipients.length === 0 ? (
          <p className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Con la modalità test attiva e nessun indirizzo elencato l’automazione non recapita
            nulla.
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-recipient`}>Indirizzi di prova</Label>
          <div className="flex gap-2">
            <Input
              id={`${fieldId}-recipient`}
              type="email"
              value={pending}
              disabled={disabled || recipients.length >= MAX_TEST_RECIPIENTS}
              placeholder="nome@alphaink.net"
              onChange={(event) => setPending(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  addRecipient();
                }
              }}
            />
            <Button
              variant="outline"
              onClick={addRecipient}
              disabled={disabled || !pending.trim() || recipients.length >= MAX_TEST_RECIPIENTS}
            >
              <Plus aria-hidden="true" />
              Aggiungi
            </Button>
          </div>

          {recipients.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {recipients.map((email) => (
                <li key={email}>
                  <Badge variant="secondary" className="gap-1 pr-1">
                    {email}
                    <button
                      type="button"
                      disabled={disabled}
                      className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      aria-label={`Rimuovi ${email}`}
                      onClick={() => removeRecipient(email)}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nessun indirizzo: aggiungine almeno uno per provare il flusso.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-step`}>Step da provare</Label>
            <Select
              value={selectedStep?.id ?? ''}
              disabled={draft.steps.length === 0}
              onValueChange={setStepId}
            >
              <SelectTrigger id={`${fieldId}-step`}>
                <SelectValue placeholder="Seleziona uno step" />
              </SelectTrigger>
              <SelectContent>
                {draft.steps.map((step, index) => (
                  <SelectItem key={step.id} value={step.id}>
                    {index + 1}. {step.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => {
              if (!selectedStep) return;
              sendTest.mutate({
                automationId,
                stepId: selectedStep.id,
                recipients,
              });
            }}
            disabled={!canSend}
            loading={sendTest.isPending}
          >
            <Send aria-hidden="true" />
            Invia test
          </Button>
        </div>

        {dirty ? (
          <p className="text-xs text-muted-foreground">
            L’invio di prova usa l’ultima versione salvata dello step: salva le modifiche per
            provarle.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
