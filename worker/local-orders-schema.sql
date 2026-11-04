CREATE TABLE IF NOT EXISTS order_payment_environments (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
 payment_id TEXT, received_at TEXT, recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_local_groups (
 id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
 order_id TEXT, purpose TEXT NOT NULL, recipient_jid TEXT NOT NULL, preview INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_local_outbox (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES wa_local_groups(id), position INTEGER NOT NULL,
 payload_json TEXT NOT NULL, state TEXT NOT NULL, lease_token TEXT, lease_until TEXT,
 remote_message_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(group_id,position)
);
CREATE INDEX IF NOT EXISTS idx_local_outbox_state ON wa_local_outbox(state,created_at);
CREATE INDEX IF NOT EXISTS idx_local_outbox_remote ON wa_local_outbox(remote_message_id);
CREATE INDEX IF NOT EXISTS idx_local_group_order ON wa_local_groups(order_id,purpose);
CREATE TABLE IF NOT EXISTS wa_local_preview_replies (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES wa_local_groups(id), kind TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_local_reply_receipts (
 id TEXT PRIMARY KEY, state TEXT NOT NULL, order_id TEXT, received_at TEXT NOT NULL
);
-- Private supplier billing evidence. No bank transfer is initiated by this table or its collector.
CREATE TABLE IF NOT EXISTS supplier_billing_messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 inbound_message_id TEXT NOT NULL UNIQUE, order_id TEXT REFERENCES orders(id),
 supplier_id TEXT, supplier_phone TEXT NOT NULL, fingerprint TEXT NOT NULL,
 linked INTEGER NOT NULL CHECK(linked IN (0,1)), format_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('collecting','needs_reference','needs_details','ready_for_check')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_billing_order ON supplier_billing_messages(order_id,supplier_id,seq);
CREATE TABLE IF NOT EXISTS supplier_cost_policy_approvals (
 policy_version TEXT PRIMARY KEY, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_shared_cost_scope (
 policy_version TEXT NOT NULL, supplier_id TEXT NOT NULL REFERENCES supplier_directory(id) ON DELETE CASCADE,
 supplier_phone TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(policy_version,supplier_id)
);
CREATE TABLE IF NOT EXISTS supplier_order_cost_references (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), policy_version TEXT NOT NULL,
 reference_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_payout_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
 security_confirmed INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO supplier_payout_settings(id,enabled,security_confirmed,updated_at) VALUES(1,0,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS supplier_payout_profiles (
 supplier_id TEXT PRIMARY KEY REFERENCES supplier_directory(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, profile_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_payout_checks (
 billing_id TEXT PRIMARY KEY REFERENCES supplier_billing_messages(id), reason TEXT NOT NULL,
 next_check_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_payout_lock (
 id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, lease_until TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_payout_intents (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
 billing_id TEXT NOT NULL UNIQUE REFERENCES supplier_billing_messages(id), supplier_id TEXT NOT NULL,
 supplier_phone TEXT NOT NULL, profile_revision INTEGER NOT NULL, reference_json TEXT NOT NULL,
 audit_json TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 reserved_cents INTEGER NOT NULL CHECK(reserved_cents>=amount_cents), receiver_document TEXT NOT NULL,
 state TEXT NOT NULL, transaction_id TEXT UNIQUE, bank_status TEXT, actual_fee_cents INTEGER,
 actual_net_cents INTEGER, actual_result_brl TEXT,
 authorization_at TEXT, receipt_url TEXT, receipt_group_id TEXT, last_error TEXT, next_poll_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_payout_state ON supplier_payout_intents(state,updated_at);
CREATE TABLE IF NOT EXISTS supplier_paid_order_records (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), source TEXT NOT NULL CHECK(source IN ('manual','executor')),
 reference_id TEXT, recorded_at TEXT NOT NULL
);
INSERT OR IGNORE INTO supplier_paid_order_records(order_id,source,recorded_at)
 SELECT j.order_id,'manual',j.updated_at FROM supplier_jobs j WHERE j.status='supplier_paid'
 AND NOT EXISTS(SELECT 1 FROM supplier_payout_intents p WHERE p.order_id=j.order_id);
