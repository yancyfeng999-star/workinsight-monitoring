import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(connString: string): Promise<void> {
  const client = new pg.Client({ connectionString: connString });
  await client.connect();
  try {
    const migrationsDir = resolve(__dirname, "../../../../database/migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf8");
      await client.query(sql);
      console.log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const conn = process.env.DATABASE_URL ?? "postgres://workinsight:workinsight_dev@localhost:5433/workinsight";
  migrate(conn)
    .then(() => {
      console.log("migration ok");
      process.exit(0);
    })
    .catch((e) => {
      console.error("migration failed:", e);
      process.exit(1);
    });
}
