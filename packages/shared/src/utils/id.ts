const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Id casuale URL-safe. Usa `crypto.getRandomValues` quando disponibile
 * (browser e Node ≥ 19), con fallback su `Math.random`.
 */
export function randomId(length = 12): string {
  type RandomSource = { getRandomValues(array: Uint8Array): Uint8Array };
  const cryptoObj = (globalThis as { crypto?: Partial<RandomSource> }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    (cryptoObj as RandomSource).getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i]! % ALPHABET.length];
    return out;
  }
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Id di blocco dell'editor: prefissato per facilitare il debug. */
export function blockId(type: string): string {
  return `${type}_${randomId(8)}`;
}

/** Codice coupon leggibile: `PREFIX-XXXX-XXXX`. */
export function couponCode(prefix: string): string {
  const clean = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10) || 'ALPHA';
  return `${clean}-${randomId(4)}-${randomId(4)}`;
}

/**
 * Chiave di deduplica delle esecuzioni automazione.
 * Deve essere deterministica: lo stesso trigger produce sempre la stessa chiave.
 */
export function dedupeKey(parts: Array<string | number>): string {
  return parts.map((p) => String(p).replace(/[^A-Za-z0-9_-]/g, '_')).join(':');
}
