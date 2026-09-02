'use client';

import { COLLECTIONS, blockId, emptyDocument } from '@alphaink/shared';
import type {
  BrandingSettings,
  BrevoSettings,
  EmailDocument,
  Newsletter,
  NewsletterCategory,
  NewsletterTemplate,
} from '@alphaink/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { useDocumentQuery } from '@/lib/hooks/use-document';
import { toast, toastError } from '@/lib/toast';

import { createNewsletter } from './api';
import {
  FALLBACK_SENDER_EMAIL,
  FALLBACK_SENDER_NAME,
  NEWSLETTER_QUERY_ROOT,
  ROUTES,
} from './constants';

export interface DefaultSender {
  name: string;
  email: string;
  replyTo: string | null;
  /** False quando le impostazioni Brevo non contengono ancora un mittente. */
  configured: boolean;
}

/** Mittente predefinito ricavato dalle impostazioni Brevo e dal brand. */
export function useDefaultSender(enabled = true): DefaultSender {
  const brevo = useDocumentQuery<BrevoSettings>(COLLECTIONS.settings, 'brevo', { enabled });
  const branding = useDocumentQuery<BrandingSettings>(COLLECTIONS.settings, 'branding', { enabled });

  return React.useMemo(() => {
    const settings = brevo.data;
    const preferred = settings?.senders?.find(
      (candidate) => candidate.email === settings.defaultSenderEmail,
    );
    const fallback = settings?.senders?.find((candidate) => candidate.active) ?? settings?.senders?.[0];
    const chosen = preferred ?? fallback ?? null;

    return {
      name: chosen?.name || branding.data?.companyName || FALLBACK_SENDER_NAME,
      email:
        chosen?.email ||
        settings?.defaultSenderEmail ||
        branding.data?.supportEmail ||
        FALLBACK_SENDER_EMAIL,
      replyTo: settings?.defaultReplyTo ?? null,
      configured: Boolean(chosen?.email || settings?.defaultSenderEmail),
    };
  }, [brevo.data, branding.data]);
}

export interface CreateDraftInput {
  name: string;
  subject: string;
  category: NewsletterCategory | null;
  /** Template di partenza; assente per una newsletter vuota. */
  template?: NewsletterTemplate | null;
}

export interface UseCreateNewsletterResult {
  create: (input: CreateDraftInput) => Promise<Newsletter | null>;
  /** Crea la bozza e apre subito l'editor. */
  createAndOpen: (input: CreateDraftInput) => Promise<Newsletter | null>;
  sender: DefaultSender;
  pending: boolean;
}

/**
 * Creazione di una bozza, condivisa fra il dialogo rapido e la pagina "Nuova".
 * Il documento di partenza è quello del template scelto, oppure una sezione vuota.
 */
export function useCreateNewsletter(enabled = true): UseCreateNewsletterResult {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sender = useDefaultSender(enabled);
  const mutation = useMutation({ mutationFn: createNewsletter });

  const create = React.useCallback(
    async ({ name, subject, category, template }: CreateDraftInput): Promise<Newsletter | null> => {
      const document: EmailDocument =
        template?.document ?? emptyDocument(blockId('section'), blockId('column'));

      // I template di sistema hanno categoria "sistema": non è una categoria
      // editoriale valida per una newsletter, quindi non viene ereditata.
      const inheritedCategory =
        template && template.category !== 'sistema'
          ? (template.category as NewsletterCategory)
          : null;

      try {
        const result = await mutation.mutateAsync({
          name: name.trim(),
          subject: subject.trim(),
          preheader: null,
          fromName: sender.name,
          fromEmail: sender.email,
          replyTo: sender.replyTo,
          document,
          audience: {
            clusterIds: [],
            excludeClusterIds: [],
            includeContactIds: [],
            excludeContactIds: [],
            suppressIfContactedWithinDays: null,
            suppressIfPurchasedWithinDays: null,
          },
          schedule: null,
          tags: template?.tags ?? [],
          color: null,
          category: category ?? inheritedCategory,
          templateId: template?.id ?? null,
        });

        toast.success('Bozza creata.', {
          description: template
            ? `Contenuto iniziale dal template “${template.name}”.`
            : 'Aggiungi i blocchi nell’editor per comporre l’email.',
        });
        void queryClient.invalidateQueries({ queryKey: [...NEWSLETTER_QUERY_ROOT] });
        void queryClient.invalidateQueries({ queryKey: ['calendario'] });
        return result.newsletter;
      } catch (error) {
        toastError(error, 'Impossibile creare la newsletter.');
        return null;
      }
    },
    [mutation, queryClient, sender.email, sender.name, sender.replyTo],
  );

  const createAndOpen = React.useCallback(
    async (input: CreateDraftInput): Promise<Newsletter | null> => {
      const created = await create(input);
      if (created) router.push(ROUTES.editor(created.id));
      return created;
    },
    [create, router],
  );

  return { create, createAndOpen, sender, pending: mutation.isPending };
}
