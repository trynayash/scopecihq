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
 * non-local host instead, while letting an explicit `sslmode` (or `ssl`) win:
 *
 * - `disable` (or `ssl=false`): no TLS.
 * - `require`, `prefer`, `no-verify` (or `ssl=true`): encrypt, don't verify
 *   the chain, which is what a pooler whose CA is not in Node's trust store
 *   needs.
 * - `verify-full`: verify the chain and the host name, against
 *   `DATABASE_CA_CERT` when it is set (Supabase's and RDS's CAs are not in
 *   Node's trust store), otherwise against Node's.
 * - `verify-ca`: verify the chain but not the host name.
 */
function resolveSsl(rawUrl: string): ConnectionOptions | boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false; // not a URL we can reason about; let `pg` deal with it
  }

  const sslmode = url.searchParams.get("sslmode");
  const ssl = url.searchParams.get("ssl");
  if (sslmode === "disable" || (!sslmode && (ssl === "false" || ssl === "0"))) return false;

  if (sslmode === "verify-full" || sslmode === "verify-ca") {
    // A PEM pasted on one line keeps its line breaks as "\n".
    const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
    return {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
      ...(sslmode === "verify-ca" ? { checkServerIdentity: () => undefined } : {}),
    };
  }

  if (!sslmode && !ssl && LOCAL_HOSTS.has(url.hostname)) return false;

  return { rejectUnauthorized: false };
}

/**
 * The URL without the TLS settings `resolveSsl` has read. Left in, `pg` would
 * parse them again and replace the `ssl` options built above with its own
 * (for `sslmode=require` and `verify-full` alike: verify against Node's
 * trust store, ignoring `DATABASE_CA_CERT`), and every connection to a
 * managed database would fail. `sslrootcert`, `sslcert` and `sslkey` stay:
 * `pg` reads those files and verifies fully, as whoever set them expects.
 */
function withoutTlsSettings(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const keys = ["sslmode", "ssl", "uselibpqcompat"].filter((key) => url.searchParams.has(key));
    if (keys.length === 0) return rawUrl;
    for (const key of keys) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export const pool = new Pool({
  connectionString: withoutTlsSettings(process.env.DATABASE_URL),
  ssl: resolveSsl(process.env.DATABASE_URL),
  // Supabase caps concurrent connections tightly on the smaller plans, and a
  // single long-lived API process does not need many.
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// An idle connection the server drops (a restart, a failover, a pooler
// closing it) is reported here. Without a listener Node treats it as an
// uncaught error and the whole API exits; the pool replaces the connection
// on the next query anyway.
pool.on("error", (err) => {
  console.error(`Postgres dropped an idle connection: ${err.message}`);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
export { dropRetiredIndexes, ensureSchema } from "./ensure-schema.js";
