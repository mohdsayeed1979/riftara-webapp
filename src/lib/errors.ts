/**
 * Domain error taxonomy. Services throw these; the API layer and Server
 * Actions translate them into user-facing messages and HTTP status codes.
 * Raw stack traces are never shown to users (BRD 69).
 */

export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'RATE_LIMITED'
  | 'INTEGRATION'
  | 'INTERNAL';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Business rule reference, e.g. "BR-003". */
  readonly rule?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; details?: unknown; rule?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    this.details = options.details;
    this.rule = options.rule;
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case 'VALIDATION':
      return 422;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'BUSINESS_RULE':
      return 409;
    case 'FORBIDDEN':
      return 403;
    case 'UNAUTHENTICATED':
      return 401;
    case 'RATE_LIMITED':
      return 429;
    case 'INTEGRATION':
      return 502;
    default:
      return 500;
  }
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError('VALIDATION', message, { details });
}

export function notFound(entity: string, id?: string): AppError {
  return new AppError('NOT_FOUND', id ? `${entity} ${id} was not found.` : `${entity} was not found.`);
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError('CONFLICT', message, { details });
}

/** Raised when a BRD business rule blocks the operation. */
export function businessRuleViolation(rule: string, message: string, details?: unknown): AppError {
  return new AppError('BUSINESS_RULE', message, { rule, details });
}

export function forbidden(message = 'You do not have permission to perform this action.'): AppError {
  return new AppError('FORBIDDEN', message);
}

export function integrationError(message: string, details?: unknown): AppError {
  return new AppError('INTEGRATION', message, { details });
}

/** Flattens an error's message with its full `cause` chain. Drizzle wraps the
 *  driver error, so the trigger/constraint text lives on `error.cause`. */
function flattenErrorMessage(error: unknown, depth = 0): string {
  if (depth > 6 || error === null || error === undefined) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const causeText = 'cause' in error ? flattenErrorMessage((error as { cause?: unknown }).cause, depth + 1) : '';
    return `${error.message} ${causeText}`.trim();
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const own = typeof record.message === 'string' ? record.message : '';
    const causeText = flattenErrorMessage(record.cause, depth + 1);
    return `${own} ${causeText}`.trim();
  }
  return String(error);
}

/** Maps a PostgreSQL constraint violation onto the business rule it enforces. */
export function translateDatabaseError(error: unknown): AppError | null {
  const message = flattenErrorMessage(error);

  if (message.includes('BR-003') || message.includes('reservations_one_active_per_unit')) {
    if (message.includes('reservations_one_active_per_unit')) {
      return businessRuleViolation(
        'BR-002',
        'This unit already has an active reservation. Cancel or expire it before creating another.',
      );
    }
    return businessRuleViolation(
      'BR-003',
      'This unit already has an overlapping active lease contract for the selected period.',
    );
  }
  if (message.includes('BR-012')) {
    return businessRuleViolation(
      'BR-012',
      'Signed contracts cannot be deleted. Terminate or cancel the contract instead.',
    );
  }
  if (message.includes('BR-013')) {
    return businessRuleViolation(
      'BR-013',
      'Financial transactions cannot be deleted. Reverse or cancel the record instead.',
    );
  }
  if (message.includes('BR-017')) {
    return businessRuleViolation('BR-017', 'Audit log entries cannot be modified or deleted.');
  }
  if (message.includes('customer_identifiers_uq')) {
    return businessRuleViolation(
      'BR-007',
      'A customer with this identifier already exists. Link the request to the existing customer.',
    );
  }
  if (message.includes('duplicate key value violates unique constraint')) {
    return conflict('A record with these details already exists.');
  }
  if (message.includes('violates foreign key constraint')) {
    return conflict('This record is referenced by other data and cannot be changed.');
  }
  if (message.includes('violates check constraint')) {
    return validationError('The submitted values failed a database validation rule.');
  }
  return null;
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  rule?: string;
  details?: unknown;
}

/** Normalises any thrown value into a safe, user-presentable payload. */
export function toErrorPayload(error: unknown): { payload: ErrorPayload; status: number } {
  if (error instanceof AppError) {
    return {
      payload: { code: error.code, message: error.message, rule: error.rule, details: error.details },
      status: error.status,
    };
  }

  const translated = translateDatabaseError(error);
  if (translated) {
    return {
      payload: {
        code: translated.code,
        message: translated.message,
        rule: translated.rule,
        details: translated.details,
      },
      status: translated.status,
    };
  }

  // Unexpected failures are logged server-side; the client sees a safe message.
  console.error('[unhandled]', error);
  return {
    payload: { code: 'INTERNAL', message: 'An unexpected error occurred. Please try again.' },
    status: 500,
  };
}

/** Result envelope used by Server Actions so forms can render field errors. */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorPayload; fieldErrors?: Record<string, string[]> };

export function actionSuccess<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionFailure(
  error: unknown,
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  const { payload } = toErrorPayload(error);
  return { ok: false, error: payload, fieldErrors };
}
