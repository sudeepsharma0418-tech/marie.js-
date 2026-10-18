CREATE TABLE "auth_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"email" text,
	"event" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"hotel_id" uuid,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"role" text NOT NULL,
	"hotel_id" uuid,
	"password_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_enc" text,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_chk" CHECK ("users"."role" in ('owner', 'procurement', 'warehouse', 'driver', 'hotel_manager', 'hotel_purchaser', 'hotel_inventory')),
	CONSTRAINT "users_hotel_scope_chk" CHECK (("users"."role" in ('hotel_manager', 'hotel_purchaser', 'hotel_inventory')) = ("users"."hotel_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"pan" text,
	"vat_number" text,
	"vat_registered" boolean DEFAULT false NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"currency" text DEFAULT 'NPR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kathmandu' NOT NULL,
	"fiscal_year_label" text NOT NULL,
	"default_markup_percent" numeric(7, 3) DEFAULT '15.000' NOT NULL,
	"default_payment_terms_days" integer DEFAULT 15 NOT NULL,
	"po_approval_threshold" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"price_override_threshold_percent" numeric(7, 3) DEFAULT '5.000' NOT NULL,
	"credit_overdue_grace_days" integer DEFAULT 0 NOT NULL,
	"write_off_approval_threshold" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"invoice_trigger" text DEFAULT 'on_delivery' NOT NULL,
	"allow_owner_self_approval" boolean DEFAULT true NOT NULL,
	"mfa_enforced" boolean DEFAULT false NOT NULL,
	"session_hours" integer DEFAULT 12 NOT NULL,
	"offline_access_hours" integer DEFAULT 72 NOT NULL,
	"invoice_footer" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "company_settings_singleton" CHECK ("company_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "document_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"prefix" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rate_percent" numeric(7, 3) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"requires_verification" boolean DEFAULT true NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotel_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"terms_summary" text,
	"attachment_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hotels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"hotel_type" text DEFAULT 'hotel' NOT NULL,
	"pan" text,
	"vat_number" text,
	"address" text NOT NULL,
	"city" text DEFAULT 'Butwal' NOT NULL,
	"district" text DEFAULT 'Rupandehi',
	"phone" text,
	"email" text,
	"primary_contact_name" text,
	"primary_contact_phone" text,
	"delivery_address" text,
	"delivery_instructions" text,
	"delivery_days" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"credit_limit" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"payment_terms_days" integer DEFAULT 15 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"account_manager_id" uuid,
	"require_manager_approval" boolean DEFAULT true NOT NULL,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hotels_code_unique" UNIQUE("code"),
	CONSTRAINT "hotels_type_chk" CHECK ("hotels"."hotel_type" in ('hotel', 'guesthouse', 'resort', 'homestay', 'lodge', 'other')),
	CONSTRAINT "hotels_status_chk" CHECK ("hotels"."status" in ('active', 'on_hold', 'suspended', 'closed')),
	CONSTRAINT "hotels_credit_limit_chk" CHECK ("hotels"."credit_limit" >= 0),
	CONSTRAINT "hotels_terms_chk" CHECK ("hotels"."payment_terms_days" >= 0 and "hotels"."payment_terms_days" <= 365)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ne" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"product_id" uuid,
	"hotel_id" uuid,
	"old_value" text,
	"new_value" text,
	"reason" text,
	"changed_by" uuid NOT NULL,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"hotel_id" uuid,
	"category_id" uuid,
	"product_id" uuid,
	"rule_type" text NOT NULL,
	"value" numeric(14, 3) NOT NULL,
	"valid_from" date DEFAULT current_date NOT NULL,
	"valid_to" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"approval_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_scope_chk" CHECK ("pricing_rules"."scope" in ('default', 'category', 'product', 'hotel', 'hotel_category', 'hotel_product')),
	CONSTRAINT "pricing_rules_value_chk" CHECK ("pricing_rules"."value" >= 0),
	CONSTRAINT "pricing_rules_targets_chk" CHECK ((
        ("pricing_rules"."scope" = 'default' and "pricing_rules"."hotel_id" is null and "pricing_rules"."category_id" is null and "pricing_rules"."product_id" is null) or
        ("pricing_rules"."scope" = 'category' and "pricing_rules"."hotel_id" is null and "pricing_rules"."category_id" is not null and "pricing_rules"."product_id" is null) or
        ("pricing_rules"."scope" = 'product' and "pricing_rules"."hotel_id" is null and "pricing_rules"."category_id" is null and "pricing_rules"."product_id" is not null) or
        ("pricing_rules"."scope" = 'hotel' and "pricing_rules"."hotel_id" is not null and "pricing_rules"."category_id" is null and "pricing_rules"."product_id" is null) or
        ("pricing_rules"."scope" = 'hotel_category' and "pricing_rules"."hotel_id" is not null and "pricing_rules"."category_id" is not null and "pricing_rules"."product_id" is null) or
        ("pricing_rules"."scope" = 'hotel_product' and "pricing_rules"."hotel_id" is not null and "pricing_rules"."category_id" is null and "pricing_rules"."product_id" is not null)
      )),
	CONSTRAINT "pricing_rules_fixed_needs_product_chk" CHECK ("pricing_rules"."rule_type" = 'markup_percent' or "pricing_rules"."scope" in ('product', 'hotel_product'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name_en" text NOT NULL,
	"name_ne" text NOT NULL,
	"description_en" text,
	"description_ne" text,
	"category_id" uuid NOT NULL,
	"brand" text,
	"specifications" text,
	"image_attachment_id" uuid,
	"selling_unit" text NOT NULL,
	"purchase_unit" text NOT NULL,
	"units_per_purchase_unit" numeric(14, 3) DEFAULT '1.000' NOT NULL,
	"reference_cost" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"tax_code" text NOT NULL,
	"min_order_qty" numeric(14, 3) DEFAULT '1.000' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_cost_chk" CHECK ("products"."reference_cost" >= 0),
	CONSTRAINT "products_upu_chk" CHECK ("products"."units_per_purchase_unit" > 0),
	CONSTRAINT "products_moq_chk" CHECK ("products"."min_order_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"phone" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_sku" text,
	"last_unit_cost" numeric(14, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid,
	"product_request_id" uuid,
	"unit_cost" numeric(14, 2) NOT NULL,
	"available_qty" numeric(14, 3),
	"availability_note" text,
	"lead_time_days" integer,
	"valid_until" date,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_quotations_cost_chk" CHECK ("supplier_quotations"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"pan" text,
	"vat_number" text,
	"address" text,
	"city" text,
	"phone" text,
	"email" text,
	"contact_name" text,
	"lead_time_days" integer DEFAULT 1 NOT NULL,
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"terms_notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"name_en" text NOT NULL,
	"name_ne" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text,
	"event" text NOT NULL,
	"note" text,
	"visible_to_hotel" boolean DEFAULT true NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ne" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"price_source" text NOT NULL,
	"tax_code" text NOT NULL,
	"tax_rate" numeric(7, 3) NOT NULL,
	"line_subtotal" numeric(14, 2) NOT NULL,
	"cancelled_qty" numeric(14, 3) DEFAULT '0.000' NOT NULL,
	"selected_supplier_id" uuid,
	"selected_quotation_id" uuid,
	"expected_unit_cost" numeric(14, 2),
	"notes" text,
	CONSTRAINT "order_lines_qty_chk" CHECK ("order_lines"."quantity" > 0),
	CONSTRAINT "order_lines_price_chk" CHECK ("order_lines"."unit_price" >= 0),
	CONSTRAINT "order_lines_cancel_chk" CHECK ("order_lines"."cancelled_qty" >= 0 and "order_lines"."cancelled_qty" <= "order_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"hotel_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"hotel_approved_by" uuid,
	"hotel_approved_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"requested_delivery_date" date,
	"delivery_window" text DEFAULT 'any' NOT NULL,
	"delivery_notes" text,
	"subtotal" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"tax_total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"credit_check" jsonb,
	"cancelled_reason" text,
	"source_request_id" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_status_chk" CHECK ("orders"."status" in ('draft', 'pending_hotel_approval', 'submitted', 'pending_approval', 'approved', 'rejected', 'procurement', 'consolidating', 'ready_for_dispatch', 'dispatched', 'partially_delivered', 'delivered', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "product_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_number" text NOT NULL,
	"hotel_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit" text NOT NULL,
	"specifications" text,
	"attachment_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"quoted_product_id" uuid,
	"quoted_unit_price" numeric(14, 2),
	"response_note" text,
	"converted_order_id" uuid,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_requests_request_number_unique" UNIQUE("request_number"),
	CONSTRAINT "product_requests_status_chk" CHECK ("product_requests"."status" in ('open', 'investigating', 'quoted', 'converted', 'declined', 'withdrawn')),
	CONSTRAINT "product_requests_qty_chk" CHECK ("product_requests"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"po_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_accepted" numeric(14, 3) NOT NULL,
	"qty_damaged" numeric(14, 3) DEFAULT '0.000' NOT NULL,
	"notes" text,
	CONSTRAINT "goods_receipt_lines_qty_chk" CHECK ("goods_receipt_lines"."qty_accepted" >= 0 and "goods_receipt_lines"."qty_damaged" >= 0),
	CONSTRAINT "goods_receipt_lines_nonzero_chk" CHECK ("goods_receipt_lines"."qty_accepted" + "goods_receipt_lines"."qty_damaged" > 0)
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_number" text NOT NULL,
	"po_id" uuid NOT NULL,
	"location" text DEFAULT 'hub' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid NOT NULL,
	"supplier_delivery_note" text,
	"notes" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_receipt_number_unique" UNIQUE("receipt_number"),
	CONSTRAINT "goods_receipts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"order_line_id" uuid,
	"quotation_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 2) NOT NULL,
	"tax_rate" numeric(7, 3) DEFAULT '0.000' NOT NULL,
	"line_subtotal" numeric(14, 2) NOT NULL,
	CONSTRAINT "po_lines_qty_chk" CHECK ("po_lines"."quantity" > 0),
	CONSTRAINT "po_lines_cost_chk" CHECK ("po_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"fulfillment" text DEFAULT 'hub' NOT NULL,
	"direct_hotel_id" uuid,
	"expected_date" date,
	"subtotal" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"tax_total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"notes" text,
	"supplier_reference" text,
	"created_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"approval_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number"),
	CONSTRAINT "purchase_orders_status_chk" CHECK ("purchase_orders"."status" in ('draft', 'pending_approval', 'approved', 'rejected', 'sent', 'confirmed', 'partially_received', 'received', 'closed', 'cancelled')),
	CONSTRAINT "purchase_orders_commit_needs_approval_chk" CHECK (not ("purchase_orders"."status" in ('sent', 'confirmed', 'partially_received', 'received', 'closed')) or ("purchase_orders"."approved_at" is not null and "purchase_orders"."approved_by" is not null)),
	CONSTRAINT "purchase_orders_direct_chk" CHECK (("purchase_orders"."fulfillment" = 'direct') = ("purchase_orders"."direct_hotel_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_number" text NOT NULL,
	"run_id" uuid,
	"order_id" uuid NOT NULL,
	"hotel_id" uuid NOT NULL,
	"direct_po_id" uuid,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"stop_order" text,
	"instructions" text,
	"dispatched_at" timestamp with time zone,
	"dispatched_by" uuid,
	"delivered_at" timestamp with time zone,
	"confirmed_by" uuid,
	"recipient_name" text,
	"recipient_phone" text,
	"signature_attachment_id" uuid,
	"photo_attachment_id" uuid,
	"failure_reason" text,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_delivery_number_unique" UNIQUE("delivery_number"),
	CONSTRAINT "deliveries_status_chk" CHECK ("deliveries"."status" in ('scheduled', 'dispatched', 'delivered', 'partially_delivered', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "delivery_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_dispatched" numeric(14, 3) NOT NULL,
	"qty_delivered" numeric(14, 3),
	"qty_damaged" numeric(14, 3) DEFAULT '0.000' NOT NULL,
	"qty_missing" numeric(14, 3) DEFAULT '0.000' NOT NULL,
	"qty_returned" numeric(14, 3) DEFAULT '0.000' NOT NULL,
	"notes" text,
	CONSTRAINT "delivery_lines_dispatched_chk" CHECK ("delivery_lines"."qty_dispatched" > 0),
	CONSTRAINT "delivery_lines_balance_chk" CHECK ("delivery_lines"."qty_delivered" is null or ("delivery_lines"."qty_delivered" >= 0 and "delivery_lines"."qty_delivered" + "delivery_lines"."qty_damaged" + "delivery_lines"."qty_missing" + "delivery_lines"."qty_returned" = "delivery_lines"."qty_dispatched"))
);
--> statement-breakpoint
CREATE TABLE "delivery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_number" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"window_start" time,
	"window_end" time,
	"driver_id" uuid,
	"vehicle" text,
	"route_notes" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_runs_run_number_unique" UNIQUE("run_number")
);
--> statement-breakpoint
CREATE TABLE "hotel_inventory_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hotel_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"action" text NOT NULL,
	"quantity" numeric(14, 3),
	"counted_qty" numeric(14, 3),
	"base_qty" numeric(14, 3),
	"to_location_id" uuid,
	"delivery_id" uuid,
	"reason" text,
	"actor_id" uuid NOT NULL,
	"device_id" text,
	"source" text NOT NULL,
	"client_recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text
);
--> statement-breakpoint
CREATE TABLE "hotel_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"qr_token" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hotel_locations_qr_token_unique" UNIQUE("qr_token"),
	CONSTRAINT "hotel_locations_qr_chk" CHECK (("hotel_locations"."kind" = 'shelf') = ("hotel_locations"."qr_token" is not null))
);
--> statement-breakpoint
CREATE TABLE "hotel_stock_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"hotel_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"event_id" uuid,
	"actor_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hotel_movements_type_chk" CHECK ("hotel_stock_movements"."movement_type" in ('opening', 'usage', 'restock', 'correction', 'transfer_out', 'transfer_in'))
);
--> statement-breakpoint
CREATE TABLE "hub_reservations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_reservations_nonzero_chk" CHECK ("hub_reservations"."quantity" <> 0)
);
--> statement-breakpoint
CREATE TABLE "hub_stock_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"receipt_line_id" uuid,
	"delivery_line_id" uuid,
	"order_line_id" uuid,
	"bin" text,
	"reason" text,
	"approval_id" uuid,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_movements_type_chk" CHECK ("hub_stock_movements"."movement_type" in ('receipt', 'dispatch', 'delivery_return', 'return_to_supplier', 'adjustment', 'write_off')),
	CONSTRAINT "hub_movements_nonzero_chk" CHECK ("hub_stock_movements"."quantity" <> 0),
	CONSTRAINT "hub_movements_sign_chk" CHECK (("hub_stock_movements"."movement_type" in ('receipt', 'delivery_return') and "hub_stock_movements"."quantity" > 0)
        or ("hub_stock_movements"."movement_type" in ('dispatch', 'return_to_supplier', 'write_off') and "hub_stock_movements"."quantity" < 0)
        or "hub_stock_movements"."movement_type" = 'adjustment')
);
--> statement-breakpoint
CREATE TABLE "shelf_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hotel_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"default_usage_qty" numeric(14, 3) DEFAULT '1.000' NOT NULL,
	"min_qty" numeric(14, 3) DEFAULT '0.000' NOT NULL,
	"par_qty" numeric(14, 3),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shelf_products_usage_chk" CHECK ("shelf_products"."default_usage_qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_id" uuid NOT NULL,
	"invoice_line_id" uuid,
	"description_en" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"tax_rate" numeric(7, 3) NOT NULL,
	"taxable_amount" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_note_number" text,
	"hotel_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"note_date" date,
	"fiscal_year" text,
	"taxable_total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"tax_total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"seller_snapshot" jsonb,
	"customer_snapshot" jsonb,
	"created_by" uuid NOT NULL,
	"issued_by" uuid,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_credit_note_number_unique" UNIQUE("credit_note_number"),
	CONSTRAINT "credit_notes_issued_chk" CHECK ("credit_notes"."status" <> 'issued' or ("credit_notes"."credit_note_number" is not null and "credit_notes"."note_date" is not null))
);
--> statement-breakpoint
CREATE TABLE "financial_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text NOT NULL,
	"hotel_id" uuid,
	"supplier_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"approval_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"order_line_id" uuid,
	"delivery_line_id" uuid,
	"product_id" uuid,
	"description_en" text NOT NULL,
	"description_ne" text,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"tax_code" text NOT NULL,
	"tax_rate" numeric(7, 3) NOT NULL,
	"taxable_amount" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	CONSTRAINT "invoice_lines_qty_chk" CHECK ("invoice_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text,
	"hotel_id" uuid NOT NULL,
	"order_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"fiscal_year" text,
	"invoice_date" date,
	"due_date" date,
	"taxable_total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"exempt_total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"tax_total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"seller_snapshot" jsonb,
	"customer_snapshot" jsonb,
	"notes" text,
	"created_by" uuid NOT NULL,
	"issued_by" uuid,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_issued_fields_chk" CHECK ("invoices"."status" <> 'issued' or ("invoices"."invoice_number" is not null and "invoices"."invoice_date" is not null and "invoices"."due_date" is not null and "invoices"."issued_at" is not null)),
	CONSTRAINT "invoices_total_chk" CHECK ("invoices"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entry_date" date NOT NULL,
	"account" text NOT NULL,
	"party_type" text NOT NULL,
	"party_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"reference" text,
	"debit" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"memo" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_amounts_chk" CHECK ("ledger_entries"."debit" >= 0 and "ledger_entries"."credit" >= 0 and ("ledger_entries"."debit" > 0) <> ("ledger_entries"."credit" > 0)),
	CONSTRAINT "ledger_party_chk" CHECK (("ledger_entries"."account" = 'accounts_receivable' and "ledger_entries"."party_type" = 'hotel') or ("ledger_entries"."account" = 'accounts_payable' and "ledger_entries"."party_type" = 'supplier'))
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid,
	"bill_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "payment_allocations_amount_chk" CHECK ("payment_allocations"."amount" > 0),
	CONSTRAINT "payment_allocations_target_chk" CHECK (("payment_allocations"."invoice_id" is null) <> ("payment_allocations"."bill_id" is null))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_number" text NOT NULL,
	"direction" text NOT NULL,
	"hotel_id" uuid,
	"supplier_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"payment_date" date NOT NULL,
	"notes" text,
	"attachment_id" uuid,
	"status" text DEFAULT 'recorded' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"reversed_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_payment_number_unique" UNIQUE("payment_number"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_chk" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_method_chk" CHECK ("payments"."method" in ('bank_transfer', 'cash', 'cheque', 'mobile_wallet', 'other')),
	CONSTRAINT "payments_party_chk" CHECK (("payments"."direction" = 'inbound' and "payments"."hotel_id" is not null and "payments"."supplier_id" is null)
        or ("payments"."direction" = 'outbound' and "payments"."supplier_id" is not null and "payments"."hotel_id" is null))
);
--> statement-breakpoint
CREATE TABLE "supplier_bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"po_line_id" uuid,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 2) NOT NULL,
	"tax_rate" numeric(7, 3) NOT NULL,
	"taxable_amount" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internal_ref" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_bill_number" text NOT NULL,
	"po_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"bill_date" date NOT NULL,
	"due_date" date NOT NULL,
	"taxable_total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"tax_total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0.00' NOT NULL,
	"attachment_id" uuid,
	"notes" text,
	"created_by" uuid NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_bills_internal_ref_unique" UNIQUE("internal_ref"),
	CONSTRAINT "supplier_bills_due_chk" CHECK ("supplier_bills"."due_date" >= "supplier_bills"."bill_date")
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"hotel_id" uuid,
	"amount" numeric(14, 2),
	"summary" text NOT NULL,
	"details" jsonb,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "approval_requests_type_chk" CHECK ("approval_requests"."type" in ('purchase_order', 'credit_order', 'credit_limit_change', 'price_override', 'stock_write_off', 'financial_adjustment', 'payment_reversal'))
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"hotel_id" uuid,
	"internal_only" boolean DEFAULT true NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "attachments_category_chk" CHECK ("attachments"."category" in ('contract', 'product_image', 'request_photo', 'delivery_evidence', 'payment_proof', 'supplier_bill', 'invoice_pdf', 'other'))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"hotel_id" uuid,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"request_id" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_contracts" ADD CONSTRAINT "hotel_contracts_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_contracts" ADD CONSTRAINT "hotel_contracts_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_contracts" ADD CONSTRAINT "hotel_contracts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_image_attachment_id_attachments_id_fk" FOREIGN KEY ("image_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_selling_unit_units_code_fk" FOREIGN KEY ("selling_unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_purchase_unit_units_code_fk" FOREIGN KEY ("purchase_unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_code_tax_rates_code_fk" FOREIGN KEY ("tax_code") REFERENCES "public"."tax_rates"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_unit_units_code_fk" FOREIGN KEY ("unit") REFERENCES "public"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_selected_supplier_id_suppliers_id_fk" FOREIGN KEY ("selected_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_selected_quotation_id_supplier_quotations_id_fk" FOREIGN KEY ("selected_quotation_id") REFERENCES "public"."supplier_quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_hotel_approved_by_users_id_fk" FOREIGN KEY ("hotel_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_quoted_product_id_products_id_fk" FOREIGN KEY ("quoted_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_converted_order_id_orders_id_fk" FOREIGN KEY ("converted_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_requests" ADD CONSTRAINT "product_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_id_po_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."po_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_quotation_id_supplier_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."supplier_quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_direct_hotel_id_hotels_id_fk" FOREIGN KEY ("direct_hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_run_id_delivery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."delivery_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_direct_po_id_purchase_orders_id_fk" FOREIGN KEY ("direct_po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_signature_attachment_id_attachments_id_fk" FOREIGN KEY ("signature_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_photo_attachment_id_attachments_id_fk" FOREIGN KEY ("photo_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_runs" ADD CONSTRAINT "delivery_runs_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_runs" ADD CONSTRAINT "delivery_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_inventory_events" ADD CONSTRAINT "hotel_inventory_events_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_inventory_events" ADD CONSTRAINT "hotel_inventory_events_location_id_hotel_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hotel_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_inventory_events" ADD CONSTRAINT "hotel_inventory_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_inventory_events" ADD CONSTRAINT "hotel_inventory_events_to_location_id_hotel_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."hotel_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_inventory_events" ADD CONSTRAINT "hotel_inventory_events_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_inventory_events" ADD CONSTRAINT "hotel_inventory_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_inventory_events" ADD CONSTRAINT "hotel_inventory_events_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_locations" ADD CONSTRAINT "hotel_locations_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_locations" ADD CONSTRAINT "hotel_locations_parent_id_hotel_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."hotel_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_stock_movements" ADD CONSTRAINT "hotel_stock_movements_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_stock_movements" ADD CONSTRAINT "hotel_stock_movements_location_id_hotel_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hotel_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_stock_movements" ADD CONSTRAINT "hotel_stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_stock_movements" ADD CONSTRAINT "hotel_stock_movements_event_id_hotel_inventory_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."hotel_inventory_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_stock_movements" ADD CONSTRAINT "hotel_stock_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_reservations" ADD CONSTRAINT "hub_reservations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_reservations" ADD CONSTRAINT "hub_reservations_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_reservations" ADD CONSTRAINT "hub_reservations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_stock_movements" ADD CONSTRAINT "hub_stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_stock_movements" ADD CONSTRAINT "hub_stock_movements_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_stock_movements" ADD CONSTRAINT "hub_stock_movements_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_stock_movements" ADD CONSTRAINT "hub_stock_movements_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_stock_movements" ADD CONSTRAINT "hub_stock_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_products" ADD CONSTRAINT "shelf_products_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_products" ADD CONSTRAINT "shelf_products_location_id_hotel_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hotel_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelf_products" ADD CONSTRAINT "shelf_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_adjustments" ADD CONSTRAINT "financial_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_delivery_line_id_delivery_lines_id_fk" FOREIGN KEY ("delivery_line_id") REFERENCES "public"."delivery_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bill_id_supplier_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."supplier_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_bill_id_supplier_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."supplier_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_po_line_id_po_lines_id_fk" FOREIGN KEY ("po_line_id") REFERENCES "public"."po_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bill_lines" ADD CONSTRAINT "supplier_bill_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_hotel_id_hotels_id_fk" FOREIGN KEY ("hotel_id") REFERENCES "public"."hotels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_events_user_idx" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_hotel_idx" ON "users" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_series_uq" ON "document_series" USING btree ("doc_type","fiscal_year");--> statement-breakpoint
CREATE UNIQUE INDEX "hotel_contracts_version_uq" ON "hotel_contracts" USING btree ("hotel_id","title","version");--> statement-breakpoint
CREATE INDEX "hotel_contracts_hotel_idx" ON "hotel_contracts" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "price_history_product_idx" ON "price_history" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "pricing_rules_lookup_idx" ON "pricing_rules" USING btree ("scope","hotel_id","category_id","product_id");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_name_en_idx" ON "products" USING btree ("name_en");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_products_uq" ON "supplier_products" USING btree ("supplier_id","product_id");--> statement-breakpoint
CREATE INDEX "supplier_quotations_product_idx" ON "supplier_quotations" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_quotations_order_idx" ON "supplier_quotations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_no_uq" ON "order_lines" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE INDEX "order_lines_product_idx" ON "order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "orders_hotel_idx" ON "orders" USING btree ("hotel_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_uq" ON "orders" USING btree ("hotel_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "product_requests_hotel_idx" ON "product_requests" USING btree ("hotel_id","created_at");--> statement-breakpoint
CREATE INDEX "goods_receipt_lines_po_line_idx" ON "goods_receipt_lines" USING btree ("po_line_id");--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("po_id");--> statement-breakpoint
CREATE UNIQUE INDEX "po_lines_no_uq" ON "po_lines" USING btree ("po_id","line_no");--> statement-breakpoint
CREATE INDEX "po_lines_order_line_idx" ON "po_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deliveries_order_idx" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_run_idx" ON "deliveries" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "deliveries_hotel_idx" ON "deliveries" USING btree ("hotel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_lines_uq" ON "delivery_lines" USING btree ("delivery_id","order_line_id");--> statement-breakpoint
CREATE INDEX "delivery_runs_date_idx" ON "delivery_runs" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "delivery_runs_driver_idx" ON "delivery_runs" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "hotel_inventory_events_hotel_idx" ON "hotel_inventory_events" USING btree ("hotel_id","received_at");--> statement-breakpoint
CREATE INDEX "hotel_inventory_events_status_idx" ON "hotel_inventory_events" USING btree ("hotel_id","status");--> statement-breakpoint
CREATE INDEX "hotel_locations_hotel_idx" ON "hotel_locations" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "hotel_movements_balance_idx" ON "hotel_stock_movements" USING btree ("hotel_id","location_id","product_id");--> statement-breakpoint
CREATE INDEX "hub_reservations_line_idx" ON "hub_reservations" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "hub_reservations_product_idx" ON "hub_reservations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "hub_movements_product_idx" ON "hub_stock_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shelf_products_uq" ON "shelf_products" USING btree ("location_id","product_id");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_no_uq" ON "invoice_lines" USING btree ("invoice_id","line_no");--> statement-breakpoint
CREATE INDEX "invoice_lines_order_line_idx" ON "invoice_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "invoices_hotel_idx" ON "invoices" USING btree ("hotel_id","status");--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "invoices" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_source_uq" ON "ledger_entries" USING btree ("source_type","source_id","account");--> statement-breakpoint
CREATE INDEX "ledger_party_idx" ON "ledger_entries" USING btree ("party_type","party_id","entry_date");--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_bill_idx" ON "payment_allocations" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_uq" ON "payments" USING btree ("direction",coalesce("hotel_id", "supplier_id"),"method",lower("reference")) WHERE "payments"."reference" is not null and "payments"."status" = 'recorded';--> statement-breakpoint
CREATE INDEX "payments_hotel_idx" ON "payments" USING btree ("hotel_id");--> statement-breakpoint
CREATE INDEX "payments_supplier_idx" ON "payments" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_bills_number_uq" ON "supplier_bills" USING btree ("supplier_id","supplier_bill_number");--> statement-breakpoint
CREATE INDEX "supplier_bills_supplier_idx" ON "supplier_bills" USING btree ("supplier_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_pending_uq" ON "approval_requests" USING btree ("type","target_id") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_time_idx" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");