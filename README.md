# plexus-typescript

**Thin TypeScript/JavaScript SDK for [Plexus](https://plexus.company).** Send telemetry to the Plexus gateway from Node services, workers, and (via a server proxy) the browser. Storage, dashboards, alerts, and fleet management live in the platform — this package just ships your data.

[![npm](https://img.shields.io/npm/v/plexus-typescript)](https://www.npmjs.com/package/plexus-typescript)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

## Quick Start

```bash
npm install plexus-typescript
```

```ts
import { Plexus } from "plexus-typescript";

const px = new Plexus({
  apiKey: "plx_xxx",
  sourceId: "checkout-api",
  kind: "service",
});

await px.send("request_latency_ms", 42);
```

Get an API key at [app.plexus.company](https://app.plexus.company). Omit `apiKey` to read `PLEXUS_API_KEY` from the environment.

Requires Node 18+ (native `fetch`). ESM and CJS builds are both shipped.

## Source identity

Every client sends under a `sourceId` — a slug that namespaces its metrics.

- **Slug rules:** must match `^[a-z0-9][a-z0-9._-]*$` (lowercase letters, digits, dots, hyphens, underscores), at most 256 characters. Slugs that look like a UUID are rejected — the Plexus app resolves uuid-shaped refs as internal ids, which would make the source unreachable.
- **If unset**, the SDK generates `source-<8 hex>`. Pass an explicit slug in anything beyond a scratch script.
- **Collisions:** if the gateway has to rename your source (another device already owns the slug), it echoes the assigned slug in the ingest response. The SDK adopts the echoed slug for every subsequent send; `px.source` reflects the effective value.
- **Kind:** pass `kind` (e.g. `"service"`, `"web-app"`, `"worker"`) to declare what this source is. The SDK declares it best-effort with a `PATCH` to the app after the first successful send, so the source doesn't register as a bare device. Failures are swallowed — the source just stays generic.

## Core methods

### `send(metric, value, opts?)` — stream a reading

The main method. Resolves `true` on delivery, `false` if the point had to be buffered (see [Reliability](#reliability)).

```ts
await px.send("engine_rpm", 3450);
await px.send("coolant_temp", 82.3, { tags: { motor: "A1" } });
```

`value` accepts numbers, strings, booleans, objects, and arrays. Numbers become `metric` points; everything else becomes an `event` point (override with `opts.class`).

Optional `opts`: `tags` (string key-value labels), `timestamp` (see [Timestamps](#timestamps)), `class`.

### `event(name, data, opts?)` — record a discrete occurrence

For things that _happen_ rather than things you _measure_ — faults, state transitions, deploys. Displayed as markers on charts, not time-series lines.

```ts
await px.event("fault", "E-stop triggered");
await px.event("state_change", { from: "IDLE", to: "RUNNING" });
```

### `sendBatch(points, opts?)` — multiple readings in one call

```ts
await px.sendBatch([
  ["temperature", 22.4],
  ["humidity", 58.1],
  ["pressure", 1013.2, someTimestamp], // optional per-point timestamp
]);
```

Each entry is `[metric, value]` or `[metric, value, timestamp]`. All points land in one network call.

### `run(runId, fn)` — group data into a named recording

```ts
await px.run("thermal-cycle-001", async () => {
  while (running) await px.send("temperature", readTemp());
});
```

Every point sent inside `fn` is tagged with `run_id`. Run start/end are announced to the app best-effort; bookkeeping failures never break telemetry.

### `flush()` / `close()`

`flush()` sends everything sitting in the failure buffer. `close()` is a final best-effort flush — call it on shutdown; safe to call multiple times.

## Browser usage

Browsers must never hold a `plx_` API key: the key grants org-wide write access, and anything shipped to the browser is public. The pattern is a two-piece proxy — the page fires fire-and-forget beacons at a first-party route, and that route (which holds the key in server env) forwards to the gateway.

Server side (Next.js route handler shown; works with anything that speaks web-standard `Request`/`Response` — Remix, Hono, Bun, Deno):

```ts
// app/api/plexus/route.ts
import { createIngestProxy } from "plexus-typescript/server";

export const POST = createIngestProxy({
  sourceId: "web-frontend",
  allowMetrics: ["page_view", "signup", "read_seconds"],
});
```

Browser side:

```ts
import { createBrowserClient } from "plexus-typescript/browser";

const plexus = createBrowserClient(); // posts to /api/plexus
plexus.track("page_view", 1, { page: "/pricing" });
plexus.event("signup", { plan: "team" });
```

Notes:

- The browser client uses `navigator.sendBeacon` (survives page unload) with a keepalive `fetch` fallback, and never throws.
- The proxy route is public, so it sanitizes: set `allowMetrics` (strongly recommended), optionally `tagAllowlist`; numeric values are clamped. It always responds `204` — telemetry must never break the calling page.
- Each browser session gets a random session id, forwarded as a `session` tag.

## Reliability

Points are sent immediately. On failure the SDK retries with exponential backoff:

| Setting           | Default | Meaning                                       |
| ----------------- | ------- | --------------------------------------------- |
| `maxRetries`      | 3       | Additional attempts after the first (4 total) |
| `baseDelayMs`     | 1000    | Base delay                                    |
| `maxDelayMs`      | 30000   | Delay cap                                     |
| `exponentialBase` | 2       | Backoff multiplier                            |
| `jitter`          | true    | Randomize each delay to 50–100% of computed   |

Override via `new Plexus({ retry: { ... } })`. Network errors, timeouts, `429`, and `5xx` are retried; other `4xx` are final.

**Buffer semantics:** when retries are exhausted, the points go into an in-memory FIFO buffer (default capacity 10,000, oldest dropped first with a console warning) and are prepended to the next send. `px.bufferSize` reports the count; `flush()` drains it explicitly.

**`send()` resolves `false` rather than rejecting on delivery failure.** This is a deliberate divergence from the Python SDK, which raises on any exhausted retry: JS telemetry calls are routinely fire-and-forget, and an unhandled rejection per network blip is hostile. `send()` only rejects on programmer error (invalid metric or source, non-numeric value for a `metric`-class point) or authentication failure (`AuthenticationError` on 401/403 — fatal misconfiguration, not weather).

## Timestamps

Wire timestamps are **milliseconds** since epoch. Omit `timestamp` and the SDK uses `Date.now()`.

```ts
await px.send("temp", 72.5); // now
await px.send("temp", 72.5, { timestamp: new Date("2026-07-01") }); // Date accepted
await px.send("temp", 72.5, { timestamp: 1751328000 }); // seconds — auto-scaled to ms
```

Numbers below `1e12` are treated as seconds and auto-scaled — the same rule the gateway and the Python SDK apply, so second-resolution timestamps from other systems land correctly. Unlike the Python SDK's WebSocket transport, there is no gateway clock sync: timestamps come from the caller's clock.

## Environment variables

| Variable             | Description                           | Default                          |
| -------------------- | ------------------------------------- | -------------------------------- |
| `PLEXUS_API_KEY`     | API key (required)                    | none                             |
| `PLEXUS_GATEWAY_URL` | HTTP ingest URL                       | `https://gateway.plexus.company` |
| `PLEXUS_ENDPOINT`    | Product app (runs + kind declaration) | `https://app.plexus.company`     |

Resolution order: explicit option > environment > `~/.plexus/config.json` > default. The config file (written by the Python SDK's `plexus init`) is read-only from this SDK, Node only, and best-effort — a missing or malformed file is ignored.

## Transport

```
Your code ── px.send() ── HTTP POST /ingest ──> plexus-gateway ──> ClickHouse + Dashboard
```

- **HTTP only in v1.** `POST /ingest` with `x-api-key`. A WebSocket transport (the gateway's `/ws/device` contract — lower latency, live command delivery) is the planned v1.1 seam.
- **No request gzip — deliberate.** The gateway's HTTP handler does not decompress request bodies; compressed payloads would be rejected, not helped.
- The gateway resolves `org_id` server-side from the API key; clients never supply it.

## License

Apache 2.0
