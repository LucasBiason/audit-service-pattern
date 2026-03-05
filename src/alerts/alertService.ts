/**
 * Alert service: sends notifications when discrepancies or critical events are detected.
 * Currently supports webhook (generic HTTP POST) — easily extensible to Slack, PagerDuty, etc.
 */
import { config } from '../config/env';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Alert {
  severity: AlertSeverity;
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export async function sendAlert(alert: Alert): Promise<void> {
  console.warn(`[ALERT:${alert.severity.toUpperCase()}] ${alert.title}: ${alert.description}`);

  if (config.alerts.webhookUrl) {
    try {
      const response = await fetch(config.alerts.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
      });
      if (!response.ok) {
        console.error(`Alert webhook failed: ${response.status}`);
      }
    } catch (err) {
      console.error('Alert webhook error:', err);
    }
  }
}

export function criticalAlert(title: string, description: string, metadata?: Record<string, unknown>): Promise<void> {
  return sendAlert({ severity: 'critical', title, description, metadata, timestamp: new Date().toISOString() });
}

export function highAlert(title: string, description: string, metadata?: Record<string, unknown>): Promise<void> {
  return sendAlert({ severity: 'high', title, description, metadata, timestamp: new Date().toISOString() });
}
