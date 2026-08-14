import { describe, it } from "node:test";
import assert from "node:assert/strict";

const MIN_TEAM_SIZE = 5;

function shouldGenerateSummary(memberCount: number): boolean {
  return memberCount >= MIN_TEAM_SIZE;
}

function computeCoverageRate(activeCount: number, totalCount: number): number {
  if (totalCount === 0) return 0;
  return Math.round((activeCount / totalCount) * 10000) / 10000;
}

function computeAvgActiveSeconds(
  memberTotals: number[],
  activeCount: number
): number {
  if (activeCount === 0) return 0;
  const total = memberTotals.reduce((sum, v) => sum + v, 0);
  return Math.round(total / activeCount);
}

function computeTopCategories(
  categoryTotals: Record<string, number>,
  limit = 10
): Record<string, number> {
  const sorted = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  const result: Record<string, number> = {};
  for (const [cat, seconds] of sorted) {
    result[cat] = seconds;
  }
  return result;
}

describe("summarizer", () => {
  describe("team size threshold", () => {
    it("generates summary for team with 5 members", () => {
      assert.equal(shouldGenerateSummary(5), true);
    });

    it("generates summary for team with more than 5 members", () => {
      assert.equal(shouldGenerateSummary(10), true);
    });

    it("skips summary for team with 4 members", () => {
      assert.equal(shouldGenerateSummary(4), false);
    });

    it("skips summary for team with 1 member", () => {
      assert.equal(shouldGenerateSummary(1), false);
    });

    it("skips summary for empty team", () => {
      assert.equal(shouldGenerateSummary(0), false);
    });
  });

  describe("coverage rate", () => {
    it("returns 1.0 when all members are active", () => {
      assert.equal(computeCoverageRate(5, 5), 1.0);
    });

    it("returns 0.5 when half are active", () => {
      assert.equal(computeCoverageRate(3, 6), 0.5);
    });

    it("returns 0.0 when no members are active", () => {
      assert.equal(computeCoverageRate(0, 5), 0);
    });

    it("returns 0.0 for empty team", () => {
      assert.equal(computeCoverageRate(0, 0), 0);
    });

    it("rounds to 4 decimal places", () => {
      assert.equal(computeCoverageRate(1, 3), 0.3333);
    });
  });

  describe("active hours", () => {
    it("calculates average correctly", () => {
      const totals = [3600, 7200, 5400];
      assert.equal(computeAvgActiveSeconds(totals, 3), 5400);
    });

    it("returns 0 when no active members", () => {
      assert.equal(computeAvgActiveSeconds([], 0), 0);
    });

    it("handles single active member", () => {
      assert.equal(computeAvgActiveSeconds([7200], 1), 7200);
    });
  });

  describe("top categories", () => {
    it("returns categories sorted by seconds descending", () => {
      const input = {
        development: 3600,
        browser: 7200,
        communication: 1800,
      };
      const result = computeTopCategories(input);
      const keys = Object.keys(result);
      assert.equal(keys[0], "browser");
      assert.equal(keys[1], "development");
      assert.equal(keys[2], "communication");
    });

    it("limits results to specified count", () => {
      const input: Record<string, number> = {};
      for (let i = 0; i < 20; i++) {
        input[`cat_${i}`] = i * 100;
      }
      const result = computeTopCategories(input, 5);
      assert.equal(Object.keys(result).length, 5);
    });

    it("handles empty input", () => {
      const result = computeTopCategories({});
      assert.equal(Object.keys(result).length, 0);
    });
  });
});
