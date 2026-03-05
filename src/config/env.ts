import 'dotenv/config';

export const config = {
  db: {
    host: process.env.AUDIT_DB_HOST ?? 'localhost',
    port: parseInt(process.env.AUDIT_DB_PORT ?? '5432', 10),
    database: process.env.AUDIT_DB_NAME ?? 'audit_db',
    user: process.env.AUDIT_DB_USER ?? 'postgres',
    password: process.env.AUDIT_DB_PASSWORD ?? 'postgres',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    stream: process.env.REDIS_STREAM ?? 'cqrs:events',
    consumerGroup: process.env.AUDIT_CONSUMER_GROUP ?? 'audit-service',
    consumerName: process.env.AUDIT_CONSUMER_NAME ?? 'auditor-1',
  },
  api: {
    port: parseInt(process.env.API_PORT ?? '5000', 10),
  },
  reconciliation: {
    intervalMs: parseInt(process.env.RECONCILIATION_INTERVAL_MS ?? '30000', 10),
    discrepancyThreshold: parseFloat(process.env.DISCREPANCY_THRESHOLD ?? '0.01'),
  },
  circuitBreaker: {
    failureThreshold: parseInt(process.env.CB_FAILURE_THRESHOLD ?? '5', 10),
    successThreshold: parseInt(process.env.CB_SUCCESS_THRESHOLD ?? '3', 10),
    timeoutMs: parseInt(process.env.CB_TIMEOUT_MS ?? '60000', 10),
  },
  alerts: {
    webhookUrl: process.env.ALERT_WEBHOOK_URL ?? '',
  },
} as const;
