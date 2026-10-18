-- Integrity guards that the ORM schema cannot express.

-- 1. Append-only tables: ledgers and the audit log can never be updated or deleted.
--    Mistakes are corrected with new reversing records, never by editing history.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER hub_stock_movements_append_only BEFORE UPDATE OR DELETE ON hub_stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER hub_reservations_append_only BEFORE UPDATE OR DELETE ON hub_reservations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER hotel_stock_movements_append_only BEFORE UPDATE OR DELETE ON hotel_stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER price_history_append_only BEFORE UPDATE OR DELETE ON price_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- 2. Issued invoices, credit notes and posted bills are frozen. Only the
--    status columns used by discarding drafts may change, and never after issue.
CREATE OR REPLACE FUNCTION freeze_finalized_document() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('issued', 'posted') THEN
      RAISE EXCEPTION '% % is finalized and cannot be deleted', TG_TABLE_NAME, OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('issued', 'posted') THEN
    RAISE EXCEPTION '% % is finalized and cannot be changed; use a credit note or reversal', TG_TABLE_NAME, OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_freeze BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION freeze_finalized_document();
--> statement-breakpoint
CREATE TRIGGER credit_notes_freeze BEFORE UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION freeze_finalized_document();
--> statement-breakpoint
CREATE TRIGGER supplier_bills_freeze BEFORE UPDATE OR DELETE ON supplier_bills
  FOR EACH ROW EXECUTE FUNCTION freeze_finalized_document();
--> statement-breakpoint

-- Lines of finalized documents are frozen too.
CREATE OR REPLACE FUNCTION freeze_finalized_lines() RETURNS trigger AS $$
DECLARE
  parent_status text;
  parent_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'invoice_lines' THEN
    parent_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
    SELECT status INTO parent_status FROM invoices WHERE id = parent_id;
  ELSIF TG_TABLE_NAME = 'credit_note_lines' THEN
    parent_id := COALESCE(NEW.credit_note_id, OLD.credit_note_id);
    SELECT status INTO parent_status FROM credit_notes WHERE id = parent_id;
  ELSE
    parent_id := COALESCE(NEW.bill_id, OLD.bill_id);
    SELECT status INTO parent_status FROM supplier_bills WHERE id = parent_id;
  END IF;
  IF parent_status IN ('issued', 'posted') THEN
    RAISE EXCEPTION 'Lines of finalized document % cannot be changed', parent_id USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_freeze BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION freeze_finalized_lines();
--> statement-breakpoint
CREATE TRIGGER credit_note_lines_freeze BEFORE INSERT OR UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION freeze_finalized_lines();
--> statement-breakpoint
CREATE TRIGGER supplier_bill_lines_freeze BEFORE INSERT OR UPDATE OR DELETE ON supplier_bill_lines
  FOR EACH ROW EXECUTE FUNCTION freeze_finalized_lines();
--> statement-breakpoint

-- 3. Payments: amount, party and date are immutable once recorded. Only the
--    reversal columns may change, and a reversed payment stays reversed.
CREATE OR REPLACE FUNCTION guard_payment_update() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted; reverse them instead' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.direction <> OLD.direction
     OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.payment_date <> OLD.payment_date OR NEW.method <> OLD.method
     OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.payment_number <> OLD.payment_number THEN
    RAISE EXCEPTION 'Recorded payment details are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'Reversed payment cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment_update();
--> statement-breakpoint

-- 4. Allocations can only be marked reversed, never edited or deleted.
CREATE OR REPLACE FUNCTION guard_allocation_update() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment allocations cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.payment_id <> OLD.payment_id
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.bill_id IS DISTINCT FROM OLD.bill_id
     OR OLD.reversed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Payment allocations are immutable except for reversal' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payment_allocations_guard BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_allocation_update();
