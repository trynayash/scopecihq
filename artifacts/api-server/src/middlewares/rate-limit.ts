import type { Request, Response, NextFunction } from "express";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
  /**
   * Answers a limited request instead of the JSON 429. For routes the browser
   * navigates to (sign-in), where raw JSON would be the whole page.
   */
  onLimit?: (req: Request, res: Response) => void;
}

interface RequestRecord {
  timestamps: number[];
}

/**
 * The client a request counts against. `req.ip` honours the app's "trust
 * proxy" setting (reading the first X-Forwarded-For entry directly would
 * trust a value the client wrote). An IPv6 client usually holds a whole /64,
 * so it counts as one client by that prefix; otherwise each new address
 * would get a fresh allowance.
 */
export function clientKey(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!ip.includes(":") || ip.startsWith("::ffff:")) return ip;
  const [head, tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "").toLowerCase()).join(":")}::/64`;
}

/** How often expired entries are swept: often enough that a long window can't let the map grow all day. */
const sweepEvery = (windowMs: number) => Math.min(Math.max(windowMs, 30_000), 5 * 60_000);

/**
 * Lightweight in-memory sliding window rate limiter.
 * Protects public endpoints (waitlist, OAuth initiate, public webhook endpoints)
 * against DoS and credential stuffing.
 */
export function rateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    message = "Too many requests, please try again later.",
    onLimit,
    keyGenerator = clientKey,
  } = options;

  const hits = new Map<string, RequestRecord>();

  // Cleanup expired entries periodically to prevent memory exhaustion
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);
      if (record.timestamps.length === 0) {
        hits.delete(key);
      }
    }
  }, sweepEvery(windowMs));

  // Allow process to exit cleanly without keeping event loop alive
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();

    let record = hits.get(key);
    if (!record) {
      record = { timestamps: [] };
      hits.set(key, record);
    }

    // Filter to timestamps in current window
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

    const count = record.timestamps.length;

    res.setHeader("X-RateLimit-Limit", max.toString());
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - count - 1).toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000).toString());

    if (count >= max) {
      if (onLimit) {
        res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
        onLimit(req, res);
        return;
      }
      res.status(429).json({
        error: "Too Many Requests",
        message,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      });
      return;
    }

    record.timestamps.push(now);
    next();
  };
}

/**
 * Counts only failed attempts, per client, for a secret that scripts also
 * send: once `max` have failed within the window, `blocked` is true until the
 * oldest falls out of it. A plain limiter would also slow the right key down.
 */
export function failureLimiter(options: { windowMs: number; max: number }) {
  const { windowMs, max } = options;
  const failures = new Map<string, number[]>();
  const keyOf = clientKey;

  const live = (key: string, now: number) => (failures.get(key) ?? []).filter((ts) => now - ts < windowMs);

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const key of failures.keys()) {
      const kept = live(key, now);
      if (kept.length === 0) failures.delete(key);
      else failures.set(key, kept);
    }
  }, sweepEvery(windowMs));
  if (cleanupInterval.unref) cleanupInterval.unref();

  return {
    retryAfterSeconds: Math.ceil(windowMs / 1000),
    blocked(req: Request): boolean {
      return live(keyOf(req), Date.now()).length >= max;
    },
    record(req: Request): void {
      const key = keyOf(req);
      const now = Date.now();
      failures.set(key, [...live(key, now), now]);
    },
  };
}
