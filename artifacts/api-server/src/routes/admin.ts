import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, waitlistSignupsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

import { timingSafeCompare } from "../middlewares/auth.js";

const router: IRouter = Router();

/**
 * Checks the ADMIN_SECRET env var against the request's `x-admin-key` header
 * or `Authorization: Bearer <key>`. Uses constant-time comparison.
 * Returns 401 if the secret is not configured or does not match.
 */
function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    res.status(401).json({ error: "Admin access is not configured." });
    return;
  }

  const authHeader = req.headers["authorization"];
  let provided: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    provided = authHeader.slice(7).trim();
  } else {
    provided = req.headers["x-admin-key"] as string | undefined;
  }

  if (!provided || !timingSafeCompare(provided, secret)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  next();
}

router.use("/admin", requireAdminKey);

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
 * GET /admin/waitlist/csv — downloads signups as CSV.
 * Sanitizes against CSV Formula Injection (OWASP A05).
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

    const escape = (val: unknown): string => {
      if (val === null || val === undefined) return "";
      let str = String(val);

      // Prevent CSV Formula Injection: Prefix dangerous characters with single quote
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }

      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = signups.map((s) =>
      [
        s.id, s.email, s.agency, s.utmSource, s.utmMedium,
        s.utmCampaign, s.utmContent, s.utmTerm, s.referrer, s.createdAt,
      ]
        .map(escape)
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

export default router;
