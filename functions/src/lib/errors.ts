import { HttpsError } from 'firebase-functions/v2/https';
import type { ApiErrorCode } from '@alphaink/shared';

/** Errore applicativo con codice stabile, convertibile in `HttpsError`. */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;
  /** Se true l'operazione può essere ritentata (errore transitorio). */
  readonly retryable: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
    if (options.cause) (this as { cause?: unknown }).cause = options.cause;
  }
}

const CODE_MAP: Record<ApiErrorCode, string> = {
  invalid_argument: 'invalid-argument',
  unauthenticated: 'unauthenticated',
  permission_denied: 'permission-denied',
  not_found: 'not-found',
  already_exists: 'already-exists',
  failed_precondition: 'failed-precondition',
  resource_exhausted: 'resource-exhausted',
  rate_limited: 'resource-exhausted',
  upstream_error: 'unavailable',
  internal: 'internal',
};

/** Converte un errore qualsiasi in `HttpsError` per le callable. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof AppError) {
    return new HttpsError(
      CODE_MAP[error.code] as ConstructorParameters<typeof HttpsError>[0],
      error.message,
      error.details,
    );
  }
  const message = error instanceof Error ? error.message : 'Errore interno';
  return new HttpsError('internal', message);
}

export function invalidArgument(message: string, details?: Record<string, unknown>): AppError {
  return new AppError('invalid_argument', message, { details });
}

export function notFound(entity: string, id?: string): AppError {
  return new AppError('not_found', `${entity}${id ? ` "${id}"` : ''} non trovato.`);
}

export function permissionDenied(message = 'Permessi insufficienti.'): AppError {
  return new AppError('permission_denied', message);
}

export function failedPrecondition(message: string, details?: Record<string, unknown>): AppError {
  return new AppError('failed_precondition', message, { details });
}

export function upstream(service: string, message: string, details?: Record<string, unknown>): AppError {
  return new AppError('upstream_error', `${service}: ${message}`, { details, retryable: true });
}

/** Vero se vale la pena ritentare l'operazione. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof AppError) return error.retryable;
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string') {
    return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code);
  }
  return false;
}
