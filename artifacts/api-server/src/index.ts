import { ensureSchema, pool } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { backgroundCount, drain, runInBackground } from "./lib/background";
import { currentWebhookService } from "./routes/github";
import { purgeExpiredDeliveries } from "./github/webhook-service";

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

/** Timers to stop at shutdown, so no new background work starts while the rest finishes. */
const timers: NodeJS.Timeout[] = [];

// Create any missing tables and columns before taking traffic, so a deploy
// never waits on a manual `drizzle-kit push`. It only adds, never drops. A
// failed sync (a deadlock with the instance being replaced, a dropped
// connection) is tried again: three times before listening, then in the
// background with growing waits until it works. The server starts either
// way, since the site and demo don't need the database; meanwhile
// `app.locals.schemaSync` says "behind", for the health check to report.
async function syncSchema(): Promise<boolean> {
  try {
    const started = Date.now();
    const { warnings } = await ensureSchema(pool);
    for (const warning of warnings) logger.warn({ warning }, "Row level security not applied");
    logger.info({ ms: Date.now() - started }, "Database schema is up to date");
    app.locals.schemaSync = "synced";
    return true;
  } catch (err) {
    logger.error({ err }, "Could not bring the database schema up to date");
    app.locals.schemaSync = "behind";
    return false;
  }
}

if (process.env.SCOPECI_SCHEMA_SYNC !== "off") {
  let synced = false;
  for (let attempt = 0; attempt < 3 && !synced; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    synced = await syncSchema();
  }
  if (!synced) {
    const retry = (wait: number) => {
      const timer = setTimeout(() => {
        void syncSchema().then((ok) => {
          if (!ok) retry(Math.min(wait * 2, 5 * 60 * 1000));
        });
      }, wait);
      timer.unref();
      timers.push(timer);
    };
    retry(10_000);
  }
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// GitHub doesn't resend a webhook it gave up on (the server was waking up,
// or a deploy was in flight), so open pull requests are swept regularly and
// any commit without a result is checked. SCOPECI_SWEEP_MS=0 turns it off.
const sweepEvery = Number(process.env.SCOPECI_SWEEP_MS ?? 10 * 60 * 1000);
if (sweepEvery > 0) {
  const sweep = () =>
    runInBackground(
      currentWebhookService()
        .then((service) => service?.sweepMissedPullRequests())
        .catch((err) => logger.warn({ err }, "Sweep for missed pull requests failed")),
    );
  timers.push(setTimeout(sweep, Math.min(30_000, sweepEvery)).unref());
  timers.push(setInterval(sweep, sweepEvery).unref());
}

// Webhook deliveries are kept 30 days, for idempotency and for reading why
// one was ignored; then they are deleted, every hour.
const purge = () =>
  runInBackground(
    purgeExpiredDeliveries()
      .then((deleted) => {
        if (deleted > 0) logger.info({ deleted }, "Deleted expired webhook deliveries");
      })
      .catch((err) => logger.warn({ err }, "Deleting expired webhook deliveries failed")),
  );
timers.push(setTimeout(purge, 60_000).unref());
timers.push(setInterval(purge, 60 * 60 * 1000).unref());

// Render sends SIGTERM on every deploy and allows 30 seconds. Stop taking
// requests, let in-flight ones and background work (a webhook mid-check, a
// re-check) finish for up to 20 seconds, then release the database pool and
// exit. Whatever is still running at 25 seconds is cut off; the sweep on the
// next instance checks any commit that was left without a verdict.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal, background: backgroundCount() }, "Shutting down");
  setTimeout(() => process.exit(1), 25_000).unref();
  for (const timer of timers) clearTimeout(timer);
  server.close(async () => {
    if (!(await drain(20_000))) {
      logger.warn({ background: backgroundCount() }, "Background work was still running at shutdown");
    }
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
}

// Background work (a re-check, a webhook) runs outside any request, so a
// failure there must be logged, not lost. A rejection is logged and the
// server carries on; an exception leaves the process in an unknown state,
// so it is logged and the server restarts cleanly.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception; restarting");
  shutdown("uncaughtException");
});

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
