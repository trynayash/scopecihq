import { Router, type IRouter } from "express";
import healthRouter from "./health";
import waitlistRouter from "./waitlist";
import eventsRouter from "./events";
import adminRouter from "./admin";
import githubRouter from "./github";
import linearRouter from "./linear";

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

if (!isProduction || integrationRoutesEnabled) {
  router.use(githubRouter);
  router.use(linearRouter);
}

export default router;
