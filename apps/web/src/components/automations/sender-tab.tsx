'use client';

import { isValidEmail } from '@alphaink/shared';
import { AtSign, Info, Reply, User } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import type { AutomationPayload } from './types';

export interface SenderTabProps {
  draft: AutomationPayload;
  disabled?: boolean;
  onChange: (patch: Partial<AutomationPayload>) => void;
  className?: string;
}

/** Scheda "Mittente": identità con cui partono le email dell'automazione. */
export function SenderTab({ draft, disabled = false, onChange, className }: SenderTabProps) {
  const fieldId = React.useId();

  const fromEmailValid = isValidEmail(draft.fromEmail);
  const replyToValid = !draft.replyTo || isValidEmail(draft.replyTo);

  return (
    <div className={cn('space-y-4', className)}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-4 text-primary" aria-hidden="true" />
            Identità del mittente
          </CardTitle>
          <CardDescription>
            Compare nella casella di posta del cliente. Il dominio dell’indirizzo deve essere
            verificato su Brevo, altrimenti l’invio viene rifiutato.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-from-name`} required>
              Nome mittente
            </Label>
            <Input
              id={`${fieldId}-from-name`}
              value={draft.fromName}
              disabled={disabled}
              maxLength={80}
              placeholder="AlphaInk"
              startIcon={<User />}
              invalid={draft.fromName.trim().length === 0}
              onChange={(event) => onChange({ fromName: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-from-email`} required>
              Email mittente
            </Label>
            <Input
              id={`${fieldId}-from-email`}
              type="email"
              value={draft.fromEmail}
              disabled={disabled}
              placeholder="newsletter@alphaink.net"
              startIcon={<AtSign />}
              invalid={!fromEmailValid}
              aria-describedby={fromEmailValid ? undefined : `${fieldId}-from-email-error`}
              onChange={(event) => onChange({ fromEmail: event.target.value.trim() })}
            />
            {!fromEmailValid ? (
              <p id={`${fieldId}-from-email-error`} className="text-xs text-destructive">
                Indirizzo non valido.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${fieldId}-reply-to`}>Indirizzo per le risposte</Label>
            <Input
              id={`${fieldId}-reply-to`}
              type="email"
              value={draft.replyTo ?? ''}
              disabled={disabled}
              placeholder="info@alphaink.net"
              startIcon={<Reply />}
              invalid={!replyToValid}
              onChange={(event) => onChange({ replyTo: event.target.value.trim() || null })}
            />
            <p className="text-xs text-muted-foreground">
              Se vuoto le risposte arrivano all’indirizzo mittente.
            </p>
            {!replyToValid ? (
              <p className="text-xs text-destructive">Indirizzo non valido.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertTitle>Mittente predefinito</AlertTitle>
        <AlertDescription>
          Lasciando i campi allineati al mittente configurato in Impostazioni → Brevo si evita di
          dover verificare più indirizzi presso il provider.
        </AlertDescription>
      </Alert>
    </div>
  );
}
