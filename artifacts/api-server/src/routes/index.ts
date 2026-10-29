import { Router, type IRouter } from "express";
import healthRouter from "./health";
import waitlistRouter from "./waitlist";
import contactRouter from "./contact";
import eventsRouter from "./events";
import adminRouter from "./admin";
import demoRouter from "./demo";
import sessionRouter from "./session";
import projectsRouter from "./projects";
import workspaceRouter from "./workspace";
import githubRouter from "./github";
import githubSetupRouter from "./github-setup";
import linearRouter from "./linear";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Public routes — always available
router.use(healthRouter);
router.use(waitlistRouter);
router.use(contactRouter);      // the contact form; ScopeCI publishes no email address
router.use(eventsRouter);
router.use(adminRouter);        // already protected by requireAdminKey
router.use(demoRouter);         // public "try it" demo; stores nothing
router.use(sessionRouter);      // sign in with GitHub; reports when sign-in isn't configured
router.use(projectsRouter);     // the signed-in app; every route needs a session
router.use(workspaceRouter);    // members, invites and switching workspaces
router.use(githubSetupRouter);  // create the GitHub App from the admin page

// The GitHub webhook is always mounted: it checks every delivery against the
// App's webhook secret, and in production answers 503 until a GitHub App is
// set up (from the environment, or on the admin page). It never falls back to
// the fixed test secret there.
router.use(githubRouter);

// Linear routes — gated in production.
// In development/test these are always available so existing workflows and
// test suites continue to work unchanged. In production they require the
// explicit opt-in flag ENABLE_INTEGRATION_ROUTES=true, preventing the public
// marketing deployment from accidentally exposing internal APIs.
const isProduction = process.env.NODE_ENV === "production";
const integrationRoutesEnabled =
  process.env.ENABLE_INTEGRATION_ROUTES === "true";

// Outside production the router falls back to fixed mock secrets so the test
// suites run without configuration. In production that fallback would let
// anyone who reads this repository sign a valid webhook, so it is only
// mounted when its real secrets are present.
const missingEnv = (names: string[]) => names.filter((name) => !process.env[name]);

function mountIntegration(name: string, integration: IRouter, requiredEnv: string[]) {
  const missing = isProduction ? missingEnv(requiredEnv) : [];
  if (missing.length > 0) {
    logger.error({ integration: name, missing }, "Integration routes not mounted: missing secrets");
    return;
  }
  router.use(integration);
}

if (isProduction && integrationRoutesEnabled) {
  logger.warn({ integration: "linear" }, "Linear routes mounted, but connect, callback and sync answer 503 until a real token exchange is built");
}
if (!isProduction || integrationRoutesEnabled) {
  mountIntegration("linear", linearRouter, [
    "LINEAR_CLIENT_ID",
    "LINEAR_CLIENT_SECRET",
    "LINEAR_WEBHOOK_SECRET",
    "LINEAR_TOKEN_ENCRYPTION_KEY",
  ]);
}

export default router;
