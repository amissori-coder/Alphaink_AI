/**
 * Libreria immagini delle newsletter.
 *
 *  - `requestMediaUpload` prepara il caricamento e restituisce una **signed URL
 *    v4** valida 15 minuti: il file viaggia dal browser direttamente a Cloud
 *    Storage, senza passare dalle Functions (nessun limite di payload, nessun
 *    costo di transito).
 *  - `deleteMediaAsset` rimuove file e documento.
 *
 * ## Dove finiscono i file
 * `media/{anno}/{mese}/{idCasuale}-{nomefile}`. La suddivisione per anno e mese
 * tiene le cartelle navigabili anche dopo migliaia di caricamenti, e il
 * prefisso casuale evita che due file con lo stesso nome si sovrascrivano.
 *
 * ## Perché l'URL pubblico passa da `firebasestorage.googleapis.com`
 * Le immagini di un'email sono scaricate da client di posta non autenticati.
 * L'endpoint di download di Firebase applica le regole di `storage.rules`, dove
 * `media/**` è in lettura pubblica: l'immagine si vede senza rendere pubblico
 * l'intero bucket e senza generare URL firmate a scadenza.
 */

import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { LIMITS, STORAGE_PATHS, mediaUploadSchema, randomId, slugify } from '@alphaink/shared';
import type { DocId, IsoDate } from '@alphaink/shared';

import { requirePermission } from '../lib/auth';
import { LIGHT_RUNTIME } from '../lib/config';
import { AppError, invalidArgument, notFound, toHttpsError } from '../lib/errors';
import { auditCreate, bucket, col, logActivity, withId } from '../lib/firestore';
import { createLogger } from '../lib/logger';

const log = createLogger('media.callables');

/** Validità della URL di caricamento. */
export const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

/** Estensioni accettate, in coerenza con `mediaUploadSchema`. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export interface MediaAsset {
  id: DocId;
  fileName: string;
  /** Percorso completo nel bucket. */
  path: string;
  /** URL pubblico utilizzabile dentro le email. */
  url: string;
  contentType: string;
  size: number;
  /** Cartella logica usata dai filtri della libreria. */
  folder: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  createdBy?: string | null;
  updatedBy?: string | null;
}

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

/**
 * Nome file sicuro: slug del nome originale più l'estensione corretta per il
 * tipo MIME dichiarato. Impedisce percorsi relativi (`../`) e caratteri che
 * romperebbero la URL nell'email.
 */
export function safeFileName(fileName: string, contentType: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = EXTENSION_BY_TYPE[contentType] ?? 'bin';
  const slug = slugify(stem) || 'immagine';
  return `${slug}.${extension}`;
}

/** Percorso `media/{anno}/{mese}/{idCasuale}-{nomefile}`. */
export function buildMediaPath(fileName: string, contentType: string, now = new Date()): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${STORAGE_PATHS.media}/${year}/${month}/${randomId(10)}-${safeFileName(fileName, contentType)}`;
}

/** URL pubblico servito applicando `storage.rules`. */
export function publicMediaUrl(path: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
}

// -----------------------------------------------------------------------------
// requestMediaUpload
// -----------------------------------------------------------------------------

export interface RequestMediaUploadResult {
  assetId: DocId;
  /** URL su cui eseguire la `PUT` del file. */
  uploadUrl: string;
  /** Header obbligatori della `PUT`: devono coincidere con la firma. */
  headers: Record<string, string>;
  /** URL definitivo da usare nell'email. */
  url: string;
  path: string;
  expiresAt: IsoDate;
}

export const requestMediaUpload = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<RequestMediaUploadResult> =>
    guard('requestMediaUpload', async () => {
      const caller = requirePermission(request, 'media:write');
      const input = parseInput(mediaUploadSchema, request.data);

      if (input.size > LIMITS.maxImageBytes) {
        throw invalidArgument(
          `L'immagine supera il limite di ${Math.round(LIMITS.maxImageBytes / (1024 * 1024))} MB.`,
        );
      }

      const path = buildMediaPath(input.fileName, input.contentType);
      const expires = Date.now() + UPLOAD_URL_TTL_MS;

      let uploadUrl: string;
      try {
        const [signed] = await bucket.file(path).getSignedUrl({
          version: 'v4',
          action: 'write',
          expires,
          contentType: input.contentType,
        });
        uploadUrl = signed;
      } catch (error) {
        // Firmare richiede `iam.serviceAccounts.signBlob` sull'account di
        // servizio della funzione: senza, il messaggio generico di Google non
        // dice nulla all'operatore.
        log.error('Firma della URL di caricamento non riuscita', error, { path });
        throw new AppError(
          'failed_precondition',
          'Non è stato possibile firmare il caricamento: assegna il ruolo "Creatore token account di servizio" ' +
            'all\'account di servizio delle Functions e riprova.',
          { cause: error },
        );
      }

      const url = publicMediaUrl(path);
      const ref = col.mediaAssets().doc();
      const asset: Omit<MediaAsset, 'id'> = {
        fileName: safeFileName(input.fileName, input.contentType),
        path,
        url,
        contentType: input.contentType,
        size: input.size,
        folder: input.folder || STORAGE_PATHS.media,
        width: null,
        height: null,
        alt: null,
        ...auditCreate(caller.uid),
      };

      // Il documento nasce già utilizzabile: se la `PUT` sulla signed URL non
      // va a buon fine, la web app chiama `deleteMediaAsset` e ripulisce.
      await ref.set(asset);

      log.info('Caricamento immagine autorizzato', { assetId: ref.id, path, size: input.size });

      return {
        assetId: ref.id,
        uploadUrl,
        headers: { 'Content-Type': input.contentType },
        url,
        path,
        expiresAt: new Date(expires).toISOString(),
      };
    }),
);

// -----------------------------------------------------------------------------
// deleteMediaAsset
// -----------------------------------------------------------------------------

const deleteSchema = z.object({ assetId: z.string().min(1) });

export const deleteMediaAsset = onCall(
  { ...LIGHT_RUNTIME },
  async (request: CallableRequest<unknown>): Promise<{ deleted: true; fileRemoved: boolean }> =>
    guard('deleteMediaAsset', async () => {
      const caller = requirePermission(request, 'media:write');
      const input = parseInput(deleteSchema, request.data);

      const ref = col.mediaAssets().doc(input.assetId);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw notFound('Immagine', input.assetId);
      const asset = withId<MediaAsset>(snapshot);

      let fileRemoved = false;
      if (asset.path) {
        try {
          // `ignoreNotFound`: il file può mancare se il caricamento non era
          // mai andato a buon fine. Il documento va rimosso comunque.
          await bucket.file(asset.path).delete({ ignoreNotFound: true });
          fileRemoved = true;
        } catch (error) {
          log.error('Eliminazione del file non riuscita', error, { path: asset.path });
        }
      }

      await ref.delete();

      await logActivity({
        action: 'media.delete',
        entityType: 'media',
        entityId: input.assetId,
        userId: caller.uid,
        summary: `Immagine "${asset.fileName}" eliminata`,
        metadata: { path: asset.path, fileRemoved },
        severity: 'warning',
      });

      return { deleted: true, fileRemoved };
    }),
);
