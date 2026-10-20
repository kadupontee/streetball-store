CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL,updated_at TEXT NOT NULL,status TEXT NOT NULL,
 name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,cpf TEXT NOT NULL,
 zip TEXT NOT NULL,address TEXT NOT NULL,city TEXT NOT NULL,state TEXT NOT NULL,
 items_json TEXT NOT NULL,subtotal REAL NOT NULL,shipping REAL NOT NULL,total REAL NOT NULL,
 payment_id TEXT UNIQUE,payment_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status,created_at);
CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,received_at TEXT NOT NULL,event_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS supplier_jobs(id TEXT PRIMARY KEY,order_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY (order_id) REFERENCES orders(id));
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON supplier_jobs(status,created_at);

-- Migração aditiva, também segura para bases já existentes.
CREATE TABLE IF NOT EXISTS supplier_dispatch (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_phone TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  responded_at TEXT,
  details_sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_dispatch_sla ON supplier_dispatch(state,sent_at);
CREATE TABLE IF NOT EXISTS wa_message_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS buyer_notifications (
  order_id TEXT PRIMARY KEY REFERENCES orders(id),
  state TEXT NOT NULL,
  message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Não criar cobranças duplicadas quando o navegador repetir o mesmo envio.
CREATE TABLE IF NOT EXISTS checkout_attempts (
  request_key TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  order_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkout_attempt_order ON checkout_attempts(order_id);
