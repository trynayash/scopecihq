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
      // The batch locks every table it touches. Behind a long transaction on
      // the instance being replaced it gives up after 5 seconds, releasing
      // what it holds, rather than stall that instance's traffic; the server
      // tries the sync again.
      await client.query("SET lock_timeout = '5s'");

      // A single batch runs as one transaction: all of it applies, or none.
      await client.query(SCHEMA_STATEMENTS.join("\n"));

      // A pull request could have only one change order until 29 October
      // 2026; now later excluded work gets its own. This is the one index
      // the schema has ever given up, so it is dropped by name here.
      await client.query('DROP INDEX IF EXISTS "co_pull_request_uidx"');

      // Until 29 October 2026 there was one open change order per pull
      // request; now one per pull request per project. The replacement,
      // created above, is looser, so existing rows already satisfy it. The
      // code being replaced never relied on this index, so it goes now.
      // (Its pull request index waits: see dropRetiredIndexes.)
      await client.query('DROP INDEX IF EXISTS "co_pull_request_open_uidx"');

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
      // The connection goes back to the pool: queries there wait as long as they need.
      await client.query("RESET lock_timeout").catch(() => undefined);
      await client.query("SELECT pg_advisory_unlock(hashtext('scopeci_schema'))");
    }
  } finally {
    client.release();
  }
  return { warnings };
}

/**
 * Until 29 October 2026 a pull request had one row whatever project checked
 * it, so connecting its repository to another project (or another workspace)
 * moved the row there, change orders and all. Now each project keeps its own
 * row, under a looser unique index created by ensureSchema.
 *
 * The old index is dropped only after the instance being replaced has gone:
 * its pull request upsert names the old index's columns, and fails without
 * it. The server calls this a few minutes after it starts listening. Until
 * then, a pull request moving to another project can't be checked there yet
 * (the sweep checks it once this has run).
 *
 * Before rolling back past this change, delete the extra per-project
 * pull_requests rows and open change orders, or the older code's schema
 * sync and pull request upserts fail.
 */
export async function dropRetiredIndexes(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('scopeci_schema'))");
    try {
      await client.query("SET lock_timeout = '5s'");
      await client.query('DROP INDEX IF EXISTS "pr_provider_external_uidx"');
    } finally {
      await client.query("RESET lock_timeout").catch(() => undefined);
      await client.query("SELECT pg_advisory_unlock(hashtext('scopeci_schema'))");
    }
  } finally {
    client.release();
  }
}
