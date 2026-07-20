import { describe, it, expect } from "vitest";
import {
  DEFAULT_RETRY,
  isRetryableStatus,
  retryDelayMs,
} from "../src/retry.js";
import { MemoryBuffer } from "../src/buffer.js";
import type { Point } from "../src/types.js";

const point = (i: number): Point => ({
  class: "metric",
  metric: `m${i}`,
  value: i,
  timestamp: 1_716_201_600_000 + i,
});

describe("retry policy", () => {
  it("retries 429 and 5xx only", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
  });

  it("backs off exponentially with a cap (Python parity)", () => {
    const cfg = { ...DEFAULT_RETRY, jitter: false };
    expect(retryDelayMs(0, cfg)).toBe(1000);
    expect(retryDelayMs(1, cfg)).toBe(2000);
    expect(retryDelayMs(2, cfg)).toBe(4000);
    expect(retryDelayMs(10, cfg)).toBe(30_000);
  });

  it("jitters into 50–100% of the computed delay", () => {
    expect(retryDelayMs(1, DEFAULT_RETRY, () => 0)).toBe(1000);
    expect(retryDelayMs(1, DEFAULT_RETRY, () => 1)).toBe(2000);
  });
});

describe("MemoryBuffer", () => {
  it("drops oldest on overflow and reports the count", () => {
    let dropped = 0;
    const buf = new MemoryBuffer(3, (n) => (dropped += n));
    buf.add([point(1), point(2), point(3)]);
    buf.add([point(4), point(5)]);
    expect(dropped).toBe(2);
    expect(buf.size).toBe(3);
    expect(buf.drain().map((p) => p.metric)).toEqual(["m3", "m4", "m5"]);
    expect(buf.size).toBe(0);
  });
});
