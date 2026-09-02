import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { createLogger } from './logger';

const log = createLogger('http');

/** Origini autorizzate a chiamare gli endpoint HTTP pubblici. */
const ALLOWED_ORIGIN_SUFFIXES = ['.alphaink.net', 'localhost'];

export function applyCors(req: Request, res: Response): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    const allowed = ALLOWED_ORIGIN_SUFFIXES.some(
      (suffix) => origin.endsWith(suffix) || origin.includes(`//${suffix}`),
    );
    if (allowed) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
  }
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Alphaink-Signature');
  res.set('Access-Control-Max-Age', '3600');
}

/** Gestisce il preflight. Restituisce true se la richiesta è stata chiusa. */
export function handlePreflight(req: Request, res: Response): boolean {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

export function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).set('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}

export function sendError(res: Response, status: number, code: string, message: string): void {
  log.warn('Richiesta rifiutata', { status, code, message });
  sendJson(res, status, { ok: false, error: { code, message } });
}

/**
 * GIF trasparente 1×1 usata come pixel di tracciamento quando serve un
 * fallback locale alle aperture (Brevo traccia già le proprie).
 */
export const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

export function sendPixel(res: Response): void {
  res
    .status(200)
    .set('Content-Type', 'image/gif')
    .set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    .set('Pragma', 'no-cache')
    .send(TRACKING_PIXEL);
}

/** Estrae l'IP del client rispettando la catena di proxy di Cloud Run. */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() ?? null;
  if (Array.isArray(forwarded)) return forwarded[0] ?? null;
  return req.ip ?? null;
}

/** Riconosce il tipo di dispositivo dallo user agent. */
export function detectDevice(userAgent: string | undefined): 'desktop' | 'mobile' | 'tablet' | 'unknown' {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)) return 'mobile';
  if (/mozilla|chrome|safari|firefox|edge/.test(ua)) return 'desktop';
  return 'unknown';
}
