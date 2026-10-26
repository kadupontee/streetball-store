-- Ponte local em modo de teste: só envia para a própria conta vinculada.
CREATE TABLE IF NOT EXISTS wa_local_bridge (
 id INTEGER PRIMARY KEY CHECK(id=1),
 account_jid TEXT NOT NULL,
 heartbeat_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_local_test_jobs (
 id TEXT PRIMARY KEY,
 state TEXT NOT NULL CHECK(state IN ('pending','claimed','sending','sent','uncertain','expired')),
 lease_token TEXT,
 lease_until TEXT,
 remote_message_id TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_local_test_jobs_state ON wa_local_test_jobs(state,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_local_single_active_test
 ON wa_local_test_jobs((1)) WHERE state IN ('pending','claimed','sending');
