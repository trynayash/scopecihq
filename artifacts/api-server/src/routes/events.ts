import { Router, type IRouter } from "express";
import { gte, lt, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { db, siteEventsTable } from "@workspace/db";
import { rateLimiter } from "../middlewares/rate-limit.js";

const router: IRouter = Router();

/**
 * Rate limiter: 60 events per minute per IP for public site telemetry.
 * Protects against event queue flooding.
 */
export const eventsRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many site events. Rate limit exceeded.",
});

/**
 * A visitor sends a handful of events per page, so 100 a day from one
 * address is far more than anyone browsing. Past that it's a script, and it
 * shouldn't use up the whole site's daily allowance below.
 */
export const eventsDailyLimiter = rateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 100,
  message: "Too many site events from this address today.",
});

/**
 * The events the site actually sends. Anything else is rejected, so the
 * table can't be filled with arbitrary strings by someone scripting the
 * endpoint. Add a name here when the site starts sending a new one.
 */
export const KNOWN_EVENTS = new Set([
  "page_view",
  "scroll_50",
  "scroll_90",
  "hero_cta_click",
  "faq_opened",
  "waitlist_started",
  "waitlist_submitted",
  "waitlist_success",
  "waitlist_duplicate",
  "waitlist_error",
  "try_opened",
  "try_sow_read",
  "try_github_pr_loaded",
  "try_evaluated",
  "try_change_order_copied",
  "try_waitlist_click",
  "contact_submitted",
  "contact_sent",
  "contact_error",
]);

/** A campaign tag (utm_source and the like), trimmed and kept short. */
export function clipTag(value: unknown, max = 100): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The page that linked here, as its origin and path. The query string and
 * fragment are dropped: they can carry search terms or someone's email
 * address, and they are where a script would pad a row. Anything that isn't
 * an http(s) address is dropped.
 */
export function referringPage(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

/** A path on this site, as the site sends it (location.pathname, which is ASCII). */
function sitePath(value: unknown): string | null {
  return typeof value === "string" && /^\/(?!\/)[\x21-\x7e]*$/.test(value) ? value.slice(0, 200) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Events kept per UTC day across all visitors, and for how long. */
const DAILY_EVENT_LIMIT = 2000;
const KEEP_EVENTS_DAYS = 90;
/**
 * Signups and the steps to them are what the numbers are for: they get room
 * past the daily limit, so page views on a busy day (or a script) can't
 * crowd them out.
 */
const CONVERSION_EVENTS = new Set([
  "waitlist_started",
  "waitlist_submitted",
  "waitlist_success",
  "waitlist_duplicate",
  "waitlist_error",
  "try_waitlist_click",
]);
const CONVERSION_RESERVE = 500;

/**
 * Bounds what the events table can hold: at most `limit` rows a UTC day,
 * and rows older than `keepDays` are deleted when a new day starts. The
 * day's count is read from the table, so a restart (a deploy, or the host
 * waking the service) doesn't hand out a fresh allowance. The returned
 * function answers whether one more event may be stored today; a
 * conversion event may use `reserve` more.
 */
export function dailyEventBudget(limit: number, keepDays: number, reserve = 0) {
  let day = "";
  let used = 0;
  let warned = false;
  let ready: Promise<void> = Promise.resolve();

  const startDay = async (today: string, log: Logger) => {
    try {
      await db.delete(siteEventsTable).where(lt(siteEventsTable.createdAt, new Date(Date.now() - keepDays * DAY_MS)));
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(siteEventsTable)
        .where(gte(siteEventsTable.createdAt, new Date(`${today}T00:00:00Z`)));
      used = row?.count ?? 0;
    } catch (err) {
      log.warn({ err }, "Could not prune or count site events");
    }
  };

  return async (log: Logger, event?: string): Promise<boolean> => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      used = 0;
      warned = false;
      ready = startDay(today, log);
    }
    await ready;
    if (used >= limit + (event && CONVERSION_EVENTS.has(event) ? reserve : 0)) {
      if (!warned) {
        warned = true;
        log.warn({ limit }, "Daily site-event limit reached; events are dropped until 00:00 UTC");
      }
      return false;
    }
    used += 1;
    return true;
  };
}

const roomForEvent = dailyEventBudget(DAILY_EVENT_LIMIT, KEEP_EVENTS_DAYS, CONVERSION_RESERVE);

/**
 * Lightweight analytics endpoint. Answers at once, then stores the event,
 * so the client is never blocked on the database write.
 */
router.post("/events", eventsRateLimiter, eventsDailyLimiter, async (req, res): Promise<void> => {
  const { event, source, medium, campaign, referrer, landingPage } = req.body ?? {};

  if (!event || typeof event !== "string") {
    res.status(400).json({ error: "Missing event name." });
    return;
  }
  if (!KNOWN_EVENTS.has(event)) {
    res.status(400).json({ error: "Unknown event name." });
    return;
  }

  res.status(202).json({ accepted: true });

  // Past today's allowance the event is accepted but not kept.
  if (!(await roomForEvent(req.log, event))) return;
  try {
    await db.insert(siteEventsTable).values({
      event,
      source: clipTag(source),
      medium: clipTag(medium),
      campaign: clipTag(campaign),
      referrer: referringPage(referrer),
      landingPage: sitePath(landingPage),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to insert site event");
  }
});

export default router;
