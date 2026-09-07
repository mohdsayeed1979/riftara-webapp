-- ============================================================================
-- RIFTARA — Database-level integrity guarantees
--
-- These constraints exist BELOW the application layer. Even a direct SQL
-- session, a buggy service or a concurrent transaction cannot violate them.
-- The file is idempotent and re-applied on every `db:migrate`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- BR-002 — A unit cannot have conflicting active reservations.
-- A partial unique index makes double-booking impossible under concurrency.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_per_unit
  ON reservations (unit_id)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- BR-003 — A unit cannot have overlapping active lease contracts.
-- Implemented as a trigger rather than an EXCLUDE constraint so it works
-- without the btree_gist extension (portable across managed PostgreSQL and
-- the embedded PGlite driver).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION riftara_check_contract_overlap()
RETURNS TRIGGER AS $$
DECLARE
  conflicting_contract TEXT;
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT c.contract_number INTO conflicting_contract
  FROM contracts c
  WHERE c.unit_id = NEW.unit_id
    AND c.id <> NEW.id
    AND c.is_active IS TRUE
    AND c.deleted_at IS NULL
    AND daterange(c.start_date, c.end_date, '[]')
        && daterange(NEW.start_date, NEW.end_date, '[]')
  LIMIT 1;

  IF conflicting_contract IS NOT NULL THEN
    RAISE EXCEPTION
      'BR-003: unit already has an active contract (%) overlapping % .. %',
      conflicting_contract, NEW.start_date, NEW.end_date
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contracts_no_overlap ON contracts;
CREATE TRIGGER trg_contracts_no_overlap
  BEFORE INSERT OR UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION riftara_check_contract_overlap();

-- ---------------------------------------------------------------------------
-- BR-012 — Signed contracts must never be permanently deleted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION riftara_protect_contract_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('signed', 'active', 'expired', 'terminated') THEN
    RAISE EXCEPTION
      'BR-012: contract % has status % and cannot be deleted; terminate or cancel it instead',
      OLD.contract_number, OLD.status
      USING ERRCODE = '23000';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contracts_protect_delete ON contracts;
CREATE TRIGGER trg_contracts_protect_delete
  BEFORE DELETE ON contracts
  FOR EACH ROW EXECUTE FUNCTION riftara_protect_contract_delete();

-- ---------------------------------------------------------------------------
-- BR-013 — Financial transactions must never be permanently deleted.
-- Invoices are cancelled or waived; payments are reversed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION riftara_block_financial_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'BR-013: % records are financial transactions and cannot be deleted; reverse or cancel instead',
    TG_TABLE_NAME
    USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_block_delete ON invoices;
CREATE TRIGGER trg_invoices_block_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION riftara_block_financial_delete();

DROP TRIGGER IF EXISTS trg_payments_block_delete ON payments;
CREATE TRIGGER trg_payments_block_delete
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION riftara_block_financial_delete();

DROP TRIGGER IF EXISTS trg_payment_allocations_block_delete ON payment_allocations;
CREATE TRIGGER trg_payment_allocations_block_delete
  BEFORE DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION riftara_block_financial_delete();

DROP TRIGGER IF EXISTS trg_tenant_ledger_block_delete ON tenant_ledger_entries;
CREATE TRIGGER trg_tenant_ledger_block_delete
  BEFORE DELETE ON tenant_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION riftara_block_financial_delete();

-- ---------------------------------------------------------------------------
-- BR-017 — The audit trail is append-only and cannot be edited.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION riftara_audit_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'BR-017: audit_logs is append-only (attempted %)', TG_OP
    USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION riftara_audit_append_only();

-- BR-005 — Price history is never overwritten.
DROP TRIGGER IF EXISTS trg_price_history_append_only ON price_history;
CREATE TRIGGER trg_price_history_append_only
  BEFORE UPDATE OR DELETE ON price_history
  FOR EACH ROW EXECUTE FUNCTION riftara_audit_append_only();

-- ---------------------------------------------------------------------------
-- Financial value constraints — no silent negative balances.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_amounts_ck') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_ck CHECK (
      total_amount >= 0 AND paid_amount >= 0 AND paid_amount <= total_amount + 0.01
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_balance_ck') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_balance_ck CHECK (
      abs(balance_amount - (total_amount - paid_amount)) < 0.01
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_ck') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_amount_ck CHECK (
      amount > 0 AND unallocated_amount >= 0 AND unallocated_amount <= amount + 0.01
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_allocations_amount_ck') THEN
    ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_amount_ck CHECK (amount > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ownership_percentage_ck') THEN
    ALTER TABLE property_ownerships ADD CONSTRAINT ownership_percentage_ck CHECK (
      ownership_percentage > 0 AND ownership_percentage <= 100
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_dates_ck') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_dates_ck CHECK (end_date > start_date);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_rent_ck') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_rent_ck CHECK (annual_rent >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_dates_ck') THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_dates_ck CHECK (expiry_date >= reservation_date);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pricing_discount_ck') THEN
    ALTER TABLE unit_pricing ADD CONSTRAINT pricing_discount_ck CHECK (
      discount_percent >= 0 AND discount_percent <= 100 AND asking_rent >= 0
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- One current valuation per property drives portfolio market value.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS valuations_one_current_per_property
  ON valuations (property_id)
  WHERE is_current;

-- ---------------------------------------------------------------------------
-- Hot-path partial indexes for the executive dashboards.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS contracts_active_unit_idx
  ON contracts (unit_id, end_date) WHERE is_active;

CREATE INDEX IF NOT EXISTS invoices_outstanding_idx
  ON invoices (organization_id, due_date)
  WHERE status IN ('due', 'overdue', 'partially_paid');

CREATE INDEX IF NOT EXISTS units_available_idx
  ON units (organization_id, property_id)
  WHERE computed_availability_class = 'available';

CREATE INDEX IF NOT EXISTS work_orders_open_idx
  ON work_orders (organization_id, property_id)
  WHERE status IN ('open', 'assigned', 'in_progress', 'pending');

CREATE INDEX IF NOT EXISTS leads_open_followup_idx
  ON leads (organization_id, next_follow_up_at)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_unread_user_idx
  ON notifications (user_id, created_at)
  WHERE read_at IS NULL;
