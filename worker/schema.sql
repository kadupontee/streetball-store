CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL,updated_at TEXT NOT NULL,status TEXT NOT NULL,
 name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,cpf TEXT NOT NULL,
 zip TEXT NOT NULL,address TEXT NOT NULL,city TEXT NOT NULL,state TEXT NOT NULL,
 items_json TEXT NOT NULL,subtotal REAL NOT NULL,shipping REAL NOT NULL,total REAL NOT NULL,
 payment_id TEXT UNIQUE,payment_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status,created_at);
CREATE TABLE IF NOT EXISTS order_payment_environments (
 order_id TEXT PRIMARY KEY REFERENCES orders(id), environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
 payment_id TEXT, received_at TEXT, recorded_at TEXT NOT NULL
);
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

-- Cadastro administrativo dos fornecedores (sem telefone: contatos WhatsApp ficam em segredo)
CREATE TABLE IF NOT EXISTS supplier_directory (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Associação individual por ID estável, independente dos imports de imagens/catálogo
CREATE TABLE IF NOT EXISTS supplier_product_map (
  product_id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES supplier_directory(id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_product_supplier ON supplier_product_map(supplier_id);

-- Histórico de tentativas de compra no catálogo compartilhado.
-- Nunca registra dados sensíveis, pagamentos ou mensagens completas do comprador.
CREATE TABLE IF NOT EXISTS supplier_attempts (
 order_id TEXT NOT NULL REFERENCES orders(id),
 supplier_id TEXT NOT NULL,
 state TEXT NOT NULL,
 message_id TEXT,
 last_response TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(order_id,supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_attempts_order_state ON supplier_attempts(order_id,state);

-- Telefones de fornecedores ficam no D1 e nunca no catálogo público nem no GitHub.
CREATE TABLE IF NOT EXISTS supplier_contacts (
 supplier_id TEXT PRIMARY KEY REFERENCES supplier_directory(id),
 phone_e164 TEXT NOT NULL,
 authorized INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);

-- Ordem de consulta (rank 1 = primeira opção); migração idempotente.
CREATE TABLE IF NOT EXISTS supplier_priority (
 supplier_id TEXT PRIMARY KEY REFERENCES supplier_directory(id),
 rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 5),
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_priority_rank ON supplier_priority(rank);

-- Consentimento opcional e comprovável para atualizações de pedido via WhatsApp.
CREATE TABLE IF NOT EXISTS buyer_message_optin (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 consented_at TEXT NOT NULL
);

-- Registro único de aviso de atraso, separado da notificação de preparação.
CREATE TABLE IF NOT EXISTS buyer_delay_notifications (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 state TEXT NOT NULL,
 message_id TEXT,
 error TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);

-- Evidências confirmadas de rastreamento; não altera estado financeiro do pedido.
CREATE TABLE IF NOT EXISTS order_tracking_events (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES orders(id),
 stage TEXT NOT NULL,
 evidence_source TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_tracking_events_order ON order_tracking_events(order_id,created_at);
CREATE TABLE IF NOT EXISTS order_tracking_meta (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 carrier TEXT NOT NULL DEFAULT '',
 tracking_code TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL
);

-- Registro da informação tributária aceita no checkout, sem modificar pedidos históricos.
CREATE TABLE IF NOT EXISTS order_import_disclosures (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 accepted_at TEXT NOT NULL,
 policy TEXT NOT NULL
);

-- Contas separadas do cadastro Asaas. Senhas com PBKDF2+salt e sessões opacas.
CREATE TABLE IF NOT EXISTS customer_accounts (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL,
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_sessions (
 token_sha256 TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES customer_accounts(id),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_owner ON customer_sessions(customer_id,expires_at);
CREATE TABLE IF NOT EXISTS customer_order_links (
 customer_id TEXT NOT NULL REFERENCES customer_accounts(id),
 order_id TEXT NOT NULL REFERENCES orders(id),
 linked_at TEXT NOT NULL,
 PRIMARY KEY(customer_id,order_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_order_links_owner ON customer_order_links(customer_id,linked_at);
CREATE TABLE IF NOT EXISTS customer_login_attempts (
 email TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL DEFAULT 0,
 window_started_at TEXT NOT NULL
);

-- Identificador Google (sub) verificado criptograficamente; nunca vincular por e-mail sozinho.
CREATE TABLE IF NOT EXISTS customer_google_identities (
 google_sub TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL UNIQUE REFERENCES customer_accounts(id),
 email_at_link TEXT NOT NULL,
 linked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_google_identities_account ON customer_google_identities(customer_id);

-- Editor visual: versões de layout e correções por ID, independentes da importação.
CREATE TABLE IF NOT EXISTS store_editor_versions (revision INTEGER PRIMARY KEY, state_json TEXT NOT NULL, published_at TEXT NOT NULL);
