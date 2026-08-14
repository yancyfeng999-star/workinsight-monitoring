import { hashToken } from "./password.js";
import type { Pool } from "pg";

export interface DevicePrincipal {
  device_id: string;
  org_id: string;
  subject_id: string;
  revoked: boolean;
}

export class DeviceAuth {
  constructor(private pool: Pool) {}

  async authenticate(bearerToken: string): Promise<DevicePrincipal | null> {
    if (!bearerToken) return null;
    const tokenHash = hashToken(bearerToken);
    const res = await this.pool.query(
      `SELECT device_id, org_id, subject_id, revoked_at, expires_at
       FROM device_credentials WHERE token_hash = $1`,
      [tokenHash]
    );
    const row = res.rows[0];
    if (!row) return null;
    if (row.revoked_at) return { ...row, revoked: true };
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return { device_id: row.device_id, org_id: row.org_id, subject_id: row.subject_id, revoked: false };
  }

  async rotate(deviceId: string, orgId: string, subjectId: string): Promise<{ token: string; expiresAt: string } | null> {
    const token = cryptoRandomToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
    const res = await this.pool.query(
      `UPDATE device_credentials
       SET token_hash = $1, expires_at = $3
       WHERE device_id = $2 AND org_id = $4 AND subject_id = $5 AND revoked_at IS NULL
       RETURNING device_id`,
      [tokenHash, deviceId, expiresAt, orgId, subjectId]
    );
    if (res.rowCount === 0) return null;
    return { token, expiresAt };
  }
}

function cryptoRandomToken(): string {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return randomBytes(32).toString("base64url");
}
