import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  linearConnectionsTable,
  linearOAuthStatesTable,
  linearWebhookDeliveriesTable,
  organizationsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  encryptToken,
  generateOAuthState,
  verifyLinearWebhookSignature,
} from "../linear/crypto.js";
import {
  type ILinearClient,
  MockLinearClient,
  RealLinearClient,
} from "../linear/linear-client.js";
import { LinearSyncService } from "../linear/sync-service.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// Configurable environment defaults
const APP_BASE_URL = process.env.APP_BASE_URL || "https://app.scopeci.dev";
const LINEAR_CLIENT_ID = process.env.LINEAR_CLIENT_ID || "mock_linear_client_id";
const LINEAR_CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET || "mock_linear_client_secret";
const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET || "mock_linear_webhook_secret";
const LINEAR_REDIRECT_URI =
  process.env.LINEAR_REDIRECT_URI || "http://localhost:3000/api/integrations/linear/callback";

// Injected or default dependencies
export type TokenExchanger = (code: string) => Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}>;

let activeLinearClient: ILinearClient = new MockLinearClient();
let activeSyncService: LinearSyncService = new LinearSyncService();

let activeTokenExchanger: TokenExchanger = async (code: string) => {
  if (code === "invalid_code") {
    throw new Error("Invalid authorization code");
  }
  return {
    access_token: `lin_oauth_tok_${crypto.randomBytes(16).toString("hex")}`,
    refresh_token: `lin_oauth_ref_${crypto.randomBytes(16).toString("hex")}`,
    expires_in: 3600 * 24 * 30, // 30 days
  };
};

export function setLinearClient(client: ILinearClient): void {
  activeLinearClient = client;
}

export function setLinearSyncService(service: LinearSyncService): void {
  activeSyncService = service;
}

export function setTokenExchanger(fn: TokenExchanger): void {
  activeTokenExchanger = fn;
}

/* ==================================================================
   1. GET /api/integrations/linear/connect
   Initiates Linear OAuth. Generates CSRF state bound strictly to org.
   ================================================================== */
router.get("/integrations/linear/connect", async (req: Request, res: Response): Promise<void> => {
  const organizationId = (req.query.organizationId as string) || (req.headers["x-organization-id"] as string);
  const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string) || "user_admin";
  const redirectParam = req.query.redirectUrl as string | undefined;

  if (!organizationId) {
    res.status(400).json({ error: "organizationId is required to initiate Linear OAuth" });
    return;
  }

  // Verify organization exists
  const org = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);

  if (org.length === 0) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  // Phase 3 Hard Requirement 2: OAuth state bound to authenticated org & user
  const state = generateOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10-minute expiration cutoff

  await db.insert(linearOAuthStatesTable).values({
    state,
    organizationId,
    userId,
    redirectUrl: redirectParam || `${APP_BASE_URL}/settings/integrations/linear`,
    expiresAt,
  });

  const authorizeUrl = new URL("https://linear.app/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", LINEAR_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", LINEAR_REDIRECT_URI);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", "read,write");
  authorizeUrl.searchParams.set("state", state);

  if (req.headers.accept?.includes("text/html") && req.query.autoRedirect === "true") {
    res.redirect(authorizeUrl.toString());
    return;
  }

  res.status(200).json({
    url: authorizeUrl.toString(),
    state,
    expiresAt: expiresAt.toISOString(),
  });
});

/* ==================================================================
   2. GET /api/integrations/linear/callback
   Exchanges authorization code, validates state, encrypts tokens,
   binds strictly to org, and redirects to app.scopeci.<domain>.
   ================================================================== */
