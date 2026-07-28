import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Plexus } from "../src/client.js";
import { AuthenticationError } from "../src/errors.js";

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn<FetchFn>>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeClient(fetchMock: FetchMock, extra = {}) {
  vi.stubGlobal("fetch", fetchMock);
  return new Plexus({
    apiKey: "plx_test",
    sourceId: "svc-1",
    // Zero delays so retry tests are instant.
    retry: { baseDelayMs: 0, maxDelayMs: 0 },
    timeoutMs: 500,
    ...extra,
  });
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("Plexus.send", () => {
  it("POSTs the wire envelope and resolves true", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(200, { success: true, count: 1, source_id: "svc-1" }),
    );
    const px = makeClient(fetchMock);

    await expect(
      px.send("latency_ms", 42, { tags: { route: "/x" } }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://gateway.plexus.company/ingest");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.source_id).toBe("svc-1");
    expect(body.points[0]).toMatchObject({
      class: "metric",
      metric: "latency_ms",
      value: 42,
      tags: { route: "/x" },
    });
  });

  // The gateway echoes source_id unchanged (suffixing was removed);
  // adoption of a differing echo is kept as forward-compat.
  it("adopts a differing source_id echo (forward-compat)", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(200, { success: true, count: 1, source_id: "svc-1_2" }),
    );
    const px = makeClient(fetchMock);
    await px.send("m", 1);
    expect(px.source).toBe("svc-1_2");
    await px.send("m", 2);
    const body = JSON.parse(
      (fetchMock.mock.calls[1]![1] as RequestInit).body as string,
    );
    expect(body.source_id).toBe("svc-1_2");
  });

  it("retries 500 then succeeds", async () => {
    const fetchMock: FetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: "boom" }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, count: 1 }));
    const px = makeClient(fetchMock);
    await expect(px.send("m", 1)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws AuthenticationError on 401 without retrying", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(401, { error: "invalid API key" }),
    );
    const px = makeClient(fetchMock);
    await expect(px.send("m", 1)).rejects.toBeInstanceOf(AuthenticationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("buffers on exhausted retries, resolves false, then flushes with the next send", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(503, { error: "degraded" }),
    );
    const px = makeClient(fetchMock, {
      retry: { maxRetries: 1, baseDelayMs: 0 },
    });

    await expect(px.send("m", 1)).resolves.toBe(false);
    expect(px.bufferSize).toBe(1);

    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, count: 2 }));
    await expect(px.send("m", 2)).resolves.toBe(true);
    expect(px.bufferSize).toBe(0);
    const lastBody = JSON.parse(
      (fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string,
    );
    // Buffered point rides in front of the fresh one.
    expect(lastBody.points.map((p: { value: number }) => p.value)).toEqual([
      1, 2,
    ]);
  });

  it("re-buffers and resolves false on a non-auth 4xx (no rejection)", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(400, { error: "bad payload" }),
    );
    const px = makeClient(fetchMock);

    // Previously this threw AND dropped the drained points.
    await expect(px.send("m", 1)).resolves.toBe(false);
    expect(px.bufferSize).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // non-retryable — no retries

    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, count: 2 }));
    await expect(px.send("m", 2)).resolves.toBe(true);
    expect(px.bufferSize).toBe(0);
    const lastBody = JSON.parse(
      (fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string,
    );
    expect(lastBody.points).toHaveLength(2); // buffered point recovered
  });

  it("splits large batches into ≤5000-point chunks", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(200, { success: true }),
    );
    const px = makeClient(fetchMock);

    await expect(
      px.sendBatch(
        Array.from({ length: 10_001 }, (_, i) => [`m`, i] as [string, number]),
      ),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(
      ([, init]) =>
        JSON.parse((init as RequestInit).body as string).points.length,
    );
    expect(sizes).toEqual([5000, 5000, 1]);
  });

  it("declares kind once via PATCH after the first successful send", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(200, { success: true, count: 1, source_id: "svc-1" }),
    );
    const px = makeClient(fetchMock, { kind: "service" });
    await px.send("m", 1);
    await px.send("m", 2);
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget PATCH run

    const patches = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit).method === "PATCH",
    );
    expect(patches).toHaveLength(1);
    const [url, init] = patches[0]!;
    expect(url).toBe("https://app.plexus.company/api/sources/svc-1");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      device_type: "service",
    });
  });

  it("tags points with run_id inside run()", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(200, { success: true, count: 1 }),
    );
    const px = makeClient(fetchMock);
    await px.run("run-42", async () => {
      await px.send("m", 1);
    });
    const ingest = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith("/ingest"),
    );
    const body = JSON.parse((ingest[0]![1] as RequestInit).body as string);
    expect(body.points[0].run_id).toBe("run-42");
    // start + end notifications went to /api/runs
    const runs = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith("/api/runs"),
    );
    expect(runs).toHaveLength(2);
  });
});

describe("event()", () => {
  it("forces class event for numeric payloads too", async () => {
    const fetchMock: FetchMock = vi.fn(async () =>
      jsonResponse(200, { success: true, count: 1 }),
    );
    const px = makeClient(fetchMock);
    await px.event("deploy", { sha: "abc" });
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.points[0].class).toBe("event");
  });
});
