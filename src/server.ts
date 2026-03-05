import Fastify from 'fastify';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { config } from './config/env';
import { initLedger } from './ledger/schema';
import { ledgerRoutes } from './api/routes/ledger';
import { startEventConsumer } from './consumer/eventConsumer';
import { startReconciliationScheduler } from './reconciliation/reconciler';

const pool = new Pool(config.db);

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
});

const app = Fastify({ logger: true });

app.setErrorHandler((error, _req, reply) => {
  reply.code(500).send({ error: error.message });
});

async function main(): Promise<void> {
  // Initialize audit database schema
  await initLedger(pool);
  console.log('[Audit] Database initialized');

  // Register HTTP routes
  ledgerRoutes(app, pool);

  // Start HTTP API
  await app.listen({ port: config.api.port, host: '0.0.0.0' });
  console.log(`[Audit] API listening on port ${config.api.port}`);

  // Start event consumer (background)
  startEventConsumer(redis, pool).catch((err) => {
    console.error('[Audit] Consumer crashed:', err);
    process.exit(1);
  });

  // Start reconciliation scheduler (background)
  startReconciliationScheduler(pool);

  console.log('[Audit] Service fully started');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
