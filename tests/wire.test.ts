import { describe, it, expect } from "vitest";
import {
  buildPoint,
  inferClass,
  normalizeTimestampMs,
  validateSourceId,
} from "../src/wire.js";
import { PlexusError } from "../src/errors.js";

describe("validateSourceId", () => {
  it("accepts wire-valid slugs (dots allowed — gateway rule, not Python's)", () => {
    for (const s of ["esp32-bme280", "web.frontend", "a", "sat-25544", "x_1"]) {
      expect(() => validateSourceId(s)).not.toThrow();
    }
  });
  it("rejects invalid and uuid-shaped slugs", () => {
    for (const s of [
      "",
      "Upper",
      "-leading",
      "has space",
      "a".repeat(257),
      "123e4567-e89b-12d3-a456-426614174000",
    ]) {
      expect(() => validateSourceId(s)).toThrow(PlexusError);
    }
  });
});

describe("normalizeTimestampMs", () => {
  it("passes ms through, scales seconds, accepts Date, defaults to now", () => {
    expect(normalizeTimestampMs(1716201600000)).toBe(1716201600000);
    expect(normalizeTimestampMs(1716201600)).toBe(1716201600000);
    const d = new Date(1716201600000);
    expect(normalizeTimestampMs(d)).toBe(1716201600000);
    const now = Date.now();
    expect(normalizeTimestampMs()).toBeGreaterThanOrEqual(now);
  });
  it("rejects non-finite", () => {
    expect(() => normalizeTimestampMs(NaN)).toThrow(PlexusError);
    expect(() => normalizeTimestampMs(Infinity)).toThrow(PlexusError);
  });
});

describe("class inference + buildPoint", () => {
  it("numeric → metric, everything else → event", () => {
    expect(inferClass(1.5)).toBe("metric");
    expect(inferClass("boot")).toBe("event");
    expect(inferClass({ a: 1 })).toBe("event");
    expect(inferClass(true)).toBe("event");
  });
  it("builds wire points with class, tags, run_id", () => {
    const p = buildPoint("temp", 21.5, { tags: { cell: "A1" } }, "run-9");
    expect(p).toMatchObject({
      class: "metric",
      metric: "temp",
      value: 21.5,
      tags: { cell: "A1" },
      run_id: "run-9",
    });
    expect(typeof p.timestamp).toBe("number");
  });
  it("rejects empty metric and non-finite metric values", () => {
    expect(() => buildPoint("", 1, undefined, undefined)).toThrow(PlexusError);
    expect(() =>
      buildPoint("temp", NaN, { class: "metric" }, undefined),
    ).toThrow(PlexusError);
  });
});
