import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserClient } from "../src/browser.js";

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

afterEach(() => vi.unstubAllGlobals());

describe("createBrowserClient", () => {
  it("prefers sendBeacon and reuses one session id", async () => {
    const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
    vi.stubGlobal("navigator", { sendBeacon });
    const client = createBrowserClient({ url: "/api/track" });

    client.track("page_view");
    client.track("signup", 1, { page: "/pricing" });

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    const payloads = await Promise.all(
      sendBeacon.mock.calls.map(async ([, blob]) =>
        JSON.parse(await blob.text()),
      ),
    );
    expect(payloads[0]).toMatchObject({ metric: "page_view", value: 1 });
    expect(payloads[1]).toMatchObject({
      metric: "signup",
      value: 1,
      tags: { page: "/pricing" },
    });
    expect(payloads[0].session).toBe(payloads[1].session);
    expect(payloads[0].session.length).toBeGreaterThanOrEqual(8);
  });

  it("falls back to keepalive fetch when sendBeacon is unavailable", () => {
    vi.stubGlobal("navigator", {});
    const fetchMock = vi.fn<FetchFn>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createBrowserClient();
    client.event("deploy", { sha: "abc" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/plexus");
    expect((init as RequestInit).keepalive).toBe(true);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      metric: "deploy",
      value: { sha: "abc" },
      event: true,
    });
  });

  it("never throws, even when everything is broken", () => {
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new Error("boom");
      },
    });
    vi.stubGlobal("fetch", undefined);
    const client = createBrowserClient();
    expect(() => client.track("m")).not.toThrow();
  });
});
