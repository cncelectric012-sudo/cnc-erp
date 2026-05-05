-- ═══════════════════════════════════════════════════
-- CNC ERP — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════

-- CLIENTS
CREATE TABLE IF NOT EXISTS clients (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL DEFAULT '',
  phone              TEXT DEFAULT '',
  address            TEXT DEFAULT '',
  city               TEXT DEFAULT '',
  contact_person     TEXT DEFAULT '',
  email              TEXT DEFAULT '',
  outstanding_amount NUMERIC DEFAULT 0,
  outstanding_type   TEXT DEFAULT 'Dr',
  total_invoiced     NUMERIC DEFAULT 0,
  total_paid         NUMERIC DEFAULT 0,
  pending_amount     NUMERIC DEFAULT 0,
  avg_payment_days   TEXT DEFAULT 'N/A',
  risk_level         TEXT DEFAULT 'Medium',
  risk_notes         JSONB DEFAULT '[]',
  behavior_summary   TEXT DEFAULT '',
  salesperson        TEXT DEFAULT '',
  salesperson_number TEXT DEFAULT '',
  transactions       JSONB DEFAULT '[]',
  from_date          TEXT DEFAULT '',
  to_date            TEXT DEFAULT '',
  filename           TEXT DEFAULT '',
  source             TEXT DEFAULT 'pdf',
  last_updated       TIMESTAMPTZ DEFAULT NOW()
);

-- PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
  id           BIGSERIAL PRIMARY KEY,
  client_key   TEXT NOT NULL,
  client_name  TEXT NOT NULL DEFAULT '',
  amount       NUMERIC DEFAULT 0,
  date         TEXT DEFAULT '',
  bank         TEXT DEFAULT '',
  txn_id       TEXT DEFAULT '',
  account_no   TEXT DEFAULT '',
  stored_at    TIMESTAMPTZ DEFAULT NOW()
);

-- APPROVALS
CREATE TABLE IF NOT EXISTS approvals (
  invoice_no         TEXT PRIMARY KEY,
  client_name        TEXT NOT NULL DEFAULT '',
  bot_decision       TEXT DEFAULT '',
  discount           NUMERIC DEFAULT 0,
  had_payment        BOOLEAN DEFAULT FALSE,
  payment_total      NUMERIC DEFAULT 0,
  had_ledger         BOOLEAN DEFAULT FALSE,
  ledger_outstanding NUMERIC DEFAULT 0,
  ledger_type        TEXT DEFAULT 'Dr',
  ai_reason          TEXT DEFAULT '',
  doubt_alert        BOOLEAN DEFAULT FALSE,
  overridden         BOOLEAN DEFAULT FALSE,
  owner_action       TEXT DEFAULT '',
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- SALESPERSONS
CREATE TABLE IF NOT EXISTS salespersons (
  client_key         TEXT PRIMARY KEY,
  client_name        TEXT DEFAULT '',
  salesperson        TEXT DEFAULT '',
  salesperson_number TEXT DEFAULT '',
  invoice_count      INT DEFAULT 0,
  payment_count      INT DEFAULT 0,
  first_seen         TIMESTAMPTZ DEFAULT NOW(),
  last_seen          TIMESTAMPTZ DEFAULT NOW()
);

-- COMMITMENTS
CREATE TABLE IF NOT EXISTS commitments (
  invoice_no       TEXT PRIMARY KEY,
  client_name      TEXT DEFAULT '',
  invoice_amount   TEXT DEFAULT '',
  sales_person     TEXT DEFAULT '',
  commitment_text  TEXT DEFAULT '',
  due_date         TIMESTAMPTZ,
  due_date_str     TEXT DEFAULT '',
  alert_sent       BOOLEAN DEFAULT FALSE,
  alerted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Disable RLS (internal tool — enable later when needed)
ALTER TABLE clients     DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments    DISABLE ROW LEVEL SECURITY;
ALTER TABLE approvals   DISABLE ROW LEVEL SECURITY;
ALTER TABLE salespersons DISABLE ROW LEVEL SECURITY;
ALTER TABLE commitments DISABLE ROW LEVEL SECURITY;
