import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, waitlistSignupsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { refuseGuessing, secretGuesses, timingSafeCompare } from "../middlewares/auth.js";
import { rateLimiter } from "../middlewares/rate-limit.js";

const router: IRouter = Router();

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/**
 * The admin page signs in once with ADMIN_SECRET and gets back an httpOnly
 * cookie, so the secret never sits in sessionStorage or in a URL (where it
 * ends up in browser history and proxy logs). The cookie holds an expiry and
 * an HMAC of it keyed by ADMIN_SECRET: there is no session table, and
 * rotating the secret signs everyone out.
 *
 * SameSite=Strict means a page on another site can't make the browser send
 * the cookie, which is what protects the DELETE route from CSRF.
 */
const SESSION_COOKIE = "scopeci_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_COOKIE_PATH = "/api/admin";

function signSession(expiresAt: number, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`scopeci-admin-session:${expiresAt}`)
    .digest("base64url");
}

function issueSessionToken(secret: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${expiresAt}.${signSession(expiresAt, secret)}`;
}

function isValidSessionToken(token: string, secret: string): boolean {
  const [rawExpiry, signature] = token.split(".");
  const expiresAt = Number(rawExpiry);
  if (!signature || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return timingSafeCompare(signature, signSession(expiresAt, secret));
}

/** Raw cookie value; session tokens are digits, "." and base64url, so no decoding. */
function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function sessionCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    `Path=${SESSION_COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Accepts the session cookie, or ADMIN_SECRET itself as `Authorization:
 * Bearer <key>` / `x-admin-key` for scripts. Uses constant-time comparison.
 * Returns 401 if the secret is not configured or nothing valid was sent.
 * Wrong keys count towards the same limit as the sign-in form, so sending the
 * key as a header is not an unlimited way to guess it.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // Everything behind this carries signup emails; keep it out of any cache.
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    res.status(401).json({ error: "Admin access is not configured." });
    return;
  }

  const session = readCookie(req, SESSION_COOKIE);
  if (session && isValidSessionToken(session, secret)) {
    next();
    return;
  }

  const authHeader = req.headers["authorization"];
  let provided: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    provided = authHeader.slice(7).trim();
  } else if (typeof req.headers["x-admin-key"] === "string") {
    provided = req.headers["x-admin-key"];
  }

  if (!provided) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  if (secretGuesses.blocked(req)) {
    refuseGuessing(res);
    return;
  }
  if (!timingSafeCompare(provided, secret)) {
    secretGuesses.record(req);
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  next();
}

/** Ten sign-in attempts per IP per 15 minutes is plenty for a person typing. */
const signInRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many sign-in attempts. Wait 15 minutes and try again.",
});

/**
 * POST /admin/session — exchanges ADMIN_SECRET for a session cookie.
 */
router.post("/admin/session", signInRateLimiter, (req, res): void => {
  const secret = process.env.ADMIN_SECRET;
  const provided = typeof req.body?.key === "string" ? req.body.key.trim() : "";

  if (!secret) {
    res.status(401).json({ error: "Admin access is not configured." });
    return;
  }
  if (provided && secretGuesses.blocked(req)) {
    refuseGuessing(res);
    return;
  }
  if (!provided || !timingSafeCompare(provided, secret)) {
    if (provided) secretGuesses.record(req);
    res.status(401).json({ error: "That key is not right." });
    return;
  }

  res.setHeader("Set-Cookie", sessionCookie(issueSessionToken(secret), SESSION_TTL_MS / 1000));
  res.status(204).end();
});

/**
 * DELETE /admin/session — signs out. Needs no session, so a stale cookie can
 * always be cleared.
 */
router.delete("/admin/session", (_req, res): void => {
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  res.status(204).end();
});

router.use("/admin", requireAdmin);

/**
 * GET /admin/session — 204 when signed in; the page calls it on load.
 */
router.get("/admin/session", (_req, res): void => {
  res.status(204).end();
});

/**
 * GET /admin/waitlist — returns all signups as JSON.
 */
router.get("/admin/waitlist", async (req, res): Promise<void> => {
  try {
    const signups = await db
      .select()
      .from(waitlistSignupsTable)
      .orderBy(desc(waitlistSignupsTable.createdAt));

    res.json(signups);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch waitlist");
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * GET /admin/waitlist/stats — returns aggregate counts.
 */
router.get("/admin/waitlist/stats", async (req, res): Promise<void> => {
  try {
    const [stats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        qualified: sql<number>`count(case when ${waitlistSignupsTable.agency} is not null and ${waitlistSignupsTable.agency} != '' then 1 end)::int`,
        recent: sql<number>`count(case when ${waitlistSignupsTable.createdAt} > now() - interval '7 days' then 1 end)::int`,
      })
      .from(waitlistSignupsTable);

    res.json(stats);
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch waitlist stats");
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * One CSV cell. Sanitizes against CSV Formula Injection (OWASP A05): a value
 * starting with a formula character gets a ' in front, and any value with a
 * comma, quote or line break (CR as well as LF: spreadsheets end a row at a
 * bare CR too) is quoted, so nothing after it can start a cell of its own.
 */
export function csvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  // "2026-10-29 06:58:54" (UTC): the form spreadsheets read as a date.
  let str = val instanceof Date ? val.toISOString().replace("T", " ").slice(0, 19) : String(val);

  // Prevent CSV Formula Injection: Prefix dangerous characters with single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /admin/waitlist/csv — downloads signups as CSV, created_at in UTC.
 */
router.get("/admin/waitlist/csv", async (req, res): Promise<void> => {
  try {
    const signups = await db
      .select()
      .from(waitlistSignupsTable)
      .orderBy(desc(waitlistSignupsTable.createdAt));

    const headers = [
      "id", "email", "agency", "utm_source", "utm_medium",
      "utm_campaign", "utm_content", "utm_term", "referrer", "created_at",
    ];

    const rows = signups.map((s) =>
      [
        s.id, s.email, s.agency, s.utmSource, s.utmMedium,
        s.utmCampaign, s.utmContent, s.utmTerm, s.referrer, s.createdAt,
      ]
        .map(csvCell)
        .join(","),
    );

    const csv = [headers.join(","), ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=scopeci-waitlist.csv");
    res.send(csv);
  } catch (error) {
    req.log.error({ err: error }, "Failed to export waitlist CSV");
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * DELETE /admin/waitlist/:id — removes one signup. The privacy policy
 * promises removal on request; this is how that promise is kept.
 */
router.delete("/admin/waitlist/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid signup id." });
    return;
  }

  try {
    const removed = await db
      .delete(waitlistSignupsTable)
      .where(eq(waitlistSignupsTable.id, id))
      .returning({ id: waitlistSignupsTable.id });

    if (removed.length === 0) {
      res.status(404).json({ error: "No signup with that id." });
      return;
    }
    req.log.info({ signupId: id }, "Waitlist signup removed by admin");
    res.status(204).end();
  } catch (error) {
    req.log.error({ err: error }, "Failed to delete waitlist signup");
    res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
