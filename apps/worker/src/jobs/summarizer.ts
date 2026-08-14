import type pg from "pg";

export interface TeamSummaryRow {
  org_id: string;
  team_id: string;
  date: string;
  member_count: number;
  coverage_rate: number;
  avg_active_seconds: number;
  top_categories: Record<string, number>;
}

export interface SummarizerResult {
  teamsProcessed: number;
  summaries: TeamSummaryRow[];
}

const MIN_TEAM_SIZE = 5;

export async function runSummarizer(
  pool: pg.Pool,
  targetDate?: string
): Promise<SummarizerResult> {
  const client = await pool.connect();
  try {
    const date = targetDate ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const teamsRes = await client.query(
      `SELECT t.org_id, t.team_id, t.name,
              COUNT(tm.subject_id)::int AS member_count
       FROM teams t
       JOIN team_memberships tm ON tm.team_id = t.team_id
       JOIN subjects s ON s.subject_id = tm.subject_id AND s.is_active = true
       GROUP BY t.org_id, t.team_id, t.name
       HAVING COUNT(tm.subject_id) >= $1`,
      [MIN_TEAM_SIZE]
    );

    if (teamsRes.rows.length === 0) {
      return { teamsProcessed: 0, summaries: [] };
    }

    const summaries: TeamSummaryRow[] = [];

    await client.query("BEGIN");
    try {
      for (const team of teamsRes.rows) {
        const membersRes = await client.query(
          `SELECT tm.subject_id
           FROM team_memberships tm
           JOIN subjects s ON s.subject_id = tm.subject_id AND s.is_active = true
           WHERE tm.team_id = $1`,
          [team.team_id]
        );

        const memberIds = membersRes.rows.map((r: { subject_id: string }) => r.subject_id);

        const aggRes = await client.query(
          `SELECT subject_id, SUM(total_seconds)::int AS total_seconds
           FROM daily_aggregates
           WHERE org_id = $1
             AND subject_id = ANY($2)
             AND date = $3
           GROUP BY subject_id`,
          [team.org_id, memberIds, date]
        );

        const activeMembers = new Set(
          aggRes.rows
            .filter((r: { total_seconds: number }) => r.total_seconds > 0)
            .map((r: { subject_id: string }) => r.subject_id)
        );
        const coverageRate = memberIds.length > 0
          ? activeMembers.size / memberIds.length
          : 0;

        let totalActiveSeconds = 0;
        for (const row of aggRes.rows as Array<{ total_seconds: number }>) {
          totalActiveSeconds += row.total_seconds;
        }
        const avgActiveSeconds = activeMembers.size > 0
          ? Math.round(totalActiveSeconds / activeMembers.size)
          : 0;

        const catRes = await client.query(
          `SELECT category, SUM(total_seconds)::int AS total_seconds
           FROM daily_aggregates
           WHERE org_id = $1
             AND subject_id = ANY($2)
             AND date = $3
           GROUP BY category
           ORDER BY total_seconds DESC
           LIMIT 10`,
          [team.org_id, memberIds, date]
        );

        const topCategories: Record<string, number> = {};
        for (const row of catRes.rows as Array<{ category: string; total_seconds: number }>) {
          topCategories[row.category] = row.total_seconds;
        }

        const summary: TeamSummaryRow = {
          org_id: team.org_id,
          team_id: team.team_id,
          date,
          member_count: team.member_count,
          coverage_rate: Math.round(coverageRate * 10000) / 10000,
          avg_active_seconds: avgActiveSeconds,
          top_categories: topCategories,
        };

        await client.query(
          `INSERT INTO team_summaries
             (org_id, team_id, date, member_count, coverage_rate, avg_active_seconds, top_categories)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (org_id, team_id, date)
           DO UPDATE SET
             member_count = EXCLUDED.member_count,
             coverage_rate = EXCLUDED.coverage_rate,
             avg_active_seconds = EXCLUDED.avg_active_seconds,
             top_categories = EXCLUDED.top_categories,
             generated_at = now()`,
          [
            summary.org_id,
            summary.team_id,
            summary.date,
            summary.member_count,
            summary.coverage_rate,
            summary.avg_active_seconds,
            JSON.stringify(summary.top_categories),
          ]
        );

        summaries.push(summary);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    return { teamsProcessed: summaries.length, summaries };
  } finally {
    client.release();
  }
}
