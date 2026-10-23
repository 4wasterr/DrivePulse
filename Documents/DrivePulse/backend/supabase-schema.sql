-- ========================================================================
-- DrivePulse Supabase PostgreSQL Schema
-- Complete DDL for DrivePulse Car Rental Enterprise Platform
-- ========================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. USERS & ACCOUNTS
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client', 'agent', 'mechanic', 'manager')),
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  saved JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  archived_by TEXT,
  archive_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. SESSIONS (Bearer & Cookie Session Tokens)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires);

-- 3. FLEET VEHICLES
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  rate NUMERIC(10, 2) NOT NULL,
  plate TEXT NOT NULL,
  transmission TEXT NOT NULL DEFAULT 'Automatic',
  seats INTEGER NOT NULL DEFAULT 5,
  fuel_type TEXT NOT NULL DEFAULT 'Gasoline',
  tank_capacity INTEGER NOT NULL DEFAULT 50,
  mileage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'On Rental', 'Maintenance', 'Under Inspection', 'Out of Service', 'Decommissioned')),
  decommission_requested BOOLEAN DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. BOOKINGS / RESERVATIONS
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_owner ON bookings(owner_id);

-- 5. DOCUMENTS (Customer Identity & Inspection Uploads)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data BYTEA NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_owner_kind ON documents(owner_id, kind, uploaded_at);
CREATE INDEX IF NOT EXISTS idx_documents_fingerprint ON documents(fingerprint);

-- 6. SUPPORT CONVERSATIONS & TICKETS
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_owner ON tickets(owner_id);

-- 7. FLEET RECORDS (Inspections, Holds, Operational Overrides)
CREATE TABLE IF NOT EXISTS fleet_records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (kind, id)
);

-- 8. RENTAL CONTRACTS & DIGITAL RECEIPTS (Immutable)
CREATE TABLE IF NOT EXISTS rental_documents (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rental_documents_booking ON rental_documents(booking_id);

-- 9. AUDIT LOG (Immutable Compliance & Forensic Trail)
CREATE TABLE IF NOT EXISTS audit_log (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id TEXT,
  actor TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  detail TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 200,
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  alert_type TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_alert_type ON audit_log(alert_type);

-- ========================================================================
-- IMMUTABILITY TRIGGERS (PostgreSQL / Supabase Native Engine)
-- ========================================================================

-- Immutability for audit_log
CREATE OR REPLACE FUNCTION enforce_audit_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_log
FOR EACH ROW EXECUTE FUNCTION enforce_audit_immutability();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_log;
CREATE TRIGGER trg_audit_no_delete
BEFORE DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION enforce_audit_immutability();

-- Immutability for rental_documents
CREATE OR REPLACE FUNCTION enforce_rental_doc_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Issued rental contracts and receipts are legally binding and immutable.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rental_doc_no_update ON rental_documents;
CREATE TRIGGER trg_rental_doc_no_update
BEFORE UPDATE ON rental_documents
FOR EACH ROW EXECUTE FUNCTION enforce_rental_doc_immutability();

DROP TRIGGER IF EXISTS trg_rental_doc_no_delete ON rental_documents;
CREATE TRIGGER trg_rental_doc_no_delete
BEFORE DELETE ON rental_documents
FOR EACH ROW EXECUTE FUNCTION enforce_rental_doc_immutability();

-- ========================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY service_role_all ON users FOR ALL TO service_role USING (true);
CREATE POLICY service_role_docs ON documents FOR ALL TO service_role USING (true);
CREATE POLICY service_role_bookings ON bookings FOR ALL TO service_role USING (true);
CREATE POLICY service_role_rentals ON rental_documents FOR ALL TO service_role USING (true);
CREATE POLICY service_role_audit ON audit_log FOR ALL TO service_role USING (true);

