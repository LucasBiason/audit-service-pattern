/**
 * Double-entry ledger operations.
 *
 * Every transaction consists of at least one debit and one credit entry.
 * The sum of debits must equal the sum of credits (invariant enforced here).
 */
import { Pool, PoolClient } from 'pg';
import { v4 as uuid } from 'uuid';

export interface LedgerEntry {
  entryType: 'debit' | 'credit';
  accountName: string;
  amount: number;
  description?: string;
}

export interface Transaction {
  transactionId: string;
  entries: LedgerEntry[];
  sourceEventId?: string;
}

export async function recordTransaction(
  pool: Pool,
  entries: LedgerEntry[],
  sourceEventId?: string
): Promise<string> {
  // Validate double-entry invariant
  const totalDebits = entries
    .filter((e) => e.entryType === 'debit')
    .reduce((sum, e) => sum + e.amount, 0);
  const totalCredits = entries
    .filter((e) => e.entryType === 'credit')
    .reduce((sum, e) => sum + e.amount, 0);

  if (Math.abs(totalDebits - totalCredits) > 0.0001) {
    throw new Error(
      `Double-entry invariant violated: debits=${totalDebits} credits=${totalCredits}`
    );
  }

  const transactionId = uuid();
  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const entry of entries) {
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, entry_type, account_name, amount, description, source_event_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [transactionId, entry.entryType, entry.accountName, entry.amount, entry.description ?? null, sourceEventId ?? null]
      );

      // Update account balance
      const balanceDelta = entry.entryType === 'debit' ? entry.amount : -entry.amount;
      await client.query(
        'UPDATE accounts SET balance = balance + $1 WHERE name = $2',
        [balanceDelta, entry.accountName]
      );
    }

    await client.query('COMMIT');
    return transactionId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getAccountBalance(pool: Pool, accountName: string): Promise<number> {
  const result = await pool.query<{ balance: string }>(
    'SELECT balance FROM accounts WHERE name = $1',
    [accountName]
  );
  if (result.rowCount === 0) throw new Error(`Account not found: ${accountName}`);
  return parseFloat(result.rows[0].balance);
}

export async function verifyInvariant(pool: Pool): Promise<{ balanced: boolean; delta: number }> {
  const result = await pool.query<{ debits: string; credits: string }>(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE entry_type = 'debit'), 0) AS debits,
      COALESCE(SUM(amount) FILTER (WHERE entry_type = 'credit'), 0) AS credits
    FROM ledger_entries
  `);

  const { debits, credits } = result.rows[0];
  const delta = parseFloat(debits) - parseFloat(credits);
  return { balanced: Math.abs(delta) < 0.0001, delta };
}
