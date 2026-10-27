import { ensureSchema, pool } from "@workspace/db";
import app from "./app";
import { keepAliveTarget, startKeepAlive } from "./lib/keep-alive";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Create any missing tables and columns before taking traffic, so a deploy
// never waits on a manual `drizzle-kit push`. It only adds, never drops. If
// the database refuses (permissions, an outage), the server still starts:
// the site and demo don't need the new tables, and the error is logged.
if (process.env.SCOPECI_SCHEMA_SYNC !== "off") {
  try {
    const started = Date.now();
    const { warnings } = await ensureSchema(pool);
    for (const warning of warnings) logger.warn({ warning }, "Row level security not applied");
    logger.info({ ms: Date.now() - started }, "Database schema is up to date");
  } catch (err) {
    logger.error({ err }, "Could not bring the database schema up to date");
  }
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

const keepAliveUrl = keepAliveTarget();
const stopKeepAlive = keepAliveUrl ? startKeepAlive(keepAliveUrl) : () => {};

// Render sends SIGTERM on every deploy. Finish in-flight requests (a waitlist
// signup mid-insert, say) and release the database pool before exiting,
// rather than dropping them.
function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  stopKeepAlive();
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
