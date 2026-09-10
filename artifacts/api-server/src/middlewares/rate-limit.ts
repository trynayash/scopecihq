import type { Request, Response, NextFunction } from "express";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

interface RequestRecord {
  timestamps: number[];
}

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
    keyGenerator = (req) => {
      const forwarded = req.headers["x-forwarded-for"];
      if (typeof forwarded === "string") {
        return forwarded.split(",")[0].trim();
      }
      return req.ip || req.socket.remoteAddress || "unknown";
    },
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
  }, Math.max(windowMs, 30_000));

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
