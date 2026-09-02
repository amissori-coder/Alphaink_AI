/**
 * Callable dei contatti.
 *
 * `upsertContact` è l'unico punto di scrittura manuale dell'anagrafica: la
 * deduplica per email vale anche qui, così una modifica dalla UI non può
 * generare un doppione di un contatto arrivato dal sito.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { contactInputSchema, emailSchema, normalizeEmail, displayNameFor } from '@alphaink/shared';
import type { Contact, SiteSource } from '@alphaink/shared';
import { requirePermission } from '../lib/auth';
import { BREVO_API_KEY, LIGHT_RUNTIME } from '../lib/config';
import { AppError, invalidArgument, notFound, toHttpsError } from '../lib/errors';
import { auditUpdate, col, logActivity, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { blocklistBrevoContact, deleteBrevoContact } from '../brevo';
import { readApiKeyFromSecret, readBrevoSettings } from '../brevo/settings';
import {
  buildContactPatch,
  deleteContactRecord,
  getContactByEmail,
  getContactById,
  setSubscriptionStatus,
  upsertContact as upsertContactRecord,
} from './repository';

export { importContacts } from './import';
export { exportContacts } from './export';

const log = createLogger('contacts.callables');

const CALLABLE_OPTIONS = { ...LIGHT_RUNTIME, secrets: [BREVO_API_KEY] };

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    throw invalidArgument('Dati non validi.', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data as z.infer<S>;
}

async function guard<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    log.error(`Callable ${operation} fallita`, error);
    throw toHttpsError(error);
  }
}

// -----------------------------------------------------------------------------
// upsertContact
// -----------------------------------------------------------------------------

const upsertSchema = contactInputSchema.extend({
  /** Aggiornamento di un contatto già noto (consente anche il cambio email). */
  contactId: z.string().min(1).optional(),
  source: z
    .enum(['prestashop_b2c', 'prestashop_b2b', 'csv', 'manual', 'brevo'])
    .default('manual'),
  /** Riattiva un contatto disiscritto: solo su consenso esplicito documentato. */
  allowResubscribe: z.boolean().default(false),
  consentSource: z.string().max(200).nullable().optional(),
});

export interface UpsertContactResult {
  contact: Contact;
  created: boolean;
}

export const upsertContact = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<UpsertContactResult> =>
    guard('upsertContact', async () => {
      const caller = requirePermission(request, 'contacts:write');
      const input = parseInput(upsertSchema, request.data);
      const source = input.source as SiteSource;
      const email = normalizeEmail(input.email);

      if (input.contactId) {
        const existing = await getContactById(input.contactId);
        if (!existing) throw notFound('Contatto', input.contactId);

        // Cambio email: va verificato che non collida con un altro contatto.
        const emailChanged = existing.emailNormalized !== email;
        if (emailChanged) {
          const clash = await getContactByEmail(email);
          if (clash && clash.id !== existing.id) {
            throw new AppError(
              'already_exists',
              `L'indirizzo ${email} appartiene già a un altro contatto.`,
              { details: { contactId: clash.id } },
            );
          }
        }

        const patch = buildContactPatch(existing, { ...input, email }, source, caller.uid, {
          allowResubscribe: input.allowResubscribe,
        });
        if (emailChanged) {
          patch.email = email;
          patch.emailNormalized = email;
          patch.displayName = displayNameFor({
            firstName: input.firstName ?? existing.firstName,
            lastName: input.lastName ?? existing.lastName,
            company: input.company ?? existing.company,
            email,
          });
          Object.assign(patch, auditUpdate(caller.uid));
        }

        if (Object.keys(patch).length > 0) {
          await col.contacts().doc(existing.id).update(patch);
        }

        const contact = withId<Contact>(await col.contacts().doc(existing.id).get());
        await logActivity({
          action: 'contact.update',
          entityType: 'contact',
          entityId: contact.id,
          userId: caller.uid,
          summary: `Aggiornato il contatto ${contact.email}`,
        });
        return { contact, created: false };
      }

      const result = await upsertContactRecord({ ...input, email }, source, caller.uid, {
        allowResubscribe: input.allowResubscribe,
      });

      await logActivity({
        action: result.created ? 'contact.create' : 'contact.update',
        entityType: 'contact',
        entityId: result.id,
        userId: caller.uid,
        summary: `${result.created ? 'Creato' : 'Aggiornato'} il contatto ${email}`,
      });

      return { contact: result.contact, created: result.created };
    }),
);

