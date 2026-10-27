import { pool } from "@workspace/db";
import app from "./app";
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

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Render sends SIGTERM on every deploy. Finish in-flight requests (a waitlist
// signup mid-insert, say) and release the database pool before exiting,
// rather than dropping them.
function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
