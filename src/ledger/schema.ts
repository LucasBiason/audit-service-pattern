/**
 * Double-entry ledger schema.
 *
 * Every financial movement is recorded as TWO entries:
 *  - A DEBIT on one account
 *  - A CREDIT on another account
 *
 * The fundamental equation must always hold: SUM(debits) == SUM(credits)
 *
 * Accounts:
 *   RECEIVABLE - money owed by users (asset)
 *   REVENUE    - income recognized (revenue)
 *   ESCROW     - funds held pending transfer (liability)
 *   PAYOUT     - funds disbursed to parties (expense)
 */
import { Pool } from 'pg';

export async function initLedger(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      type        TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'revenue', 'expense')),
      balance     NUMERIC(20, 8) NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Insert standard accounts (idempotent)
  await pool.query(`
    INSERT INTO accounts (name, type) VALUES
      ('RECEIVABLE', 'asset'),
      ('ESCROW',     'liability'),
      ('REVENUE',    'revenue'),
      ('PAYOUT',     'expense')
    ON CONFLICT (name) DO NOTHING
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id              BIGSERIAL PRIMARY KEY,
      transaction_id  UUID NOT NULL,
      entry_type      TEXT NOT NULL CHECK (entry_type IN ('debit', 'credit')),
      account_name    TEXT NOT NULL REFERENCES accounts(name),
      amount          NUMERIC(20, 8) NOT NULL CHECK (amount > 0),
      description     TEXT,
      source_event_id UUID,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ledger_entries_tx_idx ON ledger_entries (transaction_id);
    CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries (account_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS ledger_entries_event_idx ON ledger_entries (source_event_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id          BIGSERIAL PRIMARY KEY,
      event_id    UUID NOT NULL UNIQUE,
      event_type  TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload     JSONB NOT NULL,
      processed_at TIMESTAMPTZ DEFAULT NOW(),
      status      TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed', 'skipped', 'error')),
      error_msg   TEXT
    )
  `);
}