// -----------------------------------------------------------------------------
// deleteContact
// -----------------------------------------------------------------------------

const deleteSchema = z.object({
  contactId: z.string().min(1),
  /** Elimina il contatto anche da Brevo (irreversibile). */
  deleteOnBrevo: z.boolean().default(false),
});

export interface DeleteContactResult {
  contactId: string;
  email: string;
  deletedOnBrevo: boolean;
}

export const deleteContact = onCall(
  CALLABLE_OPTIONS,
  async (request: CallableRequest<unknown>): Promise<DeleteContactResult> =>
    guard('deleteContact', async () => {
      const caller = requirePermission(request, 'contacts:write');
      const { contactId, deleteOnBrevo } = parseInput(deleteSchema, request.data);

      const contact = await deleteContactRecord(contactId);
      if (!contact) throw notFound('Contatto', contactId);

      let deletedOnBrevo = false;
      if (deleteOnBrevo) {
        const apiKey = readApiKeyFromSecret();
        if (apiKey) {
          try {
            await deleteBrevoContact(apiKey, contact.email);
            deletedOnBrevo = true;
          } catch (error) {
            // L'eliminazione locale è già avvenuta: si segnala e si prosegue.
            log.error('Eliminazione del contatto su Brevo fallita', error, { contactId });
          }
        }
      }

      await logActivity({
        action: 'contact.delete',
        entityType: 'contact',
        entityId: contactId,
        userId: caller.uid,
        summary: `Eliminato il contatto ${contact.email}`,
        metadata: { deletedOnBrevo },
        severity: 'warning',
      });

      return { contactId, email: contact.email, deletedOnBrevo };
    }),
);

// -----------------------------------------------------------------------------
// unsubscribeContact
// -----------------------------------------------------------------------------

const unsubscribeSchema = z
  .object({
    contactId: z.string().min(1).optional(),
    email: emailSchema.optional(),
    reason: z.string().max(300).nullable().optional(),
    /** `blocked` per le segnalazioni di spam, `unsubscribed` per l'opt-out normale. */
    status: z.enum(['unsubscribed', 'blocked']).default('unsubscribed'),
  })
  .refine((value) => Boolean(value.contactId || value.email), {
    message: 'Indica il contatto o l\'indirizzo email da disiscrivere.',
  });

export interface UnsubscribeContactResult {
  contactId: string | null;
  email: string;
  status: 'unsubscribed' | 'blocked';
  blocklistedOnBrevo: boolean;
}

export const unsubscribeContact = onCall(
  CALLABLE_OPTIONS,
  async (request: CallableRequest<unknown>): Promise<UnsubscribeContactResult> =>
    guard('unsubscribeContact', async () => {
      const caller = requirePermission(request, 'contacts:write');
      const input = parseInput(unsubscribeSchema, request.data);

      let email = input.email ? normalizeEmail(input.email) : '';
      if (input.contactId) {
        const contact = await getContactById(input.contactId);
        if (!contact) throw notFound('Contatto', input.contactId);
        email = contact.emailNormalized || normalizeEmail(contact.email);
      }

      const updated = await setSubscriptionStatus(email, input.status, input.reason ?? 'Richiesta manuale');

      let blocklistedOnBrevo = false;
      const settings = await readBrevoSettings();
      const apiKey = readApiKeyFromSecret();
      if (settings.syncContacts && apiKey) {
        try {
          await blocklistBrevoContact(apiKey, email, true);
          blocklistedOnBrevo = true;
        } catch (error) {
          log.error('Blocklist Brevo non riuscita', error, { email });
        }
      }

      await logActivity({
        action: 'contact.unsubscribe',
        entityType: 'contact',
        entityId: updated?.id ?? null,
        userId: caller.uid,
        summary: `Disiscritto ${email}`,
        metadata: { reason: input.reason ?? null, status: input.status, blocklistedOnBrevo },
        severity: 'warning',
      });

      return {
        contactId: updated?.id ?? null,
        email,
        status: input.status,
        blocklistedOnBrevo,
      };
    }),
);
