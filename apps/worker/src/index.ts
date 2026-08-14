import pg from "pg";
import { runClassifier } from "./jobs/classifier.js";
import { runAggregator } from "./jobs/aggregator.js";
import { runSummarizer } from "./jobs/summarizer.js";

const DEFAULT_INTERVAL_MS = 60_000;
const CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgres://workinsight:workinsight_dev@localhost:5433/workinsight";

async function runOnce(pool: pg.Pool): Promise<void> {
  console.log("[worker] running classifier...");
  const classResult = await runClassifier(pool);
  console.log(
    `[worker] classifier done: ${classResult.classified} classified, ${classResult.skipped} skipped`
  );

  console.log("[worker] running aggregator...");
  const aggResult = await runAggregator(pool);
  console.log(
    `[worker] aggregator done: ${aggResult.totalRows} aggregates across ${aggResult.datesProcessed.length} date(s)`
  );

  console.log("[worker] running summarizer...");
  const summResult = await runSummarizer(pool);
  console.log(`[worker] summarizer done: ${summResult.teamsProcessed} team(s)`);

  console.log("[worker] cycle complete");
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const pool = new pg.Pool({ connectionString: CONNECTION_STRING });

  const shutdown = async () => {
    console.log("[worker] shutting down...");
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    if (once) {
      await runOnce(pool);
      await pool.end();
      return;
    }

    const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    console.log(`[worker] starting loop every ${intervalMs}ms`);

    while (true) {
      try {
        await runOnce(pool);
      } catch (err) {
        console.error("[worker] cycle error:", err);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } catch (err) {
    console.error("[worker] fatal:", err);
    await pool.end();
    process.exit(1);
  }
}

main();
