import type pg from "pg";

export interface AggregateRow {
  org_id: string;
  subject_id: string;
  date: string;
  category: string;
  app_id: string | null;
  registrable_domain: string | null;
  total_seconds: number;
  segment_count: number;
  first_active_at: Date | null;
  last_active_at: Date | null;
}

export interface AggregationResult {
  datesProcessed: string[];
  totalRows: number;
  aggregates: AggregateRow[];
}

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

interface Segment {
  org_id: string;
  subject_id: string;
  started_at: Date;
  ended_at: Date;
  app_id: string;
  registrable_domain: string | null;
  category: string;
  subcategory: string | null;
}

interface AggregateKey {
  org_id: string;
  subject_id: string;
  date: string;
  category: string;
  app_id: string | null;
  registrable_domain: string | null;
}

function makeKey(k: AggregateKey): string {
  return `${k.org_id}|${k.subject_id}|${k.date}|${k.category}|${k.app_id ?? ""}|${k.registrable_domain ?? ""}`;
}

function splitSegmentAcrossDays(seg: Segment): Map<string, number> {
  const result = new Map<string, number>();
  const dayMs = 24 * 60 * 60 * 1000;
  const segStart = new Date(seg.started_at);
  const segEnd = new Date(seg.ended_at);

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

export async function runAggregator(
  pool: pg.Pool,
  fromDate?: string,
  toDate?: string
): Promise<AggregationResult> {
  const client = await pool.connect();
  try {
    const waterRes = await client.query(
      `SELECT last_processed_at FROM worker_watermarks WHERE job_name = 'aggregator'`
    );
    const since = waterRes.rows[0]?.last_processed_at ?? new Date(0);

    const dateFilter = fromDate && toDate
      ? `AND s.started_at >= $2 AND s.started_at < $3`
      : "";

    const params: unknown[] = [since];
    if (fromDate && toDate) {
      params.push(fromDate, toDate);
    }

    const segmentsRes = await client.query(
      `SELECT s.org_id, s.subject_id, s.started_at, s.ended_at,
              s.app_id, s.registrable_domain,
              COALESCE(c.category, 'uncategorized') AS category,
              c.subcategory
       FROM activity_segments s
       LEFT JOIN activity_classifications c ON c.event_id = s.event_id
       WHERE s.received_at > $1 ${dateFilter}
       ORDER BY s.org_id, s.subject_id, s.started_at`,
      params
    );

    const buckets = new Map<string, AggregateKey & {
      total_seconds: number;
      segment_count: number;
      first_active_at: Date | null;
      last_active_at: Date | null;
    }>();

    const processedDates = new Set<string>();

    for (const seg of segmentsRes.rows) {
      const segTyped: Segment = {
        org_id: seg.org_id,
        subject_id: seg.subject_id,
        started_at: new Date(seg.started_at),
        ended_at: new Date(seg.ended_at),
        app_id: seg.app_id,
        registrable_domain: seg.registrable_domain,
        category: seg.category,
        subcategory: seg.subcategory,
      };

      const daySplits = splitSegmentAcrossDays(segTyped);

      for (const [dateStr, seconds] of daySplits) {
        processedDates.add(dateStr);

        const aggKey: AggregateKey = {
          org_id: segTyped.org_id,
          subject_id: segTyped.subject_id,
          date: dateStr,
          category: segTyped.category,
          app_id: segTyped.app_id,
          registrable_domain: segTyped.registrable_domain,
        };

        const keyStr = makeKey(aggKey);
        const existing = buckets.get(keyStr);
        if (existing) {
          existing.total_seconds += seconds;
          existing.segment_count += 1;
          if (segTyped.started_at < (existing.first_active_at ?? segTyped.started_at)) {
            existing.first_active_at = segTyped.started_at;
          }
          if (segTyped.ended_at > (existing.last_active_at ?? segTyped.ended_at)) {
            existing.last_active_at = segTyped.ended_at;
          }
        } else {
          buckets.set(keyStr, {
            ...aggKey,
            total_seconds: seconds,
            segment_count: 1,
            first_active_at: segTyped.started_at,
            last_active_at: segTyped.ended_at,
          });
        }
      }
    }

    if (buckets.size === 0) {
      return { datesProcessed: [], totalRows: 0, aggregates: [] };
    }

    await client.query("BEGIN");
    try {
      for (const [, bucket] of buckets) {
        await client.query(
          `INSERT INTO daily_aggregates
             (org_id, subject_id, date, category, app_id, registrable_domain,
              total_seconds, segment_count, first_active_at, last_active_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (org_id, subject_id, date, category, app_id, registrable_domain)
           DO UPDATE SET
             total_seconds = daily_aggregates.total_seconds + EXCLUDED.total_seconds,
             segment_count = daily_aggregates.segment_count + EXCLUDED.segment_count,
             first_active_at = LEAST(daily_aggregates.first_active_at, EXCLUDED.first_active_at),
             last_active_at = GREATEST(daily_aggregates.last_active_at, EXCLUDED.last_active_at),
             aggregated_at = now()`,
          [
            bucket.org_id,
            bucket.subject_id,
            bucket.date,
            bucket.category,
            bucket.app_id,
            bucket.registrable_domain,
            bucket.total_seconds,
            bucket.segment_count,
            bucket.first_active_at,
            bucket.last_active_at,
          ]
        );
      }

      await client.query(
        `INSERT INTO worker_watermarks (job_name, last_processed_at)
         VALUES ('aggregator', now())
         ON CONFLICT (job_name) DO UPDATE SET last_processed_at = now(), updated_at = now()`
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    const aggregates: AggregateRow[] = [];
    for (const [, bucket] of buckets) {
      aggregates.push({
        org_id: bucket.org_id,
        subject_id: bucket.subject_id,
        date: bucket.date,
        category: bucket.category,
        app_id: bucket.app_id,
        registrable_domain: bucket.registrable_domain,
        total_seconds: bucket.total_seconds,
        segment_count: bucket.segment_count,
        first_active_at: bucket.first_active_at,
        last_active_at: bucket.last_active_at,
      });
    }

    return {
      datesProcessed: [...processedDates].sort(),
      totalRows: aggregates.length,
      aggregates,
    };
  } finally {
    client.release();
  }
}
