import { toast } from 'sonner';

export { toast };

/** Forme d'errore che possono arrivare da Firebase, zod o fetch. */
interface ErrorLike {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  error?: { message?: unknown };
}

/** Estrae un messaggio leggibile in italiano da qualunque errore. */
export function errorMessage(error: unknown, fallback = 'Si è verificato un errore imprevisto.'): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error.trim() || fallback;

  if (error instanceof Error && error.message.trim()) return error.message.trim();

  if (typeof error === 'object') {
    const candidate = error as ErrorLike;
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message.trim();
    }
    if (candidate.error && typeof candidate.error.message === 'string' && candidate.error.message.trim()) {
      return candidate.error.message.trim();
    }
    if (typeof candidate.code === 'string' && candidate.code.trim()) {
      return candidate.code.trim();
    }
  }
  return fallback;
}

/** Mostra un toast d'errore con il messaggio estratto dall'errore. */
export function toastError(error: unknown, fallback?: string): string | number {
  const message = errorMessage(error, fallback);
  // In sviluppo lasciamo traccia in console per il debug.
  if (process.env.NODE_ENV !== 'production') {
    console.error('[AlphaInk]', error);
  }
  return toast.error(message);
}

/** Toast di successo, con descrizione opzionale. */
export function toastSuccess(message: string, description?: string): string | number {
  return toast.success(message, description ? { description } : undefined);
}

/** Toast informativo. */
export function toastInfo(message: string, description?: string): string | number {
  return toast(message, description ? { description } : undefined);
}

/** Toast di avviso. */
export function toastWarning(message: string, description?: string): string | number {
  return toast.warning(message, description ? { description } : undefined);
}

/** Toast legato al ciclo di vita di una promessa. */
export function toastPromise<T>(
  promise: Promise<T>,
  messages: { loading: string; success: string | ((data: T) => string); error?: string },
): Promise<T> {
  toast.promise(promise, {
    loading: messages.loading,
    success: messages.success,
    error: (err: unknown) => errorMessage(err, messages.error),
  });
  return promise;
}
