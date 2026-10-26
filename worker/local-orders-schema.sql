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
