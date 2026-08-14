import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { hashToken } from "./password.js";

export type AdminRole = "company_admin" | "manager" | "internal_auditor" | "system_operator";

export interface AdminPrincipal {
  admin_user_id: string;
  org_id: string;
  username: string;
  role: AdminRole;
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = 8 * 3600 * 1000;

export class AdminSession {
  constructor(private pool: Pool) {}

  async create(adminUserId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO admin_sessions (session_id, admin_user_id, token_hash, last_active_at, expires_at)
       VALUES ($1, $2, $3, now(), to_timestamp($4 / 1000.0))`,
      [randomBytes(8).toString("hex"), adminUserId, tokenHash, now + ABSOLUTE_TIMEOUT_MS]
    );
    return token;
  }

  async validate(token: string): Promise<AdminPrincipal | null> {
    const res = await this.pool.query(
      `SELECT s.admin_user_id, u.org_id, u.username, u.role, s.last_active_at, s.expires_at
       FROM admin_sessions s JOIN admin_users u ON u.admin_user_id = s.admin_user_id
       WHERE s.token_hash = $1`,
      [hashToken(token)]
    );
    const row = res.rows[0];
    if (!row) return null;
    const now = Date.now();
    if (new Date(row.expires_at).getTime() < now) return null;
    if (now - new Date(row.last_active_at).getTime() > IDLE_TIMEOUT_MS) return null;
    await this.pool.query(
      `UPDATE admin_sessions SET last_active_at = now() WHERE token_hash = $1`,
      [hashToken(token)]
    );
    return {
      admin_user_id: row.admin_user_id,
      org_id: row.org_id,
      username: row.username,
      role: row.role,
    };
  }

  async destroy(token: string): Promise<void> {
    await this.pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [hashToken(token)]);
  }
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  sessions: AdminSession,
  allowedRoles: AdminRole[]
): Promise<AdminPrincipal | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  const token = header.slice(7);
  const principal = await sessions.validate(token);
  if (!principal) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  if (!allowedRoles.includes(principal.role)) {
    reply.code(403).send({ error: "forbidden: insufficient role" });
    return null;
  }
  return principal;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.header("Set-Cookie", `wi_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/`);
}
