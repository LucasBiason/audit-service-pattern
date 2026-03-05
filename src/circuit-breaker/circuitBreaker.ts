/**
 * Circuit Breaker pattern.
 *
 * States:
 *   CLOSED   → operating normally; failures are counted
 *   OPEN     → failing; all calls rejected immediately (fail-fast)
 *   HALF_OPEN → testing recovery; limited calls allowed
 *
 *   CLOSED → (failures >= threshold) → OPEN
 *   OPEN   → (timeout elapsed) → HALF_OPEN
 *   HALF_OPEN → (success >= successThreshold) → CLOSED
 *   HALF_OPEN → (failure) → OPEN
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;   // failures before opening
  successThreshold: number;   // successes in HALF_OPEN before closing
  timeoutMs: number;          // time in OPEN before trying HALF_OPEN
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig,
    private readonly onStateChange?: (name: string, state: CircuitState) => void
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.config.timeoutMs) {
        throw new Error(`Circuit breaker '${this.name}' is OPEN (${elapsed}ms elapsed of ${this.config.timeoutMs}ms)`);
      }
      this.transition('HALF_OPEN');
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transition('CLOSED');
      }
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;
    this.successCount = 0;

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.config.failureThreshold) {
      this.transition('OPEN');
    }
  }

  private transition(newState: CircuitState): void {
    if (this.state !== newState) {
      console.warn(`[CircuitBreaker:${this.name}] ${this.state} → ${newState}`);
      this.state = newState;
      this.onStateChange?.(this.name, newState);
    }
  }

  getState(): CircuitState { return this.state; }
  getFailureCount(): number { return this.failureCount; }
}
