/** Values the gateway accepts. Numbers become metrics; the rest are events. */
export type FlexValue =
  number | string | boolean | Record<string, unknown> | unknown[];

export type PointClass = "metric" | "event";

/** One point on the wire (gateway POST /ingest contract). */
export interface Point {
  class: PointClass;
  metric: string;
  value: FlexValue;
  /** Milliseconds since epoch. */
  timestamp: number;
  tags?: Record<string, string>;
  run_id?: string;
  source_id?: string;
}

export interface SendOptions {
  /** Ms since epoch, seconds (auto-scaled), or a Date. Defaults to now. */
  timestamp?: number | Date;
  tags?: Record<string, string>;
  /** Override the inferred class (numeric → "metric", else "event"). */
  class?: PointClass;
}

export interface RetryConfig {
  /** Additional attempts after the first (default 3 → 4 total). */
  maxRetries?: number;
  /** Base delay in ms (default 1000). */
  baseDelayMs?: number;
  /** Delay cap in ms (default 30000). */
  maxDelayMs?: number;
  /** Exponential base (default 2). */
  exponentialBase?: number;
  /** Randomize each delay to 50–100% of its computed value (default true). */
  jitter?: boolean;
}

export interface PlexusOptions {
  /** Falls back to PLEXUS_API_KEY, then ~/.plexus/config.json (node only). */
  apiKey?: string;
  /** Source slug. Auto-generated (`source-<8 hex>`) if unset. */
  sourceId?: string;
  /** Ingest gateway. Default https://gateway.plexus.company */
  gatewayUrl?: string;
  /** Product app (runs + kind declaration). Default https://app.plexus.company */
  endpoint?: string;
  /** Per-request timeout in ms (default 10000). */
  timeoutMs?: number;
  retry?: RetryConfig;
  /** Failed-send buffer capacity; oldest points drop first (default 10000). */
  maxBufferSize?: number;
  /**
   * Source kind (e.g. "service", "web-app", "worker" — see the Plexus app's
   * kind registry). Declared best-effort via PATCH after the first successful
   * send so the source doesn't register as a bare device.
   */
  kind?: string;
}
