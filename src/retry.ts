import type { RetryConfig } from "./types.js";

export const DEFAULT_RETRY: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  exponentialBase: 2,
  jitter: true,
};

/**
 * Exponential backoff, Python-SDK parity: base * b^attempt capped at max,
 * jittered to 50–100% of the computed delay.
 */
export function retryDelayMs(
  attempt: number,
  cfg: Required<RetryConfig>,
  random: () => number = Math.random,
): number {
  const raw = Math.min(
    cfg.baseDelayMs * cfg.exponentialBase ** attempt,
    cfg.maxDelayMs,
  );
  return cfg.jitter ? raw * (0.5 + random() * 0.5) : raw;
}

/** Retry on rate limits and server errors; 4xx (except 429) are final. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
