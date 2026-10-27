import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { WebhookService } from "../github/webhook-service.js";
import { MockGitHubClient } from "../github/github-client.js";
import { GitHubAppClient } from "../github/app-client.js";
import { gitHubAppSettings } from "../github/app-settings.js";
import { MockIssueProvider, NoIssueProvider } from "../github/issue-provider.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// Outside production, without an App, webhooks are checked against this fixed
// secret and answered by the in-memory client: local development and the
// test suites need no configuration.
const MOCK_WEBHOOK_SECRET = "mock_scopeci_webhook_secret";
export const defaultGitHubClient = new MockGitHubClient();
export const defaultIssueProvider = new MockIssueProvider();

let override: WebhookService | null = null;
let built: { key: string; service: WebhookService } | undefined;

/** Test hook: use this service instead of one built from the App's settings. */
export function setWebhookService(service: WebhookService | null): void {
  override = service;
}

/**
 * The service for the GitHub App as currently configured, rebuilt when its
 * credentials change (an App created on the admin page applies at once).
 * Null in production until an App is set up: there is nothing safe to check
 * a signature against, and nowhere real to post results.
 */
export async function currentWebhookService(): Promise<WebhookService | null> {
  if (override) return override;
  const app = await gitHubAppSettings();
  const isProduction = process.env.NODE_ENV === "production";
  const real = Boolean(app.appId && app.privateKey);
  const webhookSecret = app.webhookSecret || (isProduction ? undefined : MOCK_WEBHOOK_SECRET);
  if (!webhookSecret || (isProduction && !real)) return null;

  const key = crypto
    .createHash("sha256")
    .update([real, app.appId, app.slug, app.privateKey, webhookSecret].join("\0"))
    .digest("hex");
  if (built?.key !== key) {
    built = {
      key,
      service: new WebhookService({
        webhookSecret,
        gitHubClient: real
          ? new GitHubAppClient({ appId: app.appId!, privateKey: app.privateKey!, slug: app.slug })
          : defaultGitHubClient,
        // The mock's sample issues must never reach real pull requests.
        issueProvider: real ? new NoIssueProvider() : defaultIssueProvider,
      }),
    };
  }
  return built.service;
}

/**
 * GitHub Webhook Ingestion Endpoint
 * Follows the fast-acknowledgement async pattern:
 * 1. Verify signature and headers
 * 2. Persist delivery as PENDING
 * 3. Enqueue / dispatch background processing
 * 4. Return HTTP 202 Accepted immediately
 */
router.post("/webhooks/github", async (req: Request, res: Response): Promise<void> => {
  const deliveryId = (req.headers["x-github-delivery"] as string) || `del_${Date.now()}`;
  const eventType = (req.headers["x-github-event"] as string) || "unknown";
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));

  logger.info({ deliveryId, eventType }, "Received GitHub webhook request");

  try {
    const service = await currentWebhookService();
    if (!service) {
      res.status(503).json({ error: "GitHub isn't set up on this server yet." });
      return;
    }
    const { shouldProcess, reason } = await service.precheckAndPersistDelivery(
      { deliveryId, eventType, signature },
      rawBody,
      req.body
    );

    if (!shouldProcess) {
      if (reason === "already_processed") {
        res.status(200).json({ status: "already_processed", deliveryId });
        return;
      }
      res.status(200).json({ status: "acknowledged", reason, deliveryId });
      return;
    }

    // Genuinely asynchronous processing: dispatch in background, respond 202 Accepted
    setImmediate(() => {
      service
        .processPullRequestEvent(deliveryId, req.body)
        .catch((err) => {
          logger.error({ deliveryId, err: err.message }, "Background webhook processing failed");
        });
    });

    res.status(202).json({
      status: "accepted",
      deliveryId,
      message: "Webhook accepted for asynchronous commercial evaluation",
    });
  } catch (err: any) {
    if (err.message === "Invalid webhook signature") {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
    logger.error({ deliveryId, err: err.message }, "Webhook ingestion failed");
    res.status(500).json({ error: "Webhook ingestion failed" });
  }
});

export default router;
