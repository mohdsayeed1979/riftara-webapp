import type { ErpAdapter, ErpAdapterRequest, ErpAdapterResult } from '../../erp-types';
import { MockErpAdapter } from '../../erp-adapter';

/**
 * Dynamics AX 2012 R3 adapter — NOT CONNECTED.
 *
 * This class exists so the rest of RIFTARA can depend on a named,
 * AX-specific adapter today, and so that plugging in a real transport later
 * is a change confined to this one file (no business logic elsewhere needs
 * to change — see erp-service.ts, which only depends on the ErpAdapter
 * interface).
 *
 * Microsoft Dynamics AX 2012 R3 predates the modern Dynamics 365 Web API. Its
 * realistic integration options are the Application Integration Framework
 * (AIF) — via its own web services or the AIF file/queue adapters —
 * middleware (BizTalk or similar), a controlled database staging table, or a
 * file-based exchange. Deliberately, NONE of those is chosen here: the
 * correct one depends on what the company's actual AX 2012 R3 environment
 * exposes, which has not been confirmed. See docs/PHASE_18_ERP_INTEGRATION.md
 * for the open business decisions that gate a real implementation.
 *
 * Until that decision is made and credentials are provisioned (never in this
 * codebase — see `src/config/env.ts`'s `dynamicsAx2012` credential check),
 * this adapter delegates to the deterministic mock so the rest of the outbox
 * pipeline (queueing, retry, idempotency, reconciliation) is fully
 * exercisable and testable today.
 */
export class DynamicsAx2012Adapter implements ErpAdapter {
  readonly system = 'dynamics_ax2012' as const;
  readonly isConnected = false;

  private readonly delegate = new MockErpAdapter();

  async send(request: ErpAdapterRequest): Promise<ErpAdapterResult> {
    // NOTE: no network/database call to any AX server happens here or ever
    // will until this method is replaced with a real transport per an
    // approved integration design.
    return this.delegate.send(request);
  }
}
