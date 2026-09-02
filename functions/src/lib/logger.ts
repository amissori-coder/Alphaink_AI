import { logger as fnLogger } from 'firebase-functions/v2';

/**
 * Logger strutturato. Ogni voce porta un `module` per filtrare i log
 * in Cloud Logging: `jsonPayload.module="brevo"`.
 */
export interface LogContext {
  [key: string]: unknown;
}

export class Logger {
  constructor(private readonly module: string) {}

  private enrich(context?: LogContext): LogContext {
    return { module: this.module, ...(context ?? {}) };
  }

  debug(message: string, context?: LogContext): void {
    fnLogger.debug(message, this.enrich(context));
  }

  info(message: string, context?: LogContext): void {
    fnLogger.info(message, this.enrich(context));
  }

  warn(message: string, context?: LogContext): void {
    fnLogger.warn(message, this.enrich(context));
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    fnLogger.error(message, this.enrich({
      ...context,
      error: serializeError(error),
    }));
  }

  child(suffix: string): Logger {
    return new Logger(`${this.module}.${suffix}`);
  }
}

export function serializeError(error: unknown): Record<string, unknown> | null {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(typeof (error as { code?: unknown }).code !== 'undefined'
        ? { code: (error as { code?: unknown }).code }
        : {}),
    };
  }
  return { value: String(error) };
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}
