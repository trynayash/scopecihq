import { Router, type IRouter } from "express";
import { db, waitlistSignupsTable } from "@workspace/db";
import { CreateWaitlistSignupBody, CreateWaitlistSignupResponse } from "@workspace/api-zod";
import { rateLimiter } from "../middlewares/rate-limit.js";

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

/**
 * drizzle-orm wraps the driver's error in a `DrizzleQueryError`, so the `pg`
 * error carrying `.code` (e.g. "23505" for a unique-constraint violation) sits
 * at `error.cause`, not on the thrown error itself. Walk the cause chain
 * rather than assuming either shape, so this keeps working across drivers and
 * drizzle-orm versions.
 */
function hasPgErrorCode(error: unknown, code: string, depth = 0): boolean {
  if (depth > 5 || typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === code) return true;
  return "cause" in error ? hasPgErrorCode(error.cause, code, depth + 1) : false;
}

router.post("/waitlist", waitlistRateLimiter, async (req, res): Promise<void> => {
  // Bot Honeypot Protection: drop automated bot submissions silently
  if (req.body?.hp || req.body?.website_url_hp || req.body?.company_role) {
    req.log.warn({ body: req.body }, "Honeypot triggered on waitlist submission; dropping");
    res.status(201).json({ id: 0, email: "bot@discarded.local", agency: null, createdAt: new Date() });
    return;
  }

  const parsed = CreateWaitlistSignupBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.flatten() }, "Invalid waitlist signup");
    res.status(400).json({ error: "Enter a valid work email and optional agency name." });
    return;
  }

  // Attribution fields are optional — passed through from the frontend's
  // captured UTM parameters. They are not part of the public form UI.
  const {
    utmSource, utmMedium, utmCampaign, utmContent, utmTerm, referrer,
  } = req.body ?? {};

  try {
    const [signup] = await db
      .insert(waitlistSignupsTable)
      .values({
        email: parsed.data.email.trim().toLowerCase(),
        agency: parsed.data.agency?.trim() || null,
        utmSource: typeof utmSource === "string" ? utmSource.slice(0, 100) : null,
        utmMedium: typeof utmMedium === "string" ? utmMedium.slice(0, 100) : null,
        utmCampaign: typeof utmCampaign === "string" ? utmCampaign.slice(0, 200) : null,
        utmContent: typeof utmContent === "string" ? utmContent.slice(0, 200) : null,
        utmTerm: typeof utmTerm === "string" ? utmTerm.slice(0, 200) : null,
        referrer: typeof referrer === "string" ? referrer.slice(0, 2000) : null,
      })
      .returning();

    res.status(201).json(CreateWaitlistSignupResponse.parse(signup));
  } catch (error: unknown) {
    if (hasPgErrorCode(error, "23505")) {
      res.status(409).json({ error: "That email is already on the waitlist." });
      return;
    }

    req.log.error({ err: error }, "Failed to create waitlist signup");
    res.status(500).json({ error: "We couldn't save your request. Please try again." });
  }
});

export default router;