/** Normalizza un indirizzo per la deduplica: trim + lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email);
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** Domini usa-e-getta più comuni: segnalati durante l'import. */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', 'tempmail.com',
  '10minutemail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com',
]);

export function isDisposableEmail(email: string): boolean {
  const domain = normalizeEmail(email).split('@')[1];
  return domain ? DISPOSABLE_DOMAINS.has(domain) : false;
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split('@')[1] ?? '';
}

/** Nome visualizzato ricavato da nome/cognome, con fallback sull'email. */
export function displayNameFor(input: {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  email: string;
}): string {
  const full = [input.firstName, input.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (input.company) return input.company;
  return input.email.split('@')[0] ?? input.email;
}
