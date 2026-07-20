/**
 * Browser client — fire-and-forget beacons to YOUR server proxy (see
 * plexus-typescript/server). No API key ever touches the browser.
 *
 *   import { createBrowserClient } from "plexus-typescript/browser";
 *   const plexus = createBrowserClient(); // posts to /api/plexus
 *   plexus.track("page_view", 1, { page: "/pricing" });
 *   plexus.event("signup", { plan: "team" });
 */

export interface BrowserClientOptions {
  /** Your server proxy route (default "/api/plexus"). */
  url?: string;
}

export interface PlexusBrowserClient {
  /** Numeric metric (default value 1 — a counter). Never throws. */
  track(metric: string, value?: number, tags?: Record<string, string>): void;
  /** Event point (non-numeric payload welcome). Never throws. */
  event(name: string, data?: unknown, tags?: Record<string, string>): void;
}

function mintSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function createBrowserClient(
  options: BrowserClientOptions = {},
): PlexusBrowserClient {
  const url = options.url ?? "/api/plexus";
  let sessionId: string | undefined;

  function beacon(data: Record<string, unknown>): void {
    try {
      sessionId ??= mintSessionId();
      const payload = JSON.stringify({ session: sessionId, ...data });
      // sendBeacon survives page unload; keepalive fetch is the fallback.
      const sent =
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(
          url,
          new Blob([payload], { type: "application/json" }),
        );
      if (!sent) {
        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Telemetry must never break the page.
    }
  }

  return {
    track(metric, value = 1, tags) {
      beacon({ metric, value, ...(tags ? { tags } : {}) });
    },
    event(name, data, tags) {
      beacon({
        metric: name,
        value: data ?? 1,
        event: true,
        ...(tags ? { tags } : {}),
      });
    },
  };
}
