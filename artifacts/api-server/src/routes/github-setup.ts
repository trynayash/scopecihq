import { Router, type IRouter } from "express";
import { rateLimiter } from "../middlewares/rate-limit.js";
import { appOrigin } from "../lib/session.js";
import { gitHubWebUrl } from "../github/github-http.js";
import {
  appManifest,
  beginAppSetup,
  claimAppSetup,
  completeAppSetup,
  encryptionReady,
  gitHubAppSettings,
  removeStoredApp,
} from "../github/app-settings.js";
import { installUrl } from "../github/user-api.js";
import { requireAdmin } from "./admin.js";

/**
 * Creating ScopeCI's GitHub App from the admin page, with GitHub's manifest
 * flow: the admin confirms one screen on GitHub, GitHub sends back a code,
 * and the App's ID, keys and secrets are stored encrypted. Nothing to copy
 * into environment variables.
 */
const router: IRouter = Router();

const ADMIN_PAGE = "/admin/waitlist";
const setupLimiter = rateLimiter({ windowMs: 60_000, max: 10, message: "Too many attempts. Wait a minute." });

// GitHub's own limits: App names up to 34 characters, logins up to 39.
const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,33}$/;
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

router.get("/admin/github-app", requireAdmin, async (req, res): Promise<void> => {
  const app = await gitHubAppSettings();
  const configured = Boolean(app.appId && app.privateKey);
  res.json({
    configured,
    source: app.source,
    slug: app.slug ?? null,
    owner: app.owner ?? null,
    settingsUrl: app.source === "admin" && app.slug ? app.htmlUrl ?? null : null,
    installUrl: configured ? await installUrl() : null,
    signInReady: Boolean(app.clientId && app.clientSecret) && encryptionReady(),
    webhooksReady: configured && Boolean(app.webhookSecret),
    encryptionReady: encryptionReady(),
    baseUrl: appOrigin(req),
    // Saved here but not decryptable: the page must not offer to replace it as if none existed.
    storedUnreadable: app.storedUnreadable ?? null,
  });
});

router.post("/admin/github-app/manifest", requireAdmin, setupLimiter, async (req, res): Promise<void> => {
  const app = await gitHubAppSettings();
  if (app.source === "environment") {
    res.status(409).json({ error: "This server's GitHub App is set in environment variables. Change it there." });
    return;
  }
  if (!encryptionReady()) {
    res.status(409).json({ error: "Set GITHUB_TOKEN_ENCRYPTION_KEY on the server first; the App's keys are stored encrypted with it." });
    return;
  }
  if (app.storedUnreadable) {
    // A new App replaces the saved one, and every customer would have to install it again.
    const which = app.storedUnreadable.slug ? ` (${app.storedUnreadable.slug})` : "";
    res.status(409).json({
      error: `A GitHub App${which} is saved but can't be decrypted with the current GITHUB_TOKEN_ENCRYPTION_KEY. Restore the key it was saved with. To replace it instead, forget the saved App first; every customer then has to install the new one.`,
    });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const organization = typeof req.body?.organization === "string" ? req.body.organization.trim() : "";
  if (!APP_NAME.test(name)) {
    res.status(400).json({ error: "Give the App a name of up to 34 letters, numbers, spaces, dots, dashes or underscores." });
    return;
  }
  if (organization && !GITHUB_LOGIN.test(organization)) {
    res.status(400).json({ error: "That isn't a GitHub organization name." });
    return;
  }

  const origin = appOrigin(req);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://") && !local) {
    res.status(409).json({ error: "Set APP_BASE_URL to the server's https address first; GitHub sends webhooks there." });
    return;
  }
  const state = await beginAppSetup();
  const owner = organization ? `/organizations/${encodeURIComponent(organization)}` : "";
  res.json({
    action: `${gitHubWebUrl()}${owner}/settings/apps/new?state=${encodeURIComponent(state)}`,
    manifest: appManifest(name, origin),
  });
});

router.delete("/admin/github-app", requireAdmin, async (_req, res): Promise<void> => {
  const removed = await removeStoredApp();
  if (!removed) {
    res.status(404).json({ error: "No GitHub App was created on this page." });
    return;
  }
  res.status(204).end();
});

/**
 * Where GitHub sends the admin after they create the App. Public, because the
 * admin cookie is scoped to /api/admin; the one-time state from
 * POST /admin/github-app/manifest is what proves an admin started this.
 */
router.get("/setup/github-app/callback", setupLimiter, async (req, res): Promise<void> => {
  const done = (result: string) => res.redirect(302, `${ADMIN_PAGE}?github=${result}`);
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || code.length > 200 || !state || state.length > 200) return done("expired");

  try {
    if (!(await claimAppSetup(state))) return done("expired");
    const app = await completeAppSetup(code);
    req.log.info({ slug: app.slug }, "GitHub App created from the admin page");
    done("created");
  } catch (err) {
    req.log.warn({ err }, "Creating the GitHub App failed");
    done("failed");
  }
});

export default router;
