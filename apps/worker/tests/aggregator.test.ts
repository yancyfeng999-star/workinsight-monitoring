import { describe, it } from "node:test";
import assert from "node:assert/strict";

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clampSegment(
  segStart: Date,
  segEnd: Date,
  dayStart: Date,
  dayEnd: Date
): { clampedStart: Date; clampedEnd: Date } | null {
  const start = segStart > dayStart ? segStart : dayStart;
  const end = segEnd < dayEnd ? segEnd : dayEnd;
  if (start >= end) return null;
  return { clampedStart: start, clampedEnd: end };
}

function splitSegmentAcrossDays(startedAt: Date, endedAt: Date): Map<string, number> {
  const result = new Map<string, number>();
  const dayMs = 24 * 60 * 60 * 1000;
  const segStart = new Date(startedAt);
  const segEnd = new Date(endedAt);

  let currentDayStart = new Date(segStart);
  currentDayStart.setUTCHours(0, 0, 0, 0);

  while (currentDayStart < segEnd) {
    const currentDayEnd = new Date(currentDayStart.getTime() + dayMs);
    const clamped = clampSegment(segStart, segEnd, currentDayStart, currentDayEnd);
    if (clamped) {
      const seconds = Math.floor(
        (clamped.clampedEnd.getTime() - clamped.clampedStart.getTime()) / 1000
      );
      if (seconds > 0) {
        const dk = dateKey(currentDayStart);
        result.set(dk, (result.get(dk) ?? 0) + seconds);
      }
    }
    currentDayStart = currentDayEnd;
  }

  return result;
}

describe("aggregator", () => {
  describe("single segment", () => {
    it("aggregates a simple within-day segment", () => {
      const start = new Date("2025-01-15T10:00:00Z");
      const end = new Date("2025-01-15T10:30:00Z");
      const splits = splitSegmentAcrossDays(start, end);

      assert.equal(splits.size, 1);
      assert.equal(splits.get("2025-01-15"), 1800);
    });

    it("computes correct seconds for 1-hour segment", () => {
      const start = new Date("2025-01-15T14:00:00Z");
      const end = new Date("2025-01-15T15:00:00Z");
      const splits = splitSegmentAcrossDays(start, end);

      assert.equal(splits.get("2025-01-15"), 3600);
    });
  });

  describe("cross-midnight segments", () => {
    it("splits a segment crossing midnight into two days", () => {
      const start = new Date("2025-01-15T23:00:00Z");
      const end = new Date("2025-01-16T01:00:00Z");
      const splits = splitSegmentAcrossDays(start, end);

      assert.equal(splits.size, 2);
      assert.equal(splits.get("2025-01-15"), 3600);
      assert.equal(splits.get("2025-01-16"), 3600);
    });

    it("handles segment crossing two midnights", () => {
      const start = new Date("2025-01-15T23:00:00Z");
      const end = new Date("2025-01-17T01:00:00Z");
      const splits = splitSegmentAcrossDays(start, end);

      assert.equal(splits.size, 3);
      assert.equal(splits.get("2025-01-15"), 3600);
      assert.equal(splits.get("2025-01-16"), 86400);
      assert.equal(splits.get("2025-01-17"), 3600);
    });
  });

  describe("overlap handling", () => {
    it("two overlapping segments produce separate day entries", () => {
      const seg1Start = new Date("2025-01-15T10:00:00Z");
      const seg1End = new Date("2025-01-15T11:00:00Z");
      const seg2Start = new Date("2025-01-15T10:30:00Z");
      const seg2End = new Date("2025-01-15T11:30:00Z");

      const splits1 = splitSegmentAcrossDays(seg1Start, seg1End);
      const splits2 = splitSegmentAcrossDays(seg2Start, seg2End);

      assert.equal(splits1.get("2025-01-15"), 3600);
      assert.equal(splits2.get("2025-01-15"), 3600);
    });
  });

  describe("time conservation", () => {
    it("total seconds across all days equals segment duration", () => {
      const start = new Date("2025-01-15T22:30:00Z");
      const end = new Date("2025-01-16T02:45:00Z");
      const expectedTotal = Math.floor((end.getTime() - start.getTime()) / 1000);

      const splits = splitSegmentAcrossDays(start, end);
      let total = 0;
      for (const seconds of splits.values()) {
        total += seconds;
      }

      assert.equal(total, expectedTotal);
      assert.equal(total, 15300);
    });

    it("conserves time for multi-day segment", () => {
      const start = new Date("2025-01-15T10:00:00Z");
      const end = new Date("2025-01-18T15:00:00Z");
      const expectedTotal = Math.floor((end.getTime() - start.getTime()) / 1000);

      const splits = splitSegmentAcrossDays(start, end);
      let total = 0;
      for (const seconds of splits.values()) {
        total += seconds;
      }

      assert.equal(total, expectedTotal);
    });
  });

  describe("empty data", () => {
    it("handles zero-duration segment", () => {
      const t = new Date("2025-01-15T10:00:00Z");
      const splits = splitSegmentAcrossDays(t, t);
      assert.equal(splits.size, 0);
    });
  });
});
