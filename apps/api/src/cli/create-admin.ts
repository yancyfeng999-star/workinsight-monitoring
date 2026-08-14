import pg from "pg";
import { hashPasswordArgon2id, randomToken } from "../auth/password.js";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const orgId = process.env.ORG_ID ?? "org_company";
    const username = process.env.ADMIN_USERNAME ?? "admin";
    const password = process.env.ADMIN_PASSWORD;
    const role = process.env.ADMIN_ROLE ?? "company_admin";
    if (!password) throw new Error("ADMIN_PASSWORD is required");
    const passwordHash = await hashPasswordArgon2id(password);
    const adminUserId = "admin_" + randomToken(96).slice(0, 24);
    await client.query(
      `INSERT INTO organizations (org_id, name) VALUES ($1, $2) ON CONFLICT (org_id) DO NOTHING`,
      [orgId, "Company"]
    );
    await client.query(
      `INSERT INTO admin_users (admin_user_id, org_id, username, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING`,
      [adminUserId, orgId, username, passwordHash, role]
    );
    console.log(`admin user ready: ${username} (${role}) @ ${orgId}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