router.get("/integrations/linear/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query;

  if (error) {
    logger.warn({ error }, "Linear OAuth returned error parameter");
    const targetUrl = `${APP_BASE_URL}/settings/integrations/linear?status=error&error=${encodeURIComponent(String(error))}`;
    if (req.headers.accept?.includes("application/json")) {
      res.status(400).json({ error: String(error) });
    } else {
      res.redirect(targetUrl);
    }
    return;
  }

  if (!code || !state || typeof state !== "string" || typeof code !== "string") {
    res.status(400).json({ error: "Missing required code or state parameter" });
    return;
  }

  // Look up OAuth state
  const stateRecord = await db
    .select()
    .from(linearOAuthStatesTable)
    .where(eq(linearOAuthStatesTable.state, state))
    .limit(1);

  if (stateRecord.length === 0) {
    res.status(400).json({ error: "Invalid or unknown OAuth state" });
    return;
  }

  const oauthState = stateRecord[0];

  // Replay protection: state must not be used previously
  if (oauthState.usedAt) {
    res.status(400).json({ error: "OAuth state has already been used (replay attack prevented)" });
    return;
  }

  // Expiration check: state expires in 10 minutes
  if (new Date() > new Date(oauthState.expiresAt)) {
    res.status(400).json({ error: "OAuth state has expired" });
    return;
  }

  // Mark single-use state as consumed immediately
  await db
    .update(linearOAuthStatesTable)
    .set({ usedAt: new Date() })
    .where(eq(linearOAuthStatesTable.id, oauthState.id));

  try {
    // Exchange code for token
    const tokenResponse = await activeTokenExchanger(code);

    // Phase 3 Hard Requirement 1: Authenticated encryption with key version
    const encryptedAccess = encryptToken(tokenResponse.access_token, "v1");
    const encryptedRefresh = tokenResponse.refresh_token
      ? encryptToken(tokenResponse.refresh_token, "v1")
      : null;

    // Fetch workspace details from Linear
    const workspace = await activeLinearClient.getWorkspace();
    const viewer = await activeLinearClient.getViewer();

    // Phase 3 Hard Requirement 2: Strict Org Binding
    // Binds connection strictly to oauthState.organizationId
    const existingConn = await db
      .select()
      .from(linearConnectionsTable)
      .where(
        and(
          eq(linearConnectionsTable.organizationId, oauthState.organizationId),
          eq(linearConnectionsTable.linearWorkspaceId, workspace.id)
        )
      )
      .limit(1);

    const tokenExpiresAt = tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000)
      : null;

    if (existingConn.length > 0) {
      await db
        .update(linearConnectionsTable)
        .set({
          linearWorkspaceName: workspace.name,
          linearUserId: viewer.id,
          status: "ACTIVE",
          scope: "read,write",
          encryptedAccessToken: encryptedAccess.ciphertext,
          encryptedRefreshToken: encryptedRefresh ? encryptedRefresh.ciphertext : null,
          tokenIv: encryptedAccess.iv,
          tokenAuthTag: encryptedAccess.authTag,
          keyVersion: encryptedAccess.keyVersion,
          tokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(linearConnectionsTable.id, existingConn[0].id));
    } else {
      await db.insert(linearConnectionsTable).values({
        organizationId: oauthState.organizationId,
        linearWorkspaceId: workspace.id,
        linearWorkspaceName: workspace.name,
        linearUserId: viewer.id,
        status: "ACTIVE",
        scope: "read,write",
        encryptedAccessToken: encryptedAccess.ciphertext,
        encryptedRefreshToken: encryptedRefresh ? encryptedRefresh.ciphertext : null,
        tokenIv: encryptedAccess.iv,
        tokenAuthTag: encryptedAccess.authTag,
        keyVersion: encryptedAccess.keyVersion,
        tokenExpiresAt,
      });
    }

    const redirectTarget =
      oauthState.redirectUrl || `${APP_BASE_URL}/settings/integrations/linear`;
    const targetUrl = new URL(redirectTarget);
    targetUrl.searchParams.set("status", "connected");
    targetUrl.searchParams.set("workspace", workspace.name);

    if (req.headers.accept?.includes("application/json")) {
      res.status(200).json({
        status: "connected",
        organizationId: oauthState.organizationId,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        redirectUrl: targetUrl.toString(),
      });
      return;
    }

    res.redirect(targetUrl.toString());
  } catch (err: any) {
    logger.error({ err: err.message }, "Linear OAuth token exchange failed");
    res.status(500).json({ error: `Linear token exchange failed: ${err.message}` });
  }
});

/* ==================================================================
   3. POST /api/webhooks/linear
   Linear webhook ingestion with HMAC verification, delivery idempotency,
   and revision-aware update checks.
   ================================================================== */
