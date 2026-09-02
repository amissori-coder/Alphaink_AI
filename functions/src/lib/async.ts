import { isRetryable } from './errors';

/** Attende `ms` millisecondi. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  attempts?: number;
  /** Ritardo iniziale in ms; raddoppia ad ogni tentativo. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Decide se ritentare a fronte di un errore. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Esegue `fn` con backoff esponenziale e jitter.
 * Di default ritenta solo gli errori marcati come `retryable`.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelay = options.baseDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 15_000;
  const shouldRetry = options.shouldRetry ?? ((error: unknown) => isRetryable(error));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error, attempt)) throw error;
      const exponential = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      // Jitter pieno: riduce il thundering herd fra istanze concorrenti.
      const delay = Math.round(Math.random() * exponential);
      options.onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Esegue i task con un limite di concorrenza, preservando l'ordine dei risultati.
 * Sostituisce `p-limit` senza aggiungere dipendenze.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let cursor = 0;

  async function run(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}

/** Divide un array in blocchi di dimensione `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('La dimensione del blocco deve essere positiva.');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Limitatore di frequenza a token bucket, usato per rispettare i rate limit Brevo.
 * L'istanza è per-processo: con più istanze Cloud Functions il limite va
 * dimensionato di conseguenza (`maxInstances` × `ratePerSecond`).
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number = ratePerSecond,
  ) {
    this.tokens = burst;
    this.lastRefill = Date.now();
  }

  async acquire(count = 1): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= count) {
        this.tokens -= count;
        return;
      }
      const missing = count - this.tokens;
      await sleep(Math.ceil((missing / this.ratePerSecond) * 1000));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSeconds * this.ratePerSecond);
    this.lastRefill = now;
  }
}
