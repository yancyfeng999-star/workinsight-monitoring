import pg from "pg";

const REQUIRED_SUFFIX = "_test";

async function main(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required");
  const m = url.match(/\/\/([^/]+)\/(\w+)/);
  if (!m) throw new Error(`cannot parse database URL: ${url}`);
  const dbName = m[2];
  if (!dbName.endsWith(REQUIRED_SUFFIX)) {
    throw new Error(`TEST_DATABASE_URL database must end with ${REQUIRED_SUFFIX}, got "${dbName}"`);
  }
  const serverUrl = url.slice(0, url.lastIndexOf("/") + 1) + "postgres";
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`created test database ${dbName}`);
    } else {
      console.log(`test database ${dbName} already exists`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
