import { Router, type IRouter } from "express";
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
 * Lightweight analytics endpoint. Accepts a site event and inserts it
 * asynchronously — the response is sent immediately so the client is
 * never blocked on the database write.
 */
router.post("/events", eventsRateLimiter, (req, res): void => {
  const { event, source, medium, campaign, referrer, landingPage } = req.body ?? {};

  if (!event || typeof event !== "string") {
    res.status(400).json({ error: "Missing event name." });
    return;
  }

  // Fire-and-forget insert — don't await, don't block the response.
  db.insert(siteEventsTable)
    .values({
      event: event.slice(0, 80),
      source: typeof source === "string" ? source.slice(0, 100) : null,
      medium: typeof medium === "string" ? medium.slice(0, 100) : null,
      campaign: typeof campaign === "string" ? campaign.slice(0, 200) : null,
      referrer: typeof referrer === "string" ? referrer.slice(0, 2000) : null,
      landingPage: typeof landingPage === "string" ? landingPage.slice(0, 2000) : null,
    })
    .catch((err) => req.log.error({ err }, "Failed to insert site event"));

  res.status(202).json({ accepted: true });
});

export default router;
