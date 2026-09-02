'use client';

import type { Newsletter } from '@alphaink/shared';
import { Mail } from 'lucide-react';
import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreateNewsletterForm } from './create-newsletter-form';

export interface NewNewsletterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Invocata dopo la creazione: il dialogo si chiude e si apre l'editor. */
  onCreated?: (newsletter: Newsletter) => void;
}

/**
 * Dialogo "Nuova newsletter": raccoglie i dati minimi e fa scegliere se partire
 * da zero o da uno dei template disponibili.
 */
export function NewNewsletterDialog({ open, onOpenChange, onCreated }: NewNewsletterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-4 text-primary" aria-hidden="true" />
            Nuova newsletter
          </DialogTitle>
          <DialogDescription>
            Viene creata una bozza: il pubblico e la data di invio si impostano dopo, dalla scheda
            della newsletter.
          </DialogDescription>
        </DialogHeader>

        <CreateNewsletterForm
          compact
          onCancel={() => onOpenChange(false)}
          onCreated={(newsletter) => {
            onOpenChange(false);
            onCreated?.(newsletter);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
