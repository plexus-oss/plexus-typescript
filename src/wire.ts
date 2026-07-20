import type { FlexValue, Point, PointClass, SendOptions } from "./types.js";
import { PlexusError } from "./errors.js";

/**
 * The wire slug rule (gateway validate.go) — NOT the Python client's stricter
 * no-dots regex; the wire contract wins. Uuid-shaped slugs are additionally
 * rejected because the Plexus app resolves uuid-shaped refs as internal ids,
 * making such a slug unreachable.
 */
const SOURCE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SOURCE_ID_LEN = 256;

export function validateSourceId(sourceId: string): void {
  if (
    !sourceId ||
    sourceId.length > MAX_SOURCE_ID_LEN ||
    !SOURCE_ID_RE.test(sourceId) ||
    UUID_RE.test(sourceId)
  ) {
    throw new PlexusError(
      `Invalid source_id "${sourceId}": lowercase letters, digits, dots, ` +
        `hyphens, underscores; must not look like a UUID`,
    );
  }
}

/**
 * Wire timestamps are milliseconds. Seconds (< 1e12) are auto-scaled — the
 * same rule the gateway and the Python SDK apply.
 */
export function normalizeTimestampMs(ts?: number | Date): number {
  if (ts === undefined) return Date.now();
  if (ts instanceof Date) return ts.getTime();
  if (!Number.isFinite(ts)) throw new PlexusError(`Invalid timestamp: ${ts}`);
  if (ts > 0 && ts < 1e12) return Math.round(ts * 1000);
  return Math.round(ts);
}

export function inferClass(value: FlexValue): PointClass {
  return typeof value === "number" ? "metric" : "event";
}

export function buildPoint(
  metric: string,
  value: FlexValue,
  opts: SendOptions | undefined,
  runId: string | undefined,
): Point {
  if (!metric) throw new PlexusError("metric is required");
  const cls = opts?.class ?? inferClass(value);
  if (
    cls === "metric" &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new PlexusError(
      `Metric "${metric}" requires a finite number value, got ${typeof value}`,
    );
  }
  const point: Point = {
    class: cls,
    metric,
    value,
    timestamp: normalizeTimestampMs(opts?.timestamp),
  };
  if (opts?.tags) point.tags = opts.tags;
  if (runId) point.run_id = runId;
  return point;
}
