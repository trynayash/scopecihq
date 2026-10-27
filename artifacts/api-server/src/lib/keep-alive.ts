import { logger } from "./logger";

// Render's free plan stops an instance after 15 minutes without inbound
// requests, and the next visitor waits about a minute while it starts again.
// Its own health checks don't count as traffic, so the server calls its own
// public URL just inside that window. The request leaves the instance and
// comes back through Render's proxy, which is what keeps it awake.
export const KEEP_ALIVE_INTERVAL_MS = 14.5 * 60 * 1000;

// Render sets RENDER_EXTERNAL_URL on every web service, so this only runs
// there. KEEP_ALIVE_URL points it somewhere else; KEEP_ALIVE=off stops it.
export function keepAliveTarget(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.KEEP_ALIVE === "off") return null;
  const base = env.KEEP_ALIVE_URL || env.RENDER_EXTERNAL_URL;
  if (!base) return null;
  try {
    return new URL("/api/healthz", base).toString();
  } catch {
    logger.warn({ base }, "Keep-alive URL is not a valid URL; not pinging");
    return null;
  }
}

// Returns a function that stops the pings. The timer is unref'd so it never
// holds the process open on shutdown.
export function startKeepAlive(
  url: string,
  intervalMs: number = KEEP_ALIVE_INTERVAL_MS,
): () => void {
  const ping = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) logger.warn({ url, status: res.status }, "Keep-alive ping failed");
    } catch (err) {
      logger.warn({ url, err }, "Keep-alive ping failed");
    }
  };
  const timer = setInterval(ping, intervalMs);
  timer.unref();
  logger.info({ url, minutes: intervalMs / 60_000 }, "Keep-alive pings started");
  return () => clearInterval(timer);
}
