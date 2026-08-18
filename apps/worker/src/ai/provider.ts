import type { InsightOutput } from "./schema.js";

export interface InsightDataQualityFlags {
  lowCoverage: boolean;
  zeroActiveSeconds: boolean;
  missingCategories: boolean;
}

export interface InsightInput {
  orgId: string;
  teamId: string;
  date: string;
  periodStart: string;
  periodEnd: string;
  coverageRate: number;
  activeSeconds: number;
  categoryTotals: Record<string, number>;
  switchCounts: Record<string, number>;
  dataQualityFlags: InsightDataQualityFlags;
}

export interface InsightProvider {
  generate(input: InsightInput, signal: AbortSignal): Promise<InsightOutput>;
}

export type { InsightOutput };
