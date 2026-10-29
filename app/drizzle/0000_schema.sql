CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"destination" text NOT NULL,
	"status" text NOT NULL,
	"bytes" integer,
	"verified" boolean DEFAULT false NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"order_prefix" text NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"op" text NOT NULL,
	"payload" jsonb NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"summary" text,
	"data" jsonb,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"customer_id" uuid,
	"locale" text,
	"theme" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bundle_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bundle_product_id" uuid NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"qty" numeric(18, 5) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"image_media_id" uuid,
	"show_on_pos" boolean DEFAULT true NOT NULL,
	"sort_position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime" text,
	"size" integer,
	"storage_ref" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_merges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"winner_id" uuid NOT NULL,
	"reason" text DEFAULT 'same_sku' NOT NULL,
	"data" jsonb,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"barcode" text,
	"barcode_type" text,
	"price_sale_cents" bigint DEFAULT 0 NOT NULL,
	"price_wholesale_cents" bigint,
	"price_custom_cents" bigint,
	"cost_cents" bigint,
	"low_stock_qty" numeric(18, 5) DEFAULT '0' NOT NULL,
	"stock_alert" boolean DEFAULT false NOT NULL,
	"scale_plu" text,
	"weighable" boolean DEFAULT false NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'simple' NOT NULL,
	"category_id" uuid,
	"parent_id" uuid,
	"tax_group_id" uuid,
	"tax_mode_override" text,
	"track_stock" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"description" text,
	"image_media_id" uuid,
	"searchable" boolean DEFAULT true NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"sort_position" integer DEFAULT 0 NOT NULL,
	"expires" boolean DEFAULT false NOT NULL,
	"on_expiry" text DEFAULT 'allow_sales' NOT NULL,
	"default_purchase_unit_id" uuid,
	"reorder_qty" numeric(18, 5),
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "products_kind" CHECK ("products"."kind" in ('simple', 'service', 'bundle', 'variable', 'variant')),
	CONSTRAINT "products_status" CHECK ("products"."status" in ('available', 'unavailable')),
	CONSTRAINT "products_tax_mode" CHECK ("products"."tax_mode_override" in ('inclusive', 'exclusive'))
);
--> statement-breakpoint
CREATE TABLE "scale_ranges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"range_start" integer NOT NULL,
	"range_end" integer NOT NULL,
	"next_plu" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_group_taxes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tax_group_id" uuid NOT NULL,
	"tax_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_mode" text DEFAULT 'inclusive' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "tax_groups_mode" CHECK ("tax_groups"."default_mode" in ('inclusive', 'exclusive'))
);
--> statement-breakpoint
CREATE TABLE "taxes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(9, 6) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "taxes_rate_nonneg" CHECK ("taxes"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "unit_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"symbol" text,
	"ratio_to_base" numeric(18, 5) DEFAULT '1' NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustment_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"action" text NOT NULL,
	"qty" numeric(18, 5) NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "stock_adjustment_lines_action" CHECK ("stock_adjustment_lines"."action" in ('add', 'remove', 'defective', 'lost', 'set'))
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text,
	"author_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "stock_adjustments_status" CHECK ("stock_adjustments"."status" in ('draft', 'executed'))
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"product_unit_id" uuid PRIMARY KEY NOT NULL,
	"qty" numeric(18, 5) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"qty" numeric(18, 5) NOT NULL,
	"kind" text NOT NULL,
	"unit_cost_cents" bigint,
	"ref_type" text,
	"ref_id" uuid,
	"reason" text,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_kind" CHECK ("stock_movements"."kind" in ('opening', 'sale', 'return_good', 'return_damaged', 'void_return', 'receipt', 'add', 'remove', 'defective', 'lost', 'set', 'convert_in', 'convert_out'))
);
--> statement-breakpoint
CREATE TABLE "procurement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"procurement_id" uuid NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"qty" numeric(18, 5) NOT NULL,
	"purchase_price_cents" bigint NOT NULL,
	"tax_group_id" uuid,
	"tax_mode" text,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"expiry_date" date,
	"barcode" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"procurement_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text,
	"note" text,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"invoice_ref" text,
	"invoice_date" date,
	"delivery_date" date,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"cost_total_cents" bigint DEFAULT 0 NOT NULL,
	"tax_total_cents" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "procurements_status" CHECK ("procurements"."status" in ('draft', 'pending', 'delivered', 'stocked')),
	CONSTRAINT "procurements_payment" CHECK ("procurements"."payment_status" in ('unpaid', 'paid'))
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_price_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"procurement_id" uuid,
	"cost_cents" bigint NOT NULL,
	"qty" numeric(18, 5) NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_scopes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupon_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "coupon_scopes_scope" CHECK ("coupon_scopes"."scope" in ('product', 'category', 'customer', 'group'))
);
--> statement-breakpoint
CREATE TABLE "coupon_uses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupon_id" uuid NOT NULL,
	"customer_id" uuid,
	"order_id" uuid NOT NULL,
	"discount_cents" bigint NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"percent" text,
	"flat_cents" bigint,
	"min_cart_cents" bigint,
	"max_cart_cents" bigint,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"hours_start" text,
	"hours_end" text,
	"usage_limit" integer,
	"per_customer_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "coupons_kind" CHECK ("coupons"."kind" in ('percent', 'flat'))
);
--> statement-breakpoint
CREATE TABLE "customer_account_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"order_id" uuid,
	"user_id" uuid,
	"note" text,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_account_entries_op" CHECK ("customer_account_entries"."operation" in ('add', 'deduct', 'refund', 'payment')),
	CONSTRAINT "customer_account_entries_pos" CHECK ("customer_account_entries"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"line1" text,
	"line2" text,
	"city" text,
	"region" text,
	"postcode" text,
	"country" text,
	"phone" text,
	"email" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "customer_addresses_kind" CHECK ("customer_addresses"."kind" in ('billing', 'shipping'))
);
--> statement-breakpoint
CREATE TABLE "customer_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"reward_program_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_reward_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"points" numeric(18, 5) NOT NULL,
	"order_id" uuid,
	"note" text,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text,
	"phone" text,
	"group_id" uuid,
	"credit_limit_cents" bigint DEFAULT 0 NOT NULL,
	"birth_date" date,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_programs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target_points" numeric(18, 5) NOT NULL,
	"coupon_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"program_id" uuid NOT NULL,
	"from_cents" bigint NOT NULL,
	"to_cents" bigint NOT NULL,
	"points" numeric(18, 5) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "held_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"payload" jsonb NOT NULL,
	"total_cents_at_hold" bigint NOT NULL,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_coupons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"coupon_id" uuid NOT NULL,
	"code" text NOT NULL,
	"discount_cents" bigint NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_instalments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line_taxes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_line_id" uuid NOT NULL,
	"tax_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(9, 6) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"unit_name" text,
	"qty" numeric(18, 5) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"unit_cost_cents" bigint,
	"tax_mode" text NOT NULL,
	"tax_group_id" uuid,
	"base_cents" bigint NOT NULL,
	"line_discount_cents" bigint DEFAULT 0 NOT NULL,
	"cart_discount_cents" bigint DEFAULT 0 NOT NULL,
	"coupon_discount_cents" bigint DEFAULT 0 NOT NULL,
	"net_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"gross_cents" bigint NOT NULL,
	"note" text,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_type_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tendered_cents" bigint NOT NULL,
	"change_cents" bigint DEFAULT 0 NOT NULL,
	"reference" text,
	"register_session_id" uuid,
	"instalment_id" uuid,
	"user_id" uuid,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_payments_kind" CHECK ("order_payments"."kind" in ('cash', 'electronic', 'account'))
);
--> statement-breakpoint
CREATE TABLE "order_state" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"payment_status" text,
	"process_status" text,
	"delivery_status" text,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_status_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"user_id" uuid,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_events_field" CHECK ("order_status_events"."field" in ('payment', 'process', 'delivery'))
);
--> statement-breakpoint
CREATE TABLE "order_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"needs_address" boolean DEFAULT false NOT NULL,
	"needs_table_label" boolean DEFAULT false NOT NULL,
	"allows_shipping" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number_seq" integer NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid,
	"order_type_id" uuid,
	"cashier_user_id" uuid,
	"register_session_id" uuid,
	"table_label" text,
	"note" text,
	"note_on_receipt" boolean DEFAULT false NOT NULL,
	"shipping_address" jsonb,
	"currency" text NOT NULL,
	"rounding_mode" text NOT NULL,
	"base_cents" bigint NOT NULL,
	"line_discount_cents" bigint DEFAULT 0 NOT NULL,
	"cart_discount_cents" bigint DEFAULT 0 NOT NULL,
	"coupon_discount_cents" bigint DEFAULT 0 NOT NULL,
	"net_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"shipping_cents" bigint DEFAULT 0 NOT NULL,
	"gross_cents" bigint NOT NULL,
	"cash_rounding_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"held_from_id" uuid,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_device_seq" UNIQUE("device_id","number_seq")
);
--> statement-breakpoint
CREATE TABLE "payment_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid,
	"sort_position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "payment_types_kind" CHECK ("payment_types"."kind" in ('cash', 'electronic', 'account'))
);
--> statement-breakpoint
CREATE TABLE "refund_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"refund_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"qty" numeric(18, 5) NOT NULL,
	"gross_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"tax_parts" jsonb NOT NULL,
	"condition" text NOT NULL,
	"restock" boolean NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_lines_condition" CHECK ("refund_lines"."condition" in ('good', 'damaged'))
);
--> statement-breakpoint
CREATE TABLE "refund_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"refund_id" uuid NOT NULL,
	"payment_type_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"reason" text,
	"user_id" uuid,
	"register_session_id" uuid,
	"gross_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"shipping_cents" bigint DEFAULT 0 NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "register_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"order_id" uuid,
	"payment_id" uuid,
	"user_id" uuid,
	"note" text,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "register_entries_kind" CHECK ("register_entries"."kind" in ('opening', 'closing', 'cash_in', 'cash_out', 'sale', 'change', 'refund', 'account_pay'))
);
--> statement-breakpoint
CREATE TABLE "register_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"register_id" uuid NOT NULL,
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_float_cents" bigint DEFAULT 0 NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"counted_cents" bigint,
	"expected_cents" bigint,
	"difference_cents" bigint,
	"status" text DEFAULT 'open' NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "register_sessions_status" CHECK ("register_sessions"."status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "registers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'closed' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "registers_status" CHECK ("registers"."status" in ('closed', 'opened', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"system_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "accounts_kind" CHECK ("accounts"."kind" in ('asset', 'liability', 'equity', 'income', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "day_balances" (
	"day" date PRIMARY KEY NOT NULL,
	"opening_cents" bigint DEFAULT 0 NOT NULL,
	"income_cents" bigint DEFAULT 0 NOT NULL,
	"expense_cents" bigint DEFAULT 0 NOT NULL,
	"closing_cents" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expense_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"pattern_value" integer,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"last_run_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "expense_schedules_pattern" CHECK ("expense_schedules"."pattern" in ('month_start', 'month_middle', 'month_end', 'day_of_month', 'every_x_days', 'every_x_hours', 'every_x_minutes', 'once'))
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid NOT NULL,
	"payment_account_id" uuid,
	"amount_cents" bigint NOT NULL,
	"kind" text DEFAULT 'direct' NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "expenses_kind" CHECK ("expenses"."kind" in ('direct', 'recurring', 'scheduled'))
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"event" text NOT NULL,
	"rule_id" uuid,
	"posted_at" text,
	"memo" text,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_one_side" CHECK (("journal_lines"."debit_cents" > 0 and "journal_lines"."credit_cents" = 0) or ("journal_lines"."credit_cents" > 0 and "journal_lines"."debit_cents" = 0))
);
--> statement-breakpoint
CREATE TABLE "month_balances" (
	"month" text PRIMARY KEY NOT NULL,
	"opening_cents" bigint DEFAULT 0 NOT NULL,
	"income_cents" bigint DEFAULT 0 NOT NULL,
	"expense_cents" bigint DEFAULT 0 NOT NULL,
	"closing_cents" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posting_rule_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_id" uuid NOT NULL,
	"account_id" uuid,
	"dynamic_role" text,
	"effect" text NOT NULL,
	"amount_source" text NOT NULL,
	"sort_position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL,
	CONSTRAINT "posting_rule_lines_effect" CHECK ("posting_rule_lines"."effect" in ('debit', 'credit'))
);
--> statement-breakpoint
CREATE TABLE "posting_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"name" text NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_device" uuid NOT NULL
);
--> statement-breakpoint
CREATE INDEX "outbox_origin_seq" ON "outbox" USING btree ("origin","seq");--> statement-breakpoint
CREATE INDEX "audit_log_created" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "role_permissions_role" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_roles_user" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_username" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "bundle_items_bundle" ON "bundle_items" USING btree ("bundle_product_id");--> statement-breakpoint
CREATE INDEX "product_units_product" ON "product_units" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_units_barcode" ON "product_units" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "products_sku" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_category" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_name" ON "products" USING btree ("name");--> statement-breakpoint
CREATE INDEX "tax_group_taxes_group" ON "tax_group_taxes" USING btree ("tax_group_id");--> statement-breakpoint
CREATE INDEX "units_group" ON "units" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "stock_adjustment_lines_adj" ON "stock_adjustment_lines" USING btree ("adjustment_id");--> statement-breakpoint
CREATE INDEX "stock_movements_unit" ON "stock_movements" USING btree ("product_unit_id");--> statement-breakpoint
CREATE INDEX "stock_movements_ref" ON "stock_movements" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "procurement_lines_proc" ON "procurement_lines" USING btree ("procurement_id");--> statement-breakpoint
CREATE INDEX "procurement_payments_proc" ON "procurement_payments" USING btree ("procurement_id");--> statement-breakpoint
CREATE INDEX "procurements_provider" ON "procurements" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "purchase_price_history_unit" ON "purchase_price_history" USING btree ("product_unit_id","created_at");--> statement-breakpoint
CREATE INDEX "coupon_scopes_coupon" ON "coupon_scopes" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "coupon_uses_coupon" ON "coupon_uses" USING btree ("coupon_id");--> statement-breakpoint
CREATE INDEX "coupons_code" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "customer_account_entries_customer" ON "customer_account_entries" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_reward_entries_customer" ON "customer_reward_entries" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customers_phone" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "customers_email" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_name" ON "customers" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "order_instalments_order" ON "order_instalments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_line_taxes_line" ON "order_line_taxes" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "order_lines_order" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_product" ON "order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_payments_order" ON "order_payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_events_order" ON "order_status_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_created" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_customer" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_number" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "refund_lines_refund" ON "refund_lines" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "refund_lines_line" ON "refund_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "refunds_order" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "register_entries_session" ON "register_entries" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "register_sessions_register" ON "register_sessions" USING btree ("register_id");--> statement-breakpoint
CREATE INDEX "journal_entries_source" ON "journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "journal_lines_entry" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "posting_rule_lines_rule" ON "posting_rule_lines" USING btree ("rule_id");