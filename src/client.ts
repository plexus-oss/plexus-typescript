import type {
  FlexValue,
  PlexusOptions,
  Point,
  RetryConfig,
  SendOptions,
} from "./types.js";
import { AuthenticationError, PlexusError } from "./errors.js";
import { buildPoint, validateSourceId } from "./wire.js";
import { MemoryBuffer } from "./buffer.js";
import { DEFAULT_RETRY, isRetryableStatus, retryDelayMs } from "./retry.js";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_GATEWAY_URL,
  envVar,
  readFileConfig,
} from "./config.js";
import { VERSION } from "./version.js";

interface IngestResponse {
  success?: boolean;
  count?: number;
  /**
   * Echoed unchanged for single-source batches (gateway auto-suffixing was
   * removed); the SDK's adoption of it is kept as forward-compat only.
   */
  source_id?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plexus telemetry client (HTTP transport, plexus-python parity).
 *
 * Delivery semantics: points are sent immediately, in chunks of at most 5000
 * (the gateway rejects batches over 10k points with a non-retryable 400, so
 * a grown backlog must drain in bounded requests). On delivery failure —
 * network, 5xx/429 after retries, or a non-auth 4xx rejection — the unsent
 * points are buffered (FIFO, drop-oldest) and prepended to the next send.
 * `send()` resolves `true` on delivery and `false` on a buffered failure —
 * it only REJECTS on programmer error (bad metric/source) or authentication
 * failure (401/403, fatal misconfiguration). This is a deliberate divergence
 * from the Python SDK (which raises on any exhausted retry): JS telemetry
 * calls are routinely fire-and-forget, and an unhandled rejection per
 * network blip is hostile.
 *
 * No request gzip in v1: the gateway's ingest handler does transparently
 * decompress `Content-Encoding: gzip` bodies (plexus-python compresses >1KB
 * payloads) — this SDK just doesn't compress yet.
 * No WebSocket transport in v1 (the `/ws/device` contract is the v1.1 seam).
 */
export class Plexus {
  private apiKey: string | undefined;
  private sourceId: string | undefined;
  private gatewayUrl: string | undefined;
  private endpoint: string | undefined;
  private readonly timeoutMs: number;
  private readonly retry: Required<RetryConfig>;
  private readonly buffer: MemoryBuffer;
  private readonly kind: string | undefined;
  private kindDeclared = false;
  private runId: string | undefined;
  private resolved: Promise<void> | undefined;

  constructor(private readonly options: PlexusOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.kind = options.kind;
    this.buffer = new MemoryBuffer(options.maxBufferSize ?? 10_000, (n) =>
      console.warn(`[plexus] buffer full, dropped ${n} oldest points`),
    );
  }

