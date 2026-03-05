import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { verifyInvariant, getAccountBalance } from '../../ledger/doubleEntry';
import { runReconciliation } from '../../reconciliation/reconciler';

export function ledgerRoutes(app: FastifyInstance, pool: Pool): void {
  // GET /audit/accounts — List all accounts with balances
  app.get('/audit/accounts', async (_req, reply) => {
    const result = await pool.query('SELECT * FROM accounts ORDER BY name');
    return reply.send(result.rows);
  });

  // GET /audit/accounts/:name/balance — Get account balance
  app.get<{ Params: { name: string } }>('/audit/accounts/:name/balance', async (req, reply) => {
    const balance = await getAccountBalance(pool, req.params.name.toUpperCase());
    return reply.send({ account: req.params.name.toUpperCase(), balance });
  });

  // GET /audit/ledger — Get ledger entries (paginated)
  app.get<{
    Querystring: { limit?: string; offset?: string; account?: string };
  }>('/audit/ledger', async (req, reply) => {
    const limit = parseInt(req.query.limit ?? '50', 10);
    const offset = parseInt(req.query.offset ?? '0', 10);
    const account = req.query.account;

    const where = account ? `WHERE account_name = $3` : '';
    const params: (string | number)[] = [limit, offset];
    if (account) params.push(account);

    const result = await pool.query(
      `SELECT * FROM ledger_entries ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params
    );
    return reply.send(result.rows);
  });

  // GET /audit/invariant — Verify double-entry invariant
  app.get('/audit/invariant', async (_req, reply) => {
    const result = await verifyInvariant(pool);
    return reply.code(result.balanced ? 200 : 500).send(result);
  });

  // POST /audit/reconcile — Trigger manual reconciliation
  app.post('/audit/reconcile', async (_req, reply) => {
    const result = await runReconciliation(pool);
    return reply.code(result.passed ? 200 : 500).send(result);
  });

  // GET /audit/events — List audit event log
  app.get<{
    Querystring: { status?: string; limit?: string };
  }>('/audit/events', async (req, reply) => {
    const limit = parseInt(req.query.limit ?? '50', 10);
    const where = req.query.status ? `WHERE status = $2` : '';
    const params: (string | number)[] = [limit];
    if (req.query.status) params.push(req.query.status);

    const result = await pool.query(
      `SELECT * FROM audit_events ${where} ORDER BY processed_at DESC LIMIT $1`,
      params
    );
    return reply.send(result.rows);
  });

  // GET /audit/health — Service health
  app.get('/audit/health', async (_req, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
