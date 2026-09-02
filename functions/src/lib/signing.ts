import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Firma HMAC-SHA256 in base64url, usata per:
 *  - i link tracciati (`/t/c?...&s=<firma>`)
 *  - i token di disiscrizione e preferenze
 *  - la verifica dei webhook in ingresso
 *
 * Firmare impedisce che un terzo possa fabbricare click o disiscrivere contatti
 * altrui manipolando i parametri in query string.
 */
export function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Confronto a tempo costante: evita gli attacchi a timing. */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = sign(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface SignedToken {
  /** Dati arbitrari serializzabili. */
  data: Record<string, string | number | boolean>;
  /** Scadenza in epoch secondi; assente = nessuna scadenza. */
  exp?: number;
}

/** Crea un token compatto `base64url(payload).firma`. */
export function createToken(token: SignedToken, secret: string): string {
  const payload = Buffer.from(JSON.stringify(token)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** Verifica e decodifica un token. Restituisce `null` se non valido o scaduto. */
export function readToken(token: string, secret: string): SignedToken | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  if (!verifySignature(payload, signature, secret)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SignedToken;
    if (parsed.exp && parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
