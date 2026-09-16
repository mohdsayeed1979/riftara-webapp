import type { ErpAdapter, ErpAdapterRequest, ErpAdapterResult } from './erp-types';

/**
 * Deterministic local test/mock adapter. Never contacts any real system.
 *
 * Behaviour is driven by an optional `payload.__simulate` field so tests can
 * exercise every outcome without depending on timing or randomness:
 *
 *   payload.__simulate === 'VALIDATION_ERROR' -> validation_error (never retried)
 *   payload.__simulate === 'TRANSIENT_ERROR'  -> transient_error (retryable)
 *   payload.__simulate === 'PERMANENT_ERROR'  -> permanent_error (not retried)
 *   anything else (default)                   -> success
 */
export class MockErpAdapter implements ErpAdapter {
  readonly system = 'dynamics_ax2012' as const;
  readonly isConnected = false;

  async send(request: ErpAdapterRequest): Promise<ErpAdapterResult> {
    const simulate = request.payload.__simulate;

    if (simulate === 'VALIDATION_ERROR') {
      return {
        outcome: 'validation_error',
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'The mock adapter rejected this payload as invalid (simulated).',
      };
    }
    if (simulate === 'TRANSIENT_ERROR') {
      return {
        outcome: 'transient_error',
        errorCode: 'TRANSIENT_ERROR',
        errorMessage: 'The mock adapter simulated a transient/network failure.',
      };
    }
    if (simulate === 'PERMANENT_ERROR') {
      return {
        outcome: 'permanent_error',
        errorCode: 'PERMANENT_ERROR',
        errorMessage: 'The mock adapter simulated a permanent rejection (simulated).',
      };
    }

    return {
      outcome: 'success',
      externalReference: `MOCK-${request.eventType.toUpperCase()}-${request.idempotencyKey.slice(-12)}`,
      responseMetadata: { mock: true, receivedAt: new Date().toISOString() },
    };
  }
}
