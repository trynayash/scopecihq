import { Router, type IRouter } from "express";
import healthRouter from "./health";
import waitlistRouter from "./waitlist";
import eventsRouter from "./events";
import adminRouter from "./admin";
import githubRouter from "./github";
import linearRouter from "./linear";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Public routes — always available
router.use(healthRouter);
router.use(waitlistRouter);
router.use(eventsRouter);
router.use(adminRouter);        // already protected by requireAdminKey

// Integration routes — gated in production.
// In development/test these are always available so existing workflows and
// test suites continue to work unchanged. In production they require the
// explicit opt-in flag ENABLE_INTEGRATION_ROUTES=true, preventing the public
// marketing deployment from accidentally exposing internal APIs.
const isProduction = process.env.NODE_ENV === "production";
const integrationRoutesEnabled =
  process.env.ENABLE_INTEGRATION_ROUTES === "true";

// Outside production the routers fall back to fixed mock secrets so the test
// suites run without configuration. In production that fallback would let
// anyone who reads this repository sign a valid webhook, so each router is
// only mounted when its real secrets are present.
const missingEnv = (names: string[]) => names.filter((name) => !process.env[name]);

function mountIntegration(name: string, integration: IRouter, requiredEnv: string[]) {
  const missing = isProduction ? missingEnv(requiredEnv) : [];
  if (missing.length > 0) {
    logger.error({ integration: name, missing }, "Integration routes not mounted: missing secrets");
    return;
  }
  router.use(integration);
}

if (!isProduction || integrationRoutesEnabled) {
  mountIntegration("github", githubRouter, ["GITHUB_WEBHOOK_SECRET"]);
  mountIntegration("linear", linearRouter, [
    "LINEAR_CLIENT_ID",
    "LINEAR_CLIENT_SECRET",
    "LINEAR_WEBHOOK_SECRET",
    "LINEAR_TOKEN_ENCRYPTION_KEY",
  ]);
}

export default router;
