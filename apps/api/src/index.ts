import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import pg from "pg";
import { DeviceAuth } from "./auth/device-auth.js";
import { AdminSession } from "./auth/admin-session.js";
import { generatePolicyKeyPair } from "./policy/sign-policy.js";
import { registerEnrollmentRoutes } from "./routes/enrollment.js";
import { registerActivityRoutes } from "./routes/activity.js";
import { registerDevicesRoutes } from "./routes/devices.js";
import { registerSubjectsRoutes } from "./routes/subjects.js";
import { registerPoliciesRoutes } from "./routes/policies.js";
import { registerAdminRoutes } from "./routes/admin.js";

export interface BuildOptions {
  policyPrivateKeyPem?: string;
  policyPublicKeyPem?: string;
  policyFingerprint?: string;
}

export async function buildApp(connString: string, opts: BuildOptions = {}) {
  const pool = new pg.Pool({ connectionString: connString });
  const deviceAuth = new DeviceAuth(pool);
  const sessions = new AdminSession(pool);

  let key = opts.policyPrivateKeyPem
    ? {
        privateKeyPem: opts.policyPrivateKeyPem,
        publicKeyPem: opts.policyPublicKeyPem ?? "",
        fingerprint: opts.policyFingerprint ?? "",
      }
    : generatePolicyKeyPair();

  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

  app.get("/v1/health", async () => ({ ok: true }));

  registerEnrollmentRoutes(app, pool, key.publicKeyPem);
  registerActivityRoutes(app, pool, deviceAuth);
  registerDevicesRoutes(app, pool, sessions);
  registerSubjectsRoutes(app, pool, sessions);
  registerPoliciesRoutes(app, pool, sessions, key);
  registerAdminRoutes(app, pool, sessions);

  return { app, pool, deviceAuth, sessions };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const conn = process.env.DATABASE_URL ?? "postgres://workinsight:workinsight_dev@localhost:5433/workinsight";
  const { app } = await buildApp(conn);
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.BIND_HOST ?? "127.0.0.1";
  await app.listen({ host, port });
  console.log(`api listening on ${host}:${port}`);
}