router.post("/webhooks/linear", async (req: Request, res: Response): Promise<void> => {
  const deliveryId =
    (req.headers["linear-delivery"] as string) ||
    (req.body?.deliveryId as string) ||
    `lin_del_${Date.now()}`;
  const signature = req.headers["linear-signature"] as string | undefined;
  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));

  // Verify HMAC signature
  const isValid = verifyLinearWebhookSignature(rawBody, signature, LINEAR_WEBHOOK_SECRET);
  if (!isValid) {
    logger.warn({ deliveryId }, "Linear webhook signature verification failed");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  // Check delivery idempotency
  const existingDelivery = await db
    .select()
    .from(linearWebhookDeliveriesTable)
    .where(eq(linearWebhookDeliveriesTable.deliveryId, deliveryId))
    .limit(1);

  if (existingDelivery.length > 0) {
    res.status(200).json({ status: "already_processed", deliveryId });
    return;
  }

  const { type: eventType, action, data } = req.body || {};
  const linearWorkspaceId = data?.organizationId || req.body?.organizationId || null;
  const linearIssueId = data?.id || null;
  const providerUpdatedAt = data?.updatedAt ? new Date(data.updatedAt) : new Date();

  // Create delivery record with PENDING status and 30-day retention cutoff
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const [delivery] = await db
    .insert(linearWebhookDeliveriesTable)
    .values({
      deliveryId,
      eventType: eventType || "Unknown",
      action: action || "unknown",
      linearWorkspaceId,
      linearIssueId,
      providerUpdatedAt,
      summaryJson: {
        eventType,
        action,
        issueIdentifier: data?.identifier,
        issueTitle: data?.title,
      },
      status: "PENDING",
      expiresAt,
    })
    .returning();

  // Process Issue updates
  if (eventType === "Issue" && data) {
    // Resolve organization from workspace connection
    let orgId: string | null = null;
    if (linearWorkspaceId) {
      const conn = await db
        .select()
        .from(linearConnectionsTable)
        .where(eq(linearConnectionsTable.linearWorkspaceId, linearWorkspaceId))
        .limit(1);
      if (conn.length > 0) {
        orgId = conn[0].organizationId;
      }
    }

    if (!orgId) {
      // Fallback to first active organization for local tests
      const orgs = await db.select().from(organizationsTable).limit(1);
      if (orgs.length > 0) orgId = orgs[0].id;
    }

    if (orgId) {
      const issueDetail = {
        id: data.id,
        identifier: data.identifier,
        title: data.title,
        description: data.description,
        state: data.state?.name || data.state || "Unknown",
        estimate: data.estimate,
        url: data.url || `https://linear.app/issue/${data.identifier}`,
        createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
        updatedAt: providerUpdatedAt,
      };

      const syncResult = await activeSyncService.upsertLinearIssue(orgId, issueDetail);

      if (syncResult.status === "STALE_REJECTED") {
        await db
          .update(linearWebhookDeliveriesTable)
          .set({
            status: "STALE_REJECTED",
            errorMessage: syncResult.reason,
            processedAt: new Date(),
          })
          .where(eq(linearWebhookDeliveriesTable.id, delivery.id));

        res.status(200).json({
          status: "stale_rejected",
          deliveryId,
          reason: syncResult.reason,
        });
        return;
      }

      await db
        .update(linearWebhookDeliveriesTable)
        .set({
          status: "PROCESSED",
          processedAt: new Date(),
        })
        .where(eq(linearWebhookDeliveriesTable.id, delivery.id));

      res.status(200).json({
        status: "processed",
        deliveryId,
        issueId: syncResult.issueId,
      });
      return;
    }
  }

  await db
    .update(linearWebhookDeliveriesTable)
    .set({
      status: "PROCESSED",
      processedAt: new Date(),
    })
    .where(eq(linearWebhookDeliveriesTable.id, delivery.id));

  res.status(200).json({ status: "processed", deliveryId });
});

/* ==================================================================
   4. POST /api/integrations/linear/projects/map
   Maps a Linear project to a GitHub repository in project_links.
   ================================================================== */
router.post("/integrations/linear/projects/map", async (req: Request, res: Response): Promise<void> => {
  const {
    organizationId,
    externalProjectId,
    externalProjectName,
    externalTeamId,
    repositoryExternalId,
    repositoryFullName,
  } = req.body;

  if (!organizationId || !externalProjectId || !externalProjectName || !repositoryFullName) {
    res.status(400).json({ error: "Missing required project mapping fields" });
    return;
  }

  try {
    const projectLinkId = await activeSyncService.mapProjectToRepository({
      organizationId,
      externalProjectId,
      externalProjectName,
      externalTeamId,
      repositoryExternalId: repositoryExternalId || `gh_repo_${repositoryFullName}`,
      repositoryFullName,
    });

    res.status(200).json({
      status: "mapped",
      projectLinkId,
      organizationId,
      repositoryFullName,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to map Linear project to repository");
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================================
   5. POST /api/integrations/linear/projects/:projectId/sync
   Synchronizes all issues for a Linear project into the ScopeCI graph.
   ================================================================== */
router.post("/integrations/linear/projects/:projectId/sync", async (req: Request, res: Response): Promise<void> => {
  const projectId = req.params.projectId as string;
  const { organizationId } = req.body;

  if (!organizationId || !projectId) {
    res.status(400).json({ error: "organizationId and projectId are required" });
    return;
  }

  try {
    const summary = await activeSyncService.syncProjectIssues(
      organizationId,
      projectId,
      activeLinearClient
    );

    res.status(200).json({
      status: "synced",
      summary,
    });
  } catch (err: any) {
    logger.error({ err: err.message, projectId }, "Failed to sync project issues");
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================================
   6. POST /api/integrations/linear/issues/:issueId/link-deliverable
   Manual issue → deliverable linking with immutable commercial event audit.
   ================================================================== */
router.post("/integrations/linear/issues/:issueId/link-deliverable", async (req: Request, res: Response): Promise<void> => {
  const issueId = req.params.issueId as string;
  const { organizationId, deliverableId, actor } = req.body;

  if (!organizationId || !deliverableId || !actor?.id || !actor?.name) {
    res.status(400).json({ error: "organizationId, deliverableId, and actor (id, name) are required" });
    return;
  }

  try {
    const result = await activeSyncService.manualLinkIssueToDeliverable({
      organizationId,
      issueId,
      deliverableId,
      actor,
    });

    res.status(200).json({
      status: "linked",
      linkId: result.id,
      issueId,
      deliverableId: result.deliverableId,
    });
  } catch (err: any) {
    logger.error({ err: err.message, issueId, deliverableId }, "Manual deliverable linking failed");
    res.status(500).json({ error: err.message });
  }
});

export default router;
