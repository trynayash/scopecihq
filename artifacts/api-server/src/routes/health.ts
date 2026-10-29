import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Healthy unless every attempt to bring the database schema up to date has
 * failed since this instance started (index.ts keeps retrying). Render routes
 * no traffic to a deploy that isn't healthy, so new code never serves on an
 * old schema.
 */
router.get("/healthz", (req, res) => {
  if (req.app.locals.schemaSync === "behind") {
    res.status(503).json(HealthCheckResponse.parse({ status: "schema_behind" }));
    return;
  }
  res.json(HealthCheckResponse.parse({ status: "ok" }));
});

export default router;
