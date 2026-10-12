-- Change capture. Identical on device and server.
-- tillbox.suppress = 'on'  : applying remote changes on a device (do not echo them back)
-- tillbox.origin   = <id>  : on the server, the device a change came from
CREATE FUNCTION tb_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o text;
BEGIN
  IF current_setting('tillbox.suppress', true) = 'on' THEN RETURN NULL; END IF;
  o := coalesce(nullif(current_setting('tillbox.origin', true), ''), (SELECT value FROM meta WHERE key = 'device_id'));
  INSERT INTO outbox (table_name, row_id, op, payload, origin)
  VALUES (TG_TABLE_NAME, NEW.id, TG_OP, to_jsonb(NEW), o);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER tb_capture_devices AFTER INSERT OR UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION tb_capture();
--> statement-breakpoint
CREATE TRIGGER tb_capture_products AFTER INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION tb_capture();
--> statement-breakpoint
CREATE TRIGGER tb_capture_stock_movements AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION tb_capture();
--> statement-breakpoint
CREATE TRIGGER tb_capture_orders AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION tb_capture();
--> statement-breakpoint
CREATE TRIGGER tb_capture_order_lines AFTER INSERT ON order_lines FOR EACH ROW EXECUTE FUNCTION tb_capture();
--> statement-breakpoint
CREATE TRIGGER tb_capture_order_payments AFTER INSERT ON order_payments FOR EACH ROW EXECUTE FUNCTION tb_capture();
--> statement-breakpoint
-- Append-only guarantee, enforced by the database on both sides.
CREATE FUNCTION tb_no_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME; END $$;
--> statement-breakpoint
CREATE TRIGGER tb_append_only_stock BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION tb_no_mutation();
--> statement-breakpoint
CREATE TRIGGER tb_append_only_orders BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION tb_no_mutation();
--> statement-breakpoint
CREATE TRIGGER tb_append_only_lines BEFORE UPDATE OR DELETE ON order_lines FOR EACH ROW EXECUTE FUNCTION tb_no_mutation();
--> statement-breakpoint
CREATE TRIGGER tb_append_only_payments BEFORE UPDATE OR DELETE ON order_payments FOR EACH ROW EXECUTE FUNCTION tb_no_mutation();
