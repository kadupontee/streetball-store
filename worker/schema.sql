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
