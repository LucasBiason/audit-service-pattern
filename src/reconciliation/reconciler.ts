/**
 * Reconciliation engine.
 *
 * Runs on a schedule and verifies:
 * 1. Double-entry invariant: total debits == total credits
 * 2. Account balance consistency: computed from ledger entries matches stored balances
 * 3. All expected events have been processed
 */
import { Pool } from 'pg';
import { verifyInvariant, getAccountBalance } from '../ledger/doubleEntry';
import { criticalAlert, highAlert } from '../alerts/alertService';
import { config } from '../config/env';

export interface ReconciliationResult {
  timestamp: string;
  invariantBalanced: boolean;
  invariantDelta: number;
  accountChecks: Array<{ account: string; computedBalance: number; storedBalance: number; ok: boolean }>;
  unprocessedEvents: number;
  passed: boolean;
}

export async function runReconciliation(pool: Pool): Promise<ReconciliationResult> {
  const timestamp = new Date().toISOString();
  console.log(`[Reconciler] Starting reconciliation at ${timestamp}`);

  // 1. Verify double-entry invariant
  const { balanced, delta } = await verifyInvariant(pool);
  if (!balanced) {
    await criticalAlert(
      'Double-Entry Invariant Violated',
      `Total debits do not equal total credits. Delta: ${delta}`,
      { delta }
    );
  }

  // 2. Verify account balances match computed sums
  const accountChecks = await verifyAccountBalances(pool);
  for (const check of accountChecks) {
    if (!check.ok) {
      await highAlert(
        'Account Balance Mismatch',
        `Account '${check.account}': stored=${check.storedBalance} computed=${check.computedBalance}`,
        check
      );
    }
  }

  // 3. Count events with errors
  const errorResult = await pool.query<{ count: string }>(
    "SELECT COUNT(*) FROM audit_events WHERE status = 'error'"
  );
  const unprocessedEvents = parseInt(errorResult.rows[0].count, 10);
  if (unprocessedEvents > 0) {
    await highAlert(
      'Failed Event Processing',
      `${unprocessedEvents} events in error state`,
      { unprocessedEvents }
    );
  }

  const passed = balanced && accountChecks.every((c) => c.ok) && unprocessedEvents === 0;

  if (passed) {
    console.log('[Reconciler] All checks passed.');
  } else {
    console.error('[Reconciler] RECONCILIATION FAILED — see alerts above.');
  }

  return { timestamp, invariantBalanced: balanced, invariantDelta: delta, accountChecks, unprocessedEvents, passed };
}

async function verifyAccountBalances(pool: Pool): Promise<ReconciliationResult['accountChecks']> {
  const accountsResult = await pool.query<{ name: string; balance: string }>('SELECT name, balance FROM accounts');

  const checks: ReconciliationResult['accountChecks'] = [];

  for (const row of accountsResult.rows) {
    const computedResult = await pool.query<{ computed: string }>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'debit'), 0) -
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'credit'), 0) AS computed
       FROM ledger_entries
       WHERE account_name = $1`,
      [row.name]
    );

    const storedBalance = parseFloat(row.balance);
    const computedBalance = parseFloat(computedResult.rows[0].computed);
    const ok = Math.abs(storedBalance - computedBalance) < config.reconciliation.discrepancyThreshold;

    checks.push({ account: row.name, computedBalance, storedBalance, ok });
  }

  return checks;
}

export function startReconciliationScheduler(pool: Pool): void {
  console.log(`[Reconciler] Scheduler started (interval: ${config.reconciliation.intervalMs}ms)`);
  setInterval(async () => {
    try {
      await runReconciliation(pool);
    } catch (err) {
      console.error('[Reconciler] Unexpected error:', err);
    }
  }, config.reconciliation.intervalMs);
}
