/**
 * Propagazione dei contatti verso Brevo.
 *
 * Il trigger scatta ad ogni scrittura su `contacts/{contactId}`, ma la
 * sincronizzazione parte solo se sono cambiati i campi che Brevo conosce
 * davvero (anagrafica, stato, statistiche, engagement, attributi). Senza questo
 * "debounce" ogni ricalcolo dei cluster — che tocca `dynamicClusterIds` su
 * decine di migliaia di documenti — genererebbe altrettante chiamate all'API.
 *
 * Il trigger riscrive `brevoContactId`/`brevoSyncedAt` sullo stesso documento:
 * la firma di sincronizzazione ignora questi campi, quindi la seconda
 * esecuzione termina subito e non si innesca alcun ciclo.
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { normalizeEmail } from '@alphaink/shared';
import type { Contact, SubscriptionStatus } from '@alphaink/shared';
import { BREVO_API_KEY, LIGHT_RUNTIME } from '../lib/config';
import { col, nowIso, serializeDoc } from '../lib/firestore';
import { createLogger } from '../lib/logger';
import { blocklistBrevoContact, upsertBrevoContact } from '../brevo';
import { readApiKeyFromSecret, readBrevoSettings } from '../brevo/settings';

const log = createLogger('contacts.triggers');

/** Stati che su Brevo corrispondono alla blacklist email. */
const BLOCKED_STATUSES: SubscriptionStatus[] = ['unsubscribed', 'blocked', 'bounced'];

/**
 * Firma dei soli campi che finiscono su Brevo.
 * Due scritture con la stessa firma non richiedono alcuna chiamata all'API.
 */
export function brevoSyncSignature(contact: Contact | null): string | null {
  if (!contact) return null;
  return JSON.stringify({
    email: contact.emailNormalized || normalizeEmail(contact.email ?? ''),
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    phone: contact.phone ?? null,
    company: contact.company ?? null,
    segment: contact.segment ?? null,
    status: contact.status ?? null,
    stats: {
      ordersCount: contact.stats?.ordersCount ?? 0,
      totalSpent: contact.stats?.totalSpent ?? 0,
      averageOrderValue: contact.stats?.averageOrderValue ?? 0,
      firstOrderAt: contact.stats?.firstOrderAt ?? null,
      lastOrderAt: contact.stats?.lastOrderAt ?? null,
    },
    engagement: {
      engagementScore: contact.engagement?.engagementScore ?? 0,
      engagementTier: contact.engagement?.engagementTier ?? null,
      lastOpenedAt: contact.engagement?.lastOpenedAt ?? null,
      lastClickedAt: contact.engagement?.lastClickedAt ?? null,
    },
    printers: (contact.printers ?? []).map((printer) => `${printer.brand}|${printer.model}`),
    customAttributes: contact.customAttributes ?? {},
    listIds: [...(contact.brevoListIds ?? [])].sort((a, b) => a - b),
  });
}

export const onContactWritten = onDocumentWritten(
  {
    ...LIGHT_RUNTIME,
    document: 'contacts/{contactId}',
    secrets: [BREVO_API_KEY],
  },
  async (event) => {
    const contactId = event.params.contactId;
    const beforeSnapshot = event.data?.before;
    const afterSnapshot = event.data?.after;

    if (!afterSnapshot?.exists) {
      // Le eliminazioni sono gestite dalla callable `deleteContact`, che sa se
      // il contatto va rimosso anche da Brevo o soltanto da Firestore.
      log.debug('Contatto eliminato: nessuna propagazione', { contactId });
      return;
    }

    const after: Contact = { ...serializeDoc<Contact>(afterSnapshot.data() ?? {}), id: contactId };
    const before: Contact | null = beforeSnapshot?.exists
      ? { ...serializeDoc<Contact>(beforeSnapshot.data() ?? {}), id: contactId }
      : null;

    if (brevoSyncSignature(before) === brevoSyncSignature(after)) {
      log.debug('Nessun campo rilevante per Brevo è cambiato', { contactId });
      return;
    }

    const settings = await readBrevoSettings();
    if (!settings.syncContacts) {
      log.debug('Sincronizzazione contatti disattivata nelle impostazioni', { contactId });
      return;
    }

    const apiKey = readApiKeyFromSecret();
    if (!apiKey) {
      log.warn('Chiave API Brevo non configurata: sincronizzazione contatto saltata', { contactId });
      return;
    }

    const email = after.emailNormalized || normalizeEmail(after.email ?? '');
    if (!email) {
      log.warn('Contatto senza email: sincronizzazione saltata', { contactId });
      return;
    }

    try {
      if (BLOCKED_STATUSES.includes(after.status)) {
        await blocklistBrevoContact(apiKey, email, true);
        await afterSnapshot.ref.update({ brevoSyncedAt: nowIso() });
        log.info('Contatto messo in blacklist su Brevo', { contactId, status: after.status });
        return;
      }

      const listIds = Array.from(
        new Set([
          ...(after.brevoListIds ?? []),
          ...(settings.defaultListId ? [settings.defaultListId] : []),
        ]),
      );

      // La riattivazione avviene solo su un cambio di stato esplicito verso
      // `subscribed`: mai in automatico su una semplice risincronizzazione.
      const resubscribe =
        after.status === 'subscribed' && Boolean(before) && before?.status !== 'subscribed';
      if (resubscribe && before && (before.status === 'bounced' || before.status === 'blocked')) {
        log.warn('Riattivazione di un indirizzo precedentemente in errore', {
          contactId,
          previousStatus: before.status,
        });
      }

      const result = await upsertBrevoContact(apiKey, { ...after, email }, {
        listIds,
        attributeMapping: settings.attributeMapping,
        resubscribe,
      });

      const patch: Record<string, unknown> = { brevoSyncedAt: nowIso() };
      if (result.id && result.id !== after.brevoContactId) patch.brevoContactId = result.id;
      if (listIds.length > 0 && listIds.join(',') !== (after.brevoListIds ?? []).join(',')) {
        patch.brevoListIds = listIds;
      }
      await afterSnapshot.ref.update(patch);

      log.info('Contatto sincronizzato su Brevo', {
        contactId,
        brevoContactId: result.id,
        created: result.created,
      });
    } catch (error) {
      // Non si rilancia: un errore Brevo non deve far ritentare all'infinito la
      // scrittura Firestore. L'errore resta nei log e il prossimo aggiornamento
      // del contatto riproverà.
      log.error('Sincronizzazione del contatto su Brevo fallita', error, { contactId, email });
      await col
        .contacts()
        .doc(contactId)
        .update({ brevoSyncError: error instanceof Error ? error.message : String(error) })
        .catch(() => undefined);
    }
  },
);
