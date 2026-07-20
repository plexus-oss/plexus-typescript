# AGENTS.md — plexus-typescript

Machine-readable interface for AI assistants and automation scripts.

## Environment Variables

| Variable             | Description                               | Default                          |
| -------------------- | ----------------------------------------- | -------------------------------- |
| `PLEXUS_API_KEY`     | API key for authentication (required)     | none                             |
| `PLEXUS_GATEWAY_URL` | Gateway HTTP ingest URL                   | `https://gateway.plexus.company` |
| `PLEXUS_ENDPOINT`    | Product app URL (runs + kind declaration) | `https://app.plexus.company`     |

Resolution order: explicit constructor option > env var > `~/.plexus/config.json` (read-only, Node only) > default.

## TypeScript SDK (Node)

```ts
import { Plexus } from "plexus-typescript";

const px = new Plexus({
  apiKey: "plx_xxxxx",
  sourceId: "checkout-api",
  kind: "service",
});

await px.send("request_latency_ms", 42); // resolves true (delivered) or false (buffered)
await px.send("queue_depth", 17, { tags: { queue: "emails" } });
await px.event("deploy", { sha: "abc123" });

// Batch (one network call)
await px.sendBatch([
  ["temperature", 72.5],
  ["pressure", 1013.25],
]);

// Named recording
await px.run("load-test-001", async () => {
  await px.send("rps", 1200);
});

await px.close(); // final best-effort flush
```

## Browser (via server proxy — the key never ships to the browser)

```ts
// Server: app/api/plexus/route.ts (any web-standard Request/Response framework)
import { createIngestProxy } from "plexus-typescript/server";
export const POST = createIngestProxy({
  sourceId: "web-frontend",
  allowMetrics: ["page_view", "signup"],
});

// Browser
import { createBrowserClient } from "plexus-typescript/browser";
const plexus = createBrowserClient(); // posts to /api/plexus
plexus.track("page_view");
plexus.event("signup", { plan: "team" });
```

## Key Conventions

- API keys are prefixed with `plx_`; sent as the `x-api-key` header
- HTTP ingest → `POST /ingest` on the gateway (only transport in v1; WebSocket is the v1.1 seam; no request gzip)
- Gateway resolves `org_id` server-side from the API key — clients do not supply it
- Wire timestamps are **milliseconds** since epoch; numeric values `< 1e12` are auto-scaled from seconds; `Date` objects accepted
- Source slugs must match `^[a-z0-9][a-z0-9._-]*$` (max 256 chars) and must **not** be uuid-shaped (the app resolves uuid-shaped refs as internal ids)
- Gateway may suffix the slug on collision; the SDK adopts the echoed `source_id` for subsequent sends
- `~/.plexus/config.json` is read-only from this SDK (the Python SDK writes it)
- `send()` resolves `false` on delivery failure (points buffered in-memory, FIFO drop-oldest, default 10,000); it rejects only on programmer error or 401/403 (`AuthenticationError`)

## Exports

| Entry point                 | Contents                                                         |
| --------------------------- | ---------------------------------------------------------------- |
| `plexus-typescript`         | `Plexus`, `PlexusError`, `AuthenticationError`, `VERSION`, types |
| `plexus-typescript/server`  | `createIngestProxy`                                              |
| `plexus-typescript/browser` | `createBrowserClient`                                            |

## Commands

```bash
npm run build        # tsup → dist/ (ESM + CJS + d.ts)
npm test             # vitest run
npm run typecheck    # tsc --noEmit
npm run format:check # prettier --check .
```

Version lives in both `package.json` and `src/version.ts`; CI fails if they diverge.
