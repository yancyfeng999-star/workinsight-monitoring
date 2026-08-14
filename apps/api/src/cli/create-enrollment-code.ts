import pg from "pg";
import { hashToken, randomToken } from "../auth/password.js";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const orgId = process.env.ORG_ID ?? "org_company";
    const subjectId = process.env.SUBJECT_ID;
    if (!subjectId) throw new Error("SUBJECT_ID is required");
    const code = randomToken(256);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await client.query(
      `INSERT INTO enrollment_codes (code_hash, org_id, subject_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [hashToken(code), orgId, subjectId, expiresAt]
    );
    console.log(`enrollment code (expires ${expiresAt}):`);
    console.log(code);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
