'use client';

/**
 * Utilità di caricamento della libreria media.
 *
 * Il file non passa dalle Cloud Functions: la callable `requestMediaUpload`
 * restituisce una *signed URL* e il browser esegue la `PUT` direttamente su
 * Cloud Storage. Così non ci sono limiti di payload e l'avanzamento è reale.
 */

import { LIMITS } from '@alphaink/shared';

import { callable } from '@/lib/firebase/client';

/** Tipi accettati da `mediaUploadSchema` lato Functions. */
export const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',');

/** Cartelle proposte per organizzare la libreria. */
export const DEFAULT_FOLDERS = ['media', 'brand', 'prodotti', 'banner', 'promozioni'];

export const MAX_UPLOAD_BYTES = LIMITS.maxImageBytes;

/** Risposta di `requestMediaUpload`. */
export interface UploadTicket {
  assetId: string;
  uploadUrl: string;
  headers?: Record<string, string>;
  url?: string;
  path?: string;
  publicUrl?: string;
  storagePath?: string;
  expiresAt?: string;
}

export const requestMediaUpload = callable<
  { fileName: string; contentType: string; size: number; folder?: string },
  UploadTicket
>('requestMediaUpload', { timeoutMs: 120_000 });

export const deleteMediaAsset = callable<{ assetId: string }, { deleted: true; fileRemoved: boolean }>(
  'deleteMediaAsset',
  { timeoutMs: 120_000 },
);

/** Motivo per cui un file non è caricabile, oppure `null` se va bene. */
export function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    return 'Formato non supportato: usa PNG, JPG, GIF, WebP o SVG.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Supera il limite di ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

/** `PUT` del file sulla URL firmata, con avanzamento e possibilità di annullare. */
export function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (percent: number) => void,
  registerAbort?: (abort: () => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url, true);
    for (const [key, value] of Object.entries(headers)) {
      request.setRequestHeader(key, value);
    }
    registerAbort?.(() => request.abort());
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Caricamento non riuscito (codice ${request.status}).`));
    };
    request.onerror = () => reject(new Error('Caricamento interrotto: controlla la connessione.'));
    request.onabort = () => reject(new Error('Caricamento annullato.'));
    request.send(file);
  });
}

/** Estensione in maiuscolo usata come etichetta ("PNG", "SVG"). */
export function fileExtension(fileName: string, contentType: string): string {
  const fromName = fileName.includes('.') ? fileName.split('.').pop() : null;
  if (fromName) return fromName.toUpperCase();
  return (contentType.split('/')[1] ?? 'file').toUpperCase();
}
