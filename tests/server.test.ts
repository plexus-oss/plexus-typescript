import { afterEach, describe, expect, it, vi } from "vitest";
import { createIngestProxy } from "../src/server.js";

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn<FetchFn>>;

function beaconRequest(payload: unknown): Request {
  return new Request("http://localhost/api/plexus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("createIngestProxy", () => {
  it("forwards an allowlisted metric and always returns 204", async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const handler = createIngestProxy({
      sourceId: "web-frontend",
      apiKey: "plx_test",
      allowMetrics: ["page_view"],
    });

    const res = await handler(
      beaconRequest({ metric: "page_view", value: 1, session: "abcd1234-x" }),
    );
    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.source_id).toBe("web-frontend");
    expect(body.points[0]).toMatchObject({
      class: "metric",
      metric: "page_view",
      value: 1,
      tags: { session: "abcd1234-x" },
    });
  });

  it("drops non-allowlisted metrics without forwarding (still 204)", async () => {
    const fetchMock: FetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = createIngestProxy({
      sourceId: "web-frontend",
      apiKey: "plx_test",
      allowMetrics: ["page_view"],
    });
    const res = await handler(
      beaconRequest({ metric: "evil_metric", value: 1 }),
    );
    expect(res.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filters tags by allowlist and clamps values", async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const handler = createIngestProxy({
      sourceId: "web-frontend",
      apiKey: "plx_test",
      tagAllowlist: ["page"],
      maxValue: 100,
    });
    await handler(
      beaconRequest({
        metric: "read_seconds",
        value: 99999,
        tags: { page: "/pricing", secret: "nope" },
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.points[0].value).toBe(100);
    expect(body.points[0].tags).toEqual({ page: "/pricing" });
  });

  it("returns 204 even when the gateway forward fails or the body is garbage", async () => {
    const fetchMock: FetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = createIngestProxy({ sourceId: "web", apiKey: "plx_test" });
    expect(
      (await handler(beaconRequest({ metric: "m", value: 1 }))).status,
    ).toBe(204);
    const bad = new Request("http://localhost/api/plexus", {
      method: "POST",
      body: "not json",
    });
    expect((await handler(bad)).status).toBe(204);
  });

  it("no-ops calmly with no API key configured", async () => {
    const fetchMock: FetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const prev = process.env.PLEXUS_API_KEY;
    delete process.env.PLEXUS_API_KEY;
    try {
      const handler = createIngestProxy({ sourceId: "web" });
      const res = await handler(beaconRequest({ metric: "m", value: 1 }));
      expect(res.status).toBe(204);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.PLEXUS_API_KEY = prev;
    }
  });
});
