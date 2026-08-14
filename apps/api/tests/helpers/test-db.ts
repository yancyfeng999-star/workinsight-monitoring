import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const REQUIRED_SUFFIX = "_test";
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../database/migrations");

export function assertTestDatabaseUrl(url: string): void {
  const m = url.match(/\/\/([^/]+)\/(\w+)/);
  if (!m) throw new Error(`cannot parse database URL: ${url}`);
  const dbName = m[2];
  if (!dbName.endsWith(REQUIRED_SUFFIX)) {
    throw new Error(
      `test database must end with ${REQUIRED_SUFFIX}, got "${dbName}"`
    );
  }
}

export async function createTestSchema(adminUrl: string, schemaName: string): Promise<void> {
  assertTestDatabaseUrl(adminUrl);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await client.query(`SET search_path TO "${schemaName}", public`);
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      await client.query(readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"));
    }
  } finally {
    await client.end();
  }
}

export async function dropTestSchema(adminUrl: string, schemaName: string): Promise<void> {
  assertTestDatabaseUrl(adminUrl);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } finally {
    await client.end();
  }
}

export function testSchemaName(): string {
  return `t_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export async function withTestSchema<T>(
  adminUrl: string,
  fn: (schema: string) => Promise<T>
): Promise<T> {
  const schema = testSchemaName();
  await createTestSchema(adminUrl, schema);
  try {
    return await fn(schema);
  } finally {
    await dropTestSchema(adminUrl, schema);
  }
}
