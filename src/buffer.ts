import type { Point } from "./types.js";

/**
 * Store-and-forward buffer for failed sends. FIFO with drop-oldest overflow,
 * mirroring the Python SDK's MemoryBuffer. (A persistent backend is a v1.x
 * seam — see plexus-python's SqliteBuffer for the reference semantics.)
 */
export class MemoryBuffer {
  private points: Point[] = [];

  constructor(
    private readonly maxSize = 10_000,
    private readonly onOverflow?: (dropped: number) => void,
  ) {}

  add(points: Point[]): void {
    this.points.push(...points);
    const overflow = this.points.length - this.maxSize;
    if (overflow > 0) {
      this.points.splice(0, overflow);
      this.onOverflow?.(overflow);
    }
  }

  /** Remove and return everything (prepended to the next send). */
  drain(): Point[] {
    const drained = this.points;
    this.points = [];
    return drained;
  }

  get size(): number {
    return this.points.length;
  }
}
