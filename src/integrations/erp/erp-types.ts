/**
 * ERP integration port (Phase 18).
 *
 * These types define the CONTRACT between RIFTARA and any external
 * accounting/ERP system. They are intentionally generic — no Dynamics AX
 * 2012 R3-specific field, table, or endpoint name appears here. The concrete
 * adapter (see adapters/dynamics-ax2012/) is the only place that would ever
 * translate these generic shapes into an AX-specific call, and today it does
 * not call anything real — see MockErpAdapter.
 */

export type ErpSystem = 'dynamics_ax2012';

/** Which RIFTARA table `entityId` refers to. Polymorphic, like `documents.entityType`. */
export type ErpEntityType =
  | 'customer'
  | 'vendor'
  | 'property'
  | 'unit'
  | 'contract'
  | 'invoice'
  | 'payment'
  | 'expense'
  | 'asset';

/**
 * Accounting-significant operational events RIFTARA may eventually export.
 * Not every RIFTARA event is exported — see docs/PHASE_18_ERP_INTEGRATION.md
 * §10 for which ones are proposed and why.
 */
export type ErpEventType =
  | 'customer_sync'
  | 'vendor_sync'
  | 'property_reference_sync'
  | 'unit_reference_sync'
  | 'invoice_issued'
  | 'payment_received'
  | 'expense_recorded'
  | 'asset_acquired'
  | 'asset_disposed';

export type ErpEventStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'retrying' | 'dead_letter';

export type ErpMappingStatus = 'pending' | 'mapped' | 'error';

/** What an adapter attempt reports back. Never fabricated by RIFTARA. */
export type ErpAdapterOutcome = 'success' | 'validation_error' | 'transient_error' | 'permanent_error';

export interface ErpAdapterRequest {
  organizationId: string;
  system: ErpSystem;
  eventType: ErpEventType;
  entityType: ErpEntityType;
  entityId: string;
  idempotencyKey: string;
  /** Accounting-relevant payload only — never the full operational record. */
  payload: Record<string, unknown>;
}

export interface ErpAdapterResult {
  outcome: ErpAdapterOutcome;
  /** The external voucher/reference/posting id — generic, opaque to RIFTARA. */
  externalReference?: string;
  errorCode?: string;
  errorMessage?: string;
  responseMetadata?: Record<string, unknown>;
}

/**
 * The port every ERP adapter implements. RIFTARA's outbox worker (see
 * erp-service.ts) depends only on this interface — never on an adapter's
 * internals — so a real Dynamics AX 2012 R3 transport can be dropped in later
 * without changing any business logic upstream of it.
 */
export interface ErpAdapter {
  readonly system: ErpSystem;
  /** Always false until a real, approved transport is configured (BR: never fake "Connected"). */
  readonly isConnected: boolean;
  send(request: ErpAdapterRequest): Promise<ErpAdapterResult>;
}
