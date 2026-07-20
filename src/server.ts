/**
 * Server-side ingest proxy — the piece that makes browser telemetry safe.
 *
 * Browsers must never hold a plx_ API key (it grants org-wide write). The
 * proven pattern (validated in production by the Plexus marketing site): the
 * page fires fire-and-forget beacons at a first-party route, and that route —
 * which holds the key in server env — forwards to the gateway. This module is
 * that route, packaged.
 *
 *   // app/api/plexus/route.ts (Next.js)
 *   import { createIngestProxy } from "plexus-typescript/server";
 *   export const POST = createIngestProxy({
 *     sourceId: "web-frontend",
 *     allowMetrics: ["page_view", "signup", "read_seconds"],
 *   });
 *
 * Works with any framework that speaks web-standard Request/Response
 * (Next.js route handlers, Remix, Hono, Bun, Deno; Express via a tiny
 * adapter).
 */
import { validateSourceId } from "./wire.js";
import { DEFAULT_GATEWAY_URL, envVar } from "./config.js";

export interface IngestProxyOptions {
  /** Source slug the browser events land under. */
  sourceId: string;
  /** Falls back to PLEXUS_API_KEY server env. */
  apiKey?: string;
  gatewayUrl?: string;
  /** Metric-name allowlist. Strongly recommended — the route is public. */
  allowMetrics?: string[];
  /** Tag keys forwarded from the browser payload; others are dropped. */
  tagAllowlist?: string[];
  /** Upstream timeout (default 3000ms — analytics must never block). */
  timeoutMs?: number;
  /** Clamp numeric values into a sane range (default 0..86_400_000). */
  maxValue?: number;
}

interface BeaconPayload {
  metric?: string;
  value?: number;
  tags?: Record<string, unknown>;
  session?: string;
  event?: boolean;
}

const SESSION_RE = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * Returns a web-standard `(req: Request) => Promise<Response>` handler.
 * Always responds 204 — telemetry must never break the calling page.
 */
export function createIngestProxy(options: IngestProxyOptions) {
  validateSourceId(options.sourceId);
  const gateway = (options.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(
    /\/+$/,
    "",
  );
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxValue = options.maxValue ?? 86_400_000;
  const allowMetrics = options.allowMetrics
    ? new Set(options.allowMetrics)
    : null;
  const tagAllowlist = options.tagAllowlist
    ? new Set(options.tagAllowlist)
    : null;

  return async function handleIngest(req: Request): Promise<Response> {
    const done = () => new Response(null, { status: 204 });
    try {
      const apiKey = options.apiKey ?? envVar("PLEXUS_API_KEY");
      if (!apiKey) {
        console.warn("[plexus] ingest proxy: no PLEXUS_API_KEY set");
        return done();
      }

      const payload = (await req
        .json()
        .catch(() => null)) as BeaconPayload | null;
      const metric = payload?.metric;
      if (!metric || typeof metric !== "string" || metric.length > 256) {
        return done();
      }
      if (allowMetrics && !allowMetrics.has(metric)) return done();

      const rawValue = payload?.value;
      const isEvent = payload?.event === true && typeof rawValue !== "number";
      const value = isEvent
        ? (rawValue ?? 1)
        : Math.min(
            Math.max(
              Math.round(typeof rawValue === "number" ? rawValue : 1),
              0,
            ),
            maxValue,
          );

      const tags: Record<string, string> = {};
      if (payload?.session && SESSION_RE.test(payload.session)) {
        tags.session = payload.session;
      }
      if (payload?.tags && typeof payload.tags === "object") {
        for (const [k, v] of Object.entries(payload.tags)) {
          if (tagAllowlist && !tagAllowlist.has(k)) continue;
          if (typeof v === "string" && k.length <= 256 && v.length <= 256) {
            tags[k] = v;
          }
        }
      }

      await fetch(`${gateway}/ingest`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_id: options.sourceId,
          points: [
            {
              class: isEvent ? "event" : "metric",
              metric,
              value,
              timestamp: Date.now(),
              ...(Object.keys(tags).length > 0 ? { tags } : {}),
            },
          ],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }).catch((err) => {
        console.warn("[plexus] ingest proxy forward failed:", err?.message);
      });
    } catch {
      // Analytics must never break the page.
    }
    return done();
  };
}
