/**
 * Redis Streams consumer for the audit service.
 * Reads events from the main system stream and records them in the audit ledger.
 * The audit service is INDEPENDENT — it never writes to the main system.
 */
import Redis from 'ioredis';
import { Pool } from 'pg';
import { config } from '../config/env';
import { recordTransaction } from '../ledger/doubleEntry';
import { CircuitBreaker } from '../circuit-breaker/circuitBreaker';
import { criticalAlert } from '../alerts/alertService';

interface StreamMessage {
  eventId: string;
  eventType: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/**
 * Maps domain events to double-entry ledger transactions.
 * This is the core "accounting rules" layer.
 */
async function processEvent(pool: Pool, event: StreamMessage): Promise<void> {
  switch (event.eventType) {
    case 'CartCheckedOut': {
      // When a cart is checked out, record revenue recognition:
      // DEBIT  RECEIVABLE  (money owed by user)
      // CREDIT REVENUE     (income recognized)
      const total = event.payload['totalAmount'] as number;
      if (total > 0) {
        await recordTransaction(
          pool,
          [
            { entryType: 'debit',  accountName: 'RECEIVABLE', amount: total, description: `Checkout ${event.aggregateId}` },
            { entryType: 'credit', accountName: 'REVENUE',    amount: total, description: `Checkout ${event.aggregateId}` },
          ],
          event.eventId as unknown as string
        );
      }
      break;
    }

    case 'CartAbandoned': {
      // Reverse receivable when cart is abandoned (if any amount was recorded)
      // This is a simplified example — in real systems a more complex reversal would occur
      console.log(`[Audit] Cart abandoned: ${event.aggregateId} — no ledger entry needed`);
      break;
    }

    default:
      // Non-financial events are still recorded for audit trail (status=skipped)
      await pool.query(
        `INSERT INTO audit_events (event_id, event_type, aggregate_id, payload, status)
         VALUES ($1, $2, $3, $4, 'skipped')
         ON CONFLICT (event_id) DO NOTHING`,
        [event.eventId, event.eventType, event.aggregateId, JSON.stringify(event.payload)]
      );
      return;
  }

  // Record as processed in audit log
  await pool.query(
    `INSERT INTO audit_events (event_id, event_type, aggregate_id, payload, status)
     VALUES ($1, $2, $3, $4, 'processed')
     ON CONFLICT (event_id) DO NOTHING`,
    [event.eventId, event.eventType, event.aggregateId, JSON.stringify(event.payload)]
  );
}

export async function startEventConsumer(redis: Redis, pool: Pool): Promise<void> {
  const { stream, consumerGroup, consumerName } = config.redis;

  // Create consumer group
  try {
    await redis.xgroup('CREATE', stream, consumerGroup, '0', 'MKSTREAM');
    console.log(`[Audit Consumer] Group '${consumerGroup}' created`);
  } catch {
    console.log(`[Audit Consumer] Group '${consumerGroup}' already exists`);
  }

  const cb = new CircuitBreaker('audit-db', config.circuitBreaker, async (name, state) => {
    if (state === 'OPEN') {
      await criticalAlert(
        'Audit DB Circuit Breaker OPEN',
        `The audit database circuit breaker has opened. The audit service will temporarily stop processing events.`
      );
    }
  });

  console.log(`[Audit Consumer] Listening to '${stream}'...`);

  while (true) {
    try {
      const results = await redis.xreadgroup(
        'GROUP', consumerGroup, consumerName,
        'COUNT', 10,
        'BLOCK', 5000,
        'STREAMS', stream, '>'
      ) as Array<[string, Array<[string, string[]]>]> | null;

      if (!results) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          const event = parseFields(fields);

          try {
            await cb.execute(() => processEvent(pool, event));
            await redis.xack(stream, consumerGroup, messageId);
          } catch (err) {
            console.error(`[Audit Consumer] Failed to process ${messageId}:`, err);

            // Record failure in audit log
            await pool.query(
              `INSERT INTO audit_events (event_id, event_type, aggregate_id, payload, status, error_msg)
               VALUES ($1, $2, $3, $4, 'error', $5)
               ON CONFLICT (event_id) DO UPDATE SET status='error', error_msg=$5`,
              [event.eventId, event.eventType, event.aggregateId, JSON.stringify(event.payload), String(err)]
            ).catch(() => {}); // best-effort
          }
        }
      }
    } catch (err) {
      console.error('[Audit Consumer] Stream read error:', err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function parseFields(fields: string[]): StreamMessage {
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
  return {
    eventId: obj['eventId'],
    eventType: obj['eventType'],
    aggregateId: obj['aggregateId'],
    occurredAt: obj['occurredAt'],
    payload: JSON.parse(obj['payload']),
  };
}
