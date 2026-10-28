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

      // Until 28 October 2026 each changed file's diff text was stored with
      // its name. The check only ever read the names, so drop what was kept.
      // Runs on every start and changes nothing once it has.
      await client.query(
        `UPDATE pr_diff_analyses
            SET files_changed_json = (
              SELECT coalesce(jsonb_agg(f.value - 'patch' - 'isTruncated' ORDER BY f.i), '[]'::jsonb)
                FROM jsonb_array_elements(files_changed_json) WITH ORDINALITY AS f(value, i)
            )
          WHERE jsonb_typeof(files_changed_json) = 'array'
            AND jsonb_path_exists(files_changed_json, '$[*].patch')`,
      );

      const roles = await client.query<{ rolname: string }>(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')",
      );
      const apiRoles = roles.rows.map((r) => `"${r.rolname}"`).join(", ");
      for (const table of SCHEMA_TABLES) {
        try {
          await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
          if (apiRoles) {
            await client.query(`REVOKE ALL ON TABLE "${table}" FROM ${apiRoles}`);
            // Serial columns' sequences too; not every table has one.
            const seqs = await client.query<{ seq: string | null }>(
              `SELECT pg_get_serial_sequence(format('%I', table_name), column_name) AS seq
                 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = $1 AND column_default LIKE 'nextval(%'`,
              [table],
            );
            for (const { seq } of seqs.rows) {
              if (seq) await client.query(`REVOKE ALL ON SEQUENCE ${seq} FROM ${apiRoles}`);
            }
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
