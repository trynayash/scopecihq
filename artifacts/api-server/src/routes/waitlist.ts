import { Router, type IRouter } from "express";
import { db, waitlistSignupsTable } from "@workspace/db";
import { CreateWaitlistSignupBody, CreateWaitlistSignupResponse } from "@workspace/api-zod";
import { rateLimiter } from "../middlewares/rate-limit.js";
import { clipTag, referringPage } from "./events.js";
import { hasPgErrorCode, withoutQueryParams } from "../lib/database-errors.js";

const router: IRouter = Router();

/**
 * Rate limiter: 10 requests per minute per IP for public waitlist signup.
 * Protects against automated scrapers and registration spam.
 */
export const waitlistRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many waitlist submissions from this IP. Please wait a moment and try again.",
});

router.post("/waitlist", waitlistRateLimiter, async (req, res, next): Promise<void> => {
  // Bot Honeypot Protection: drop automated bot submissions silently. The
  // form renders `website_url_hp` hidden; `hp` and `company_role` are older
  // names kept for clients that still send them. The body is not logged: it
  // carries whatever email address the bot typed.
  if (req.body?.hp || req.body?.website_url_hp || req.body?.company_role) {
    req.log.warn("Honeypot triggered on waitlist submission; dropping");
    res.status(201).json({ id: 0, email: "bot@discarded.local", agency: null, createdAt: new Date() });
    return;
  }

  const parsed = CreateWaitlistSignupBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.flatten().fieldErrors }, "Invalid waitlist signup");
    res.status(400).json({ error: "Enter a valid work email and optional agency name." });
    return;
  }

  // Attribution is captured by the site from the landing URL. It is never
  // allowed to fail a signup, so over-long values are truncated, not refused,
  // and the referrer keeps only the linking page, not its query string.
  const {
    utmSource, utmMedium, utmCampaign, utmContent, utmTerm, referrer,
  } = parsed.data;

  try {
    const [signup] = await db
      .insert(waitlistSignupsTable)
      .values({
        email: parsed.data.email.trim().toLowerCase(),
        agency: parsed.data.agency?.trim() || null,
        utmSource: clipTag(utmSource),
        utmMedium: clipTag(utmMedium),
        utmCampaign: clipTag(utmCampaign),
        utmContent: clipTag(utmContent),
        utmTerm: clipTag(utmTerm),
        referrer: referringPage(referrer),
      })
      .returning();

    res.status(201).json(CreateWaitlistSignupResponse.parse(signup));
  } catch (error: unknown) {
    if (hasPgErrorCode(error, "23505")) {
      res.status(409).json({ error: "That email is already on the waitlist." });
      return;
    }

    // Logged without the query's values (the signup's email and agency);
    // the shared handler answers 503 when the database is down.
    const cause = withoutQueryParams(error, "A waitlist query failed.");
    req.log.error({ err: cause }, "Failed to create waitlist signup");
    next(cause);
  }
});

export default router;