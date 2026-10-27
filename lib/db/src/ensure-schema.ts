import type { Pool } from "pg";
import { SCHEMA_STATEMENTS, SCHEMA_TABLES } from "./schema-sql.js";

/**
 * Brings the database up to the current schema: creates any table, column,
 * constraint or index that is missing, and never drops or changes anything.
 * The API server runs it on every start, so a deploy never needs a manual
 * `drizzle-kit push` first.
 *
 * It also turns on row level security for every ScopeCI table. On Supabase,
 * tables in `public` are otherwise readable through the auto-generated API by
 * anyone holding the anon key; with RLS on and no policies that API gets
 * nothing, while the server, which connects as the tables' owner, is
 * unaffected.
 */
export async function ensureSchema(pool: Pool): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const client = await pool.connect();
  try {
    // One start at a time: two instances booting together wait for each other.
    await client.query("SELECT pg_advisory_lock(hashtext('scopeci_schema'))");
    try {
      // A single batch runs as one transaction: all of it applies, or none.
      await client.query(SCHEMA_STATEMENTS.join("\n"));

      const roles = await client.query<{ rolname: string }>(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')",
      );
      const apiRoles = roles.rows.map((r) => `"${r.rolname}"`).join(", ");
      for (const table of SCHEMA_TABLES) {
        try {
          await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
          if (apiRoles) {
            await client.query(`REVOKE ALL ON TABLE "${table}" FROM ${apiRoles}`);
            const seq = await client.query<{ seq: string | null }>(
              "SELECT pg_get_serial_sequence($1, 'id') AS seq",
              [`"${table}"`],
            );
            if (seq.rows[0]?.seq) await client.query(`REVOKE ALL ON SEQUENCE ${seq.rows[0].seq} FROM ${apiRoles}`);
          }
        } catch (err) {
          warnings.push(`${table}: ${(err as Error).message}`);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('scopeci_schema'))");
    }
  } finally {
    client.release();
  }
  return { warnings };
}
