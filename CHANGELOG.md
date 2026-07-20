# Changelog

## [0.1.0] - 2026-07-20 - Initial release

### Added

- `Plexus` client (HTTP transport, plexus-python parity): `send()`, `event()`, `sendBatch()`, `run()`, `flush()`, `close()`.
- Exponential-backoff retry (429/5xx/network) with jitter; in-memory FIFO drop-oldest buffer for failed sends. `send()` resolves `false` on delivery failure instead of rejecting — a documented divergence from the Python SDK.
- Source identity: slug validation (`^[a-z0-9][a-z0-9._-]*$`, uuid-shapes rejected), gateway collision-suffix adoption, best-effort `kind` declaration after first successful send.
- Millisecond timestamps with seconds auto-scaling and `Date` support.
- Config resolution: explicit option > env (`PLEXUS_API_KEY`, `PLEXUS_GATEWAY_URL`, `PLEXUS_ENDPOINT`) > `~/.plexus/config.json` (read-only, Node only) > default.
- `plexus-typescript/server`: `createIngestProxy` — web-standard `Request`/`Response` handler that keeps the API key server-side, with metric/tag allowlists and value clamping.
- `plexus-typescript/browser`: `createBrowserClient` — fire-and-forget `sendBeacon` client (keepalive `fetch` fallback) that posts to the server proxy; never throws.
- ESM + CJS builds with type declarations; Node 18+.
