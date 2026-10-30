import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { gte, inArray, lt, sql } from "drizzle-orm";
import { db, contactMessagesTable } from "@workspace/db";
import { CreateContactMessageBody } from "@workspace/api-zod";
import { rateLimiter } from "../middlewares/rate-limit.js";
import { withoutQueryParams } from "../lib/database-errors.js";

const router: IRouter = Router();

/**
 * ScopeCI publishes no email address: people reach it through the site's
 * contact form, and the messages are read on the admin page. Only what the
 * form asks for is stored. No IP address, user agent or cookie is kept (the
 * limiter below holds addresses in memory for its 10 minutes, and nothing
 * here logs one or the message).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Messages stored per UTC day across everyone, so a script can't fill the table. */
export const CONTACT_DAILY_LIMIT = 300;

/** How long a message is kept before the hourly purge deletes it. */
export const CONTACT_KEEP_DAYS = 365;

/**
 * Rate limiter: 5 messages per 10 minutes per IP. Applied once the message
 * has passed validation, so someone correcting a field isn't locked out.
 */
export const contactRateLimiter = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: "Too many messages from this IP. Please wait 10 minutes and try again.",
});

/** Control characters (C0, DEL and C1) and the Unicode line and paragraph separators. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * A one-line field: control characters, CR and LF among them, become spaces,
 * so nothing typed can start a new line in a header or a log; runs of spaces
 * become one; trimmed.
 */
function oneLine(value: unknown): unknown {
  return typeof value === "string" ? value.replace(CONTROL, " ").replace(/\s+/g, " ").trim() : value;
}

/**
 * The message keeps its line breaks, stored as LF whatever the browser sent
 * (CRLF, a bare CR or a Unicode separator). Tabs stay; every other control
 * character goes. Trimmed.
 */
function paragraphs(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
    .trim();
}

/** One sentence for a field the form got wrong. */
function fieldError(field: PropertyKey | undefined, value: unknown): string {
  const text = typeof value === "string" ? value : "";
  switch (field) {
    case "name":
      return text ? "Your name can be up to 120 characters." : "Enter your name.";
    case "email":
      if (!text) return "Enter your email address.";
      return text.length > 254 ? "Your email address can be up to 254 characters." : "Enter a valid email address.";
    case "company":
      return typeof value === "string"
        ? "Your company name can be up to 200 characters."
        : "Enter your company name as text, or leave it empty.";
    case "topic":
      return "Choose a topic for your message.";
    case "message":
      return text.length > 5000 ? "Your message can be up to 5000 characters." : "Write a message of at least 10 characters.";
    default:
      return "Check the form and try again.";
  }
}

type ContactMessageValues = typeof contactMessagesTable.$inferInsert;

/**
 * Drops bot submissions, then cleans and validates the message, answering 400
 * with one sentence that names the first field (in the form's order) that is
 * wrong. A valid message is handed on in `res.locals.contactMessage`.
 */
function readContactMessage(req: Request, res: Response, next: NextFunction): void {
  // Bot Honeypot Protection: the form renders `website` hidden, so a value
  // means a bot filled every input. It is answered like a real message, so
  // the bot learns nothing, and stored nowhere. The body is not logged.
  if (req.body?.website) {
    req.log.warn("Honeypot triggered on contact message; dropping");
    res.status(201).json({ ok: true });
    return;
  }

  const body: Record<string, unknown> =
    typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? req.body : {};
  const cleaned = {
    name: oneLine(body.name),
    email: oneLine(body.email),
    company: oneLine(body.company),
    topic: body.topic,
    message: paragraphs(body.message),
  };
  if (typeof cleaned.email === "string") cleaned.email = cleaned.email.toLowerCase();

  const parsed = CreateContactMessageBody.safeParse(cleaned);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    req.log.warn({ field }, "Invalid contact message");
    res.status(400).json({ error: fieldError(field, cleaned[field as keyof typeof cleaned]) });
    return;
  }

  const values: ContactMessageValues = {
    name: parsed.data.name,
    email: parsed.data.email,
    company: parsed.data.company || null,
    topic: parsed.data.topic,
    message: parsed.data.message,
  };
  res.locals.contactMessage = values;
  next();
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Stores the message unless today (UTC) already holds CONTACT_DAILY_LIMIT.
 * The count is read from the table, so a restart (a deploy, or the host
 * waking the service) doesn't hand out a fresh allowance, and the check and
 * the insert run under one lock, so two messages at once can't both take the
 * last place.
 */
async function storeWithinDailyLimit(values: ContactMessageValues): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('scopeci_contact_messages'))`);
    const [today] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contactMessagesTable)
      .where(gte(contactMessagesTable.createdAt, startOfUtcDay()));
    if ((today?.count ?? 0) >= CONTACT_DAILY_LIMIT) return false;
    await tx.insert(contactMessagesTable).values(values);
    return true;
  });
}

router.post("/contact", readContactMessage, contactRateLimiter, async (req, res, next): Promise<void> => {
  try {
    const stored = await storeWithinDailyLimit(res.locals.contactMessage as ContactMessageValues);
    if (!stored) {
      req.log.warn({ limit: CONTACT_DAILY_LIMIT }, "Daily contact message limit reached; refusing until 00:00 UTC");
      const retryAfterSeconds = Math.max(1, Math.ceil((startOfUtcDay().getTime() + DAY_MS - Date.now()) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "Too Many Requests",
        message: "Too many messages reached ScopeCI today. Please try again after midnight UTC.",
        retryAfterSeconds,
      });
      return;
    }
    req.log.info("Contact message stored");
    res.status(201).json({ ok: true });
  } catch (error: unknown) {
    const cause = withoutQueryParams(error, "A contact message query failed.");
    req.log.error({ err: cause }, "Failed to store contact message");
    next(cause);
  }
});

/**
 * Deletes messages older than CONTACT_KEEP_DAYS, a batch at a time so a large
 * backlog never holds a long lock. Run by the hourly purge in index.ts.
 * Returns how many were deleted.
 */
export async function purgeOldContactMessages(batchSize = 5000): Promise<number> {
  const cutoff = new Date(Date.now() - CONTACT_KEEP_DAYS * DAY_MS);
  let deleted = 0;
  for (;;) {
    const batch = db
      .select({ id: contactMessagesTable.id })
      .from(contactMessagesTable)
      .where(lt(contactMessagesTable.createdAt, cutoff))
      .limit(batchSize);
    const removed = await db
      .delete(contactMessagesTable)
      .where(inArray(contactMessagesTable.id, batch))
      .returning({ id: contactMessagesTable.id });
    deleted += removed.length;
    if (removed.length < batchSize) break;
  }
  return deleted;
}

export default router;
