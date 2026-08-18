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

const SESSION_COOKIE = "wi_session";

export function readSessionToken(req: FastifyRequest): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    const bearer = authorization.slice("Bearer ".length).trim();
    if (bearer.length > 0) return bearer;
  }
  return readNamedCookie(req.headers.cookie, SESSION_COOKIE);
}

function readNamedCookie(header: string | string[] | undefined, name: string): string | null {
  if (header === undefined) return null;
  const raw = Array.isArray(header) ? header.join("; ") : header;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    if (value.length === 0) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function sessionCookieSecure(reply: FastifyReply): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return reply.request.protocol === "https";
}

function sessionCookie(value: string, reply: FastifyReply, extras: string[] = []): string {
  const parts = [`${SESSION_COOKIE}=${value}`, "HttpOnly", "SameSite=Strict", "Path=/", ...extras];
  if (sessionCookieSecure(reply)) parts.push("Secure");
  return parts.join("; ");
}

export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  sessions: AdminSession,
  allowedRoles: AdminRole[]
): Promise<AdminPrincipal | null> {
  const token = readSessionToken(req);
  if (!token) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
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
  reply.header("Set-Cookie", sessionCookie(token, reply));
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header("Set-Cookie", sessionCookie("", reply, ["Max-Age=0"]));
}
