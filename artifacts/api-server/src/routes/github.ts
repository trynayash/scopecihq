import { Router, type IRouter, type Request, type Response } from "express";
import { WebhookService } from "../github/webhook-service.js";
import { MockGitHubClient } from "../github/github-client.js";
import { MockIssueProvider } from "../github/issue-provider.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// Default service instance for the route (configurable via environment or injection)
const defaultSecret = process.env.GITHUB_WEBHOOK_SECRET || "mock_scopeci_webhook_secret";
export const defaultGitHubClient = new MockGitHubClient();
export const defaultIssueProvider = new MockIssueProvider();

export let activeWebhookService = new WebhookService({
  webhookSecret: defaultSecret,
  gitHubClient: defaultGitHubClient,
  issueProvider: defaultIssueProvider,
});

export function setWebhookService(service: WebhookService): void {
  activeWebhookService = service;
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
    const { shouldProcess, reason } = await activeWebhookService.precheckAndPersistDelivery(
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
      activeWebhookService
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
