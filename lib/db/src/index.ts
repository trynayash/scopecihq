import type { ConnectionOptions } from "node:tls";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

/**
 * Managed Postgres (Supabase, Neon, RDS) refuses unencrypted connections, and
 * a bare connection string carries no TLS settings — so a pasted Supabase URL
 * fails to connect until `?sslmode=` is appended. Default to TLS for any
 * non-local host instead, while letting an explicit `sslmode` win.
 *
 * `require` is Postgres' own name for "encrypt, don't verify the chain", which
 * is what `pg` does for a bare `ssl: true` against a proxy whose CA is not in
 * the Node trust store. Set `sslmode=verify-full` (and `DATABASE_CA_CERT`) when
 * the certificate chain should be checked as well.
 */
function resolveSsl(rawUrl: string): ConnectionOptions | boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false; // not a URL we can reason about; let `pg` deal with it
  }

  const sslmode = url.searchParams.get("sslmode");
  if (sslmode === "disable") return false;

  if (sslmode === "verify-full" || sslmode === "verify-ca") {
    return {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : {}),
    };
  }

  if (!sslmode && LOCAL_HOSTS.has(url.hostname)) return false;

  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: resolveSsl(process.env.DATABASE_URL),
  // Supabase caps concurrent connections tightly on the smaller plans, and a
  // single long-lived API process does not need many.
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