  /** Lazy async config resolution (env + optional ~/.plexus/config.json). */
  private ensureResolved(): Promise<void> {
    if (!this.resolved) {
      this.resolved = (async () => {
        const file = await readFileConfig();
        this.apiKey =
          this.options.apiKey ?? envVar("PLEXUS_API_KEY") ?? file?.api_key;
        if (!this.apiKey) {
          throw new AuthenticationError(
            "No API key: pass apiKey, set PLEXUS_API_KEY, or run plexus init",
          );
        }
        this.gatewayUrl = (
          this.options.gatewayUrl ??
          envVar("PLEXUS_GATEWAY_URL") ??
          file?.gateway_url ??
          DEFAULT_GATEWAY_URL
        ).replace(/\/+$/, "");
        this.endpoint = (
          this.options.endpoint ??
          envVar("PLEXUS_ENDPOINT") ??
          file?.endpoint ??
          DEFAULT_ENDPOINT
        ).replace(/\/+$/, "");
        this.sourceId =
          this.options.sourceId ??
          file?.source_id ??
          `source-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
        validateSourceId(this.sourceId);
      })();
    }
    return this.resolved;
  }

  /**
   * The effective source slug. The gateway echoes the declared source_id
   * back unchanged (auto-suffixing was removed); the echo is still adopted
   * as forward-compat, so this normally always equals the configured slug.
   */
  get source(): string | undefined {
    return this.sourceId;
  }

  get bufferSize(): number {
    return this.buffer.size;
  }

  async send(
    metric: string,
    value: FlexValue,
    opts?: SendOptions,
  ): Promise<boolean> {
    return this.sendPoints([buildPoint(metric, value, opts, this.runId)]);
  }

  /** Convenience for `class: "event"` points. */
  async event(
    name: string,
    data: FlexValue,
    opts?: Omit<SendOptions, "class">,
  ): Promise<boolean> {
    return this.sendPoints([
      buildPoint(name, data, { ...opts, class: "event" }, this.runId),
    ]);
  }

  async sendBatch(
    points: Array<
      [metric: string, value: FlexValue, timestamp?: number | Date]
    >,
    opts?: SendOptions,
  ): Promise<boolean> {
    return this.sendPoints(
      points.map(([metric, value, ts]) =>
        buildPoint(
          metric,
          value,
          { ...opts, ...(ts !== undefined ? { timestamp: ts } : {}) },
          this.runId,
        ),
      ),
    );
  }

  /**
   * Tag every point inside `fn` with a run id. Start/end are announced to the
   * app's /api/runs best-effort (failures swallowed — Python parity).
   */
  async run<T>(runId: string, fn: () => Promise<T> | T): Promise<T> {
    await this.ensureResolved();
    await this.notifyRun(runId, "started");
    this.runId = runId;
    try {
      return await fn();
    } finally {
      this.runId = undefined;
      await this.notifyRun(runId, "ended");
    }
  }

  /** Send everything sitting in the failure buffer. */
  async flush(): Promise<boolean> {
    return this.sendPoints([]);
  }

  /** Flush any buffered points; safe to call multiple times. */
  async close(): Promise<void> {
    if (this.buffer.size > 0) await this.flush().catch(() => {});
  }

  // ── internals ──────────────────────────────────────────────────────────

  /**
   * Gateway hard cap is 10k points per batch (a non-retryable 400 beyond
   * that). Sending in chunks well under it means a backlog that grew to the
   * buffer cap can always drain instead of wedging behind one giant POST.
   */
  private static readonly SEND_CHUNK_POINTS = 5000;

  private async sendPoints(fresh: Point[]): Promise<boolean> {
    await this.ensureResolved();
    let pending = [...this.buffer.drain(), ...fresh];

    while (pending.length > 0) {
      const chunk = pending.slice(0, Plexus.SEND_CHUNK_POINTS);
      const delivered = await this.sendChunk(chunk);
      if (!delivered) {
        // Re-buffer the failed chunk AND everything not yet attempted —
        // resolve-false-on-failure semantics, nothing dropped.
        this.buffer.add(pending);
        return false;
      }
      pending = pending.slice(chunk.length);
    }
    return true;
  }

  /**
   * POST one chunk (≤ SEND_CHUNK_POINTS) with retries. Returns `true` on
   * delivery, `false` on any non-auth failure — including non-retryable 4xx
   * rejections — so the caller can re-buffer. Throws only
   * `AuthenticationError` (401/403, fatal misconfiguration).
   */
  private async sendChunk(points: Point[]): Promise<boolean> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.gatewayUrl}/ingest`, {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey!,
            "Content-Type": "application/json",
            "User-Agent": `plexus-typescript/${VERSION}`,
          },
          body: JSON.stringify({ source_id: this.sourceId, points }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (res.status === 401 || res.status === 403) {
          throw new AuthenticationError(
            res.status === 401
              ? "Invalid API key"
              : "API key lacks write scope",
            res.status,
          );
        }
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as IngestResponse;
          // The gateway echoes the declared source_id back unchanged
          // (auto-suffixing was removed); adoption kept as forward-compat.
          if (body.source_id && body.source_id !== this.sourceId) {
            this.sourceId = body.source_id;
          }
          void this.declareKindOnce();
          return true;
        }
        const body = (await res.json().catch(() => ({}))) as IngestResponse;
        lastError = new PlexusError(
          body.error ?? `Ingest failed (${res.status})`,
          res.status,
        );
        // Non-retryable 4xx is final for this attempt loop, but it is a
        // delivery failure, not a programmer error — buffer, don't reject
        // (fire-and-forget callers must never see an unhandled rejection).
        if (!isRetryableStatus(res.status)) break;
      } catch (err) {
        // Auth errors propagate (fatal misconfiguration); network errors
        // and timeouts retry.
        if (err instanceof AuthenticationError) throw err;
        lastError = err;
      }
      if (attempt < this.retry.maxRetries) {
        await sleep(retryDelayMs(attempt, this.retry));
      }
    }

    if (lastError) {
      console.warn(
        `[plexus] send failed, ${points.length} points buffered:`,
        lastError instanceof Error ? lastError.message : lastError,
      );
    }
    return false;
  }

  /**
   * One-shot best-effort kind declaration: PATCH the app so this source
   * doesn't register as a bare device. Runs after the first successful send
   * (the source row exists by then via gateway auto-registration).
   */
  private async declareKindOnce(): Promise<void> {
    if (!this.kind || this.kindDeclared) return;
    this.kindDeclared = true;
    try {
      await fetch(`${this.endpoint}/api/sources/${this.sourceId}`, {
        method: "PATCH",
        headers: {
          "x-api-key": this.apiKey!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ device_type: this.kind }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Best-effort; the source just stays a generic device.
    }
  }

  private async notifyRun(
    runId: string,
    status: "started" | "ended",
  ): Promise<void> {
    try {
      await fetch(`${this.endpoint}/api/runs`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          run_id: runId,
          source_id: this.sourceId,
          status,
          timestamp: Math.floor(Date.now() / 1000),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Run bookkeeping must never break telemetry.
    }
  }
}
