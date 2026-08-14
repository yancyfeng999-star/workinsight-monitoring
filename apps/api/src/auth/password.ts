import { createHash, randomBytes } from "node:crypto";

const ARGON2_OPTIONS = {
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPasswordArgon2id(password: string): Promise<string> {
  const argon2 = await import("argon2");
  return argon2.hash(password, {
    type: argon2.argon2id,
    ...ARGON2_OPTIONS,
  });
}

export async function verifyPasswordArgon2id(hash: string, password: string): Promise<boolean> {
  const argon2 = await import("argon2");
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bits = 256): string {
  const bytes = Math.ceil(bits / 8);
  return randomBytes(bytes).toString("base64url");
}

export async function createAdmin(
  url: string,
  orgName: string,
  username: string,
  password: string,
  role: string
): Promise<void> {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS public`);
    await client.query("SET search_path TO public");
    const org = await client.query(
      "INSERT INTO organizations (org_id, name) VALUES ($1, $2) ON CONFLICT (org_id) DO NOTHING RETURNING org_id",
      ["org_company", orgName]
    );
    const orgId = org.rows[0]?.org_id ?? "org_company";
    const hash = await hashPasswordArgon2id(password);
    await client.query(
      `INSERT INTO admin_users (admin_user_id, org_id, username, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING`,
      ["admin_" + randomToken(96).slice(0, 24), orgId, username, hash, role]
    );
    console.log(`created admin user ${username} (${role}) in ${orgId}`);
  } finally {
    await client.end();
  }
}
