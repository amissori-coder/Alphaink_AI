'use client';

import { COLLECTIONS, type BrevoSettings } from '@alphaink/shared';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useDocumentQuery } from '@/lib/hooks/use-document';

/**
 * Avviso mostrato finché Brevo non è configurato: senza chiave API o
 * mittente verificato nessun invio può partire.
 */
export function BrevoNotice({ className }: { className?: string }) {
  const { can } = useAuth();
  const { data, loading } = useDocumentQuery<BrevoSettings>(COLLECTIONS.settings, 'brevo', {
    enabled: can('settings:read'),
  });

  if (loading || !can('settings:read')) return null;

  const missingKey = !data?.apiKeyConfigured;
  const missingSender = Boolean(data?.apiKeyConfigured) && !data?.defaultSenderEmail;
  if (!missingKey && !missingSender) return null;

  return (
    <Alert variant="warning" className={className}>
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>
        {missingKey ? 'Brevo non è ancora configurato' : 'Manca il mittente predefinito'}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {missingKey
            ? 'Aggiungi la chiave API di Brevo per abilitare invii, webhook e statistiche in tempo reale.'
            : 'Scegli un mittente verificato su Brevo: senza mittente le newsletter non possono partire.'}
        </span>
        {can('settings:write') ? (
          <Button size="sm" variant="outline" asChild className="shrink-0">
            <Link href="/impostazioni">
              Vai alle impostazioni
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
