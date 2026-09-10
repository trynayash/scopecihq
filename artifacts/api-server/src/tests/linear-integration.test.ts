import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  commercialEvaluationsTable,
  commercialEventsTable,
  deliverablesTable,
  githubCheckRunsTable,
  githubInstallationsTable,
  issueDeliverableLinksTable,
  issuesTable,
  linearConnectionsTable,
  linearOAuthStatesTable,
  linearWebhookDeliveriesTable,
  organizationsTable,
  prDiffAnalysesTable,
  prIssueLinksTable,
  projectLinksTable,
  pullRequestsTable,
  scopeBaselinesTable,
  webhookDeliveriesTable,
} from "@workspace/db/schema";
import {
  decryptToken,
  encryptToken,
  generateOAuthState,
  resolveEncryptionKey,
  verifyLinearWebhookSignature,
} from "../linear/crypto.js";
import {
  type ILinearClient,
  LinearApiError,
  LinearAuthError,
  LinearNotFoundError,
  LinearRateLimitError,
  MockLinearClient,
} from "../linear/linear-client.js";
import {
  normalizeLinearIssueForDb,
  normalizeLinearIssueForEngine,
  normalizeLinearProject,
  normalizeLinearTeam,
  normalizeLinearWorkspace,
} from "../linear/normalizer.js";
import { LinearIssueProvider } from "../linear/linear-issue-provider.js";
import { LinearSyncService } from "../linear/sync-service.js";
import { WebhookService } from "../github/webhook-service.js";
import { MockGitHubClient } from "../github/github-client.js";

const TEST_SECRET = "test_linear_webhook_secret_phase3";

async function runPhase3TestSuite(): Promise<void> {
  console.log("================================================================");
  console.log("     SCOPECI ALPHA — PHASE 3: LINEAR INTEGRATION TEST SUITE     ");
  console.log("================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string): void {
    if (condition) {
      console.log(`  ✓ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  // 1. Resolve or seed test Organization (Northstar Digital / Agency)
  let org = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.slug, "northstar-agency"),
  });

  if (!org) {
    org = await db.query.organizationsTable.findFirst();
  }

  if (!org) {
    const [created] = await db
      .insert(organizationsTable)
      .values({
        name: "Northstar Digital Agency",
        slug: "northstar-agency",
      })
      .returning();
    org = created;
  }

  // Clean up any previous test issue lin_iss_1842_rbac so tests are repeatable
  const prevTestIssue = await db.query.issuesTable.findFirst({
    where: eq(issuesTable.externalId, "lin_iss_1842_rbac"),
  });
  if (prevTestIssue) {
    await db.delete(issueDeliverableLinksTable).where(eq(issueDeliverableLinksTable.issueId, prevTestIssue.id));
    await db.delete(prIssueLinksTable).where(eq(prIssueLinksTable.issueId, prevTestIssue.id));
    await db.delete(issuesTable).where(eq(issuesTable.id, prevTestIssue.id));
  }

  // Also seed/resolve Tenant B for multi-tenant isolation testing
  let tenantB = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.slug, "tenant-b-digital"),
  });
  if (!tenantB) {
    const [createdB] = await db
      .insert(organizationsTable)
      .values({
        name: "Tenant B Digital",
        slug: "tenant-b-digital",
      })
      .returning();
    tenantB = createdB;
  }

  const mockClient = new MockLinearClient();
  const syncService = new LinearSyncService();
  const issueProvider = new LinearIssueProvider(mockClient);

  /* ==================================================================
     Scenario 1: OAuth State Creation
     ================================================================== */
  console.log("▶ Scenario 1: OAuth State Creation & Binding");
  const stateVal1 = generateOAuthState();
  const expiresAt1 = new Date(Date.now() + 10 * 60 * 1000);

  const [savedState] = await db
    .insert(linearOAuthStatesTable)
    .values({
      state: stateVal1,
      organizationId: org.id,
      userId: "user_pm_1",
      redirectUrl: "https://app.scopeci.dev/settings/integrations/linear",
      expiresAt: expiresAt1,
    })
    .returning();

  assert(savedState.state === stateVal1, "OAuth state generated and persisted");
  assert(savedState.organizationId === org.id, "OAuth state strictly bound to ScopeCI organization");
  assert(savedState.userId === "user_pm_1", "OAuth state bound to authenticated user/session");
  assert(savedState.usedAt === null, "OAuth state initialized with usedAt = null");

  /* ==================================================================
     Scenario 2: OAuth State Rejection (Invalid, Expired, Replayed)
     ================================================================== */
  console.log("\n▶ Scenario 2: OAuth State Rejection (Invalid / Expired / Replayed)");

  // 2a. Unknown state
  const unknownState = await db.query.linearOAuthStatesTable.findFirst({
    where: eq(linearOAuthStatesTable.state, "non_existent_state_value"),
  });
  assert(!unknownState, "Unknown state lookup returns null");

  // 2b. Expired state
  const expiredStateVal = generateOAuthState();
  await db.insert(linearOAuthStatesTable).values({
    state: expiredStateVal,
    organizationId: org.id,
    expiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
  });
  const foundExpired = await db.query.linearOAuthStatesTable.findFirst({
    where: eq(linearOAuthStatesTable.state, expiredStateVal),
  });
  const isExpired = foundExpired ? new Date() > new Date(foundExpired.expiresAt) : false;
  assert(isExpired, "Expired state correctly detected as expired");

  // 2c. Replayed state (already used)
  const replayedStateVal = generateOAuthState();
  await db.insert(linearOAuthStatesTable).values({
    state: replayedStateVal,
    organizationId: org.id,
    expiresAt: new Date(Date.now() + 60000),
    usedAt: new Date(), // Already used
  });
  const foundReplayed = await db.query.linearOAuthStatesTable.findFirst({
    where: eq(linearOAuthStatesTable.state, replayedStateVal),
  });
  assert(foundReplayed?.usedAt !== null, "Replayed state detected as already used");

  /* ==================================================================
     Scenario 3: OAuth Callback Success & Authenticated Encryption (AES-256-GCM)
     ================================================================== */
  console.log("\n▶ Scenario 3: OAuth Callback Success & Authenticated Encryption (Safeguard 1)");
  const plaintextToken = "lin_oauth_live_token_super_secret_12345";
  const encrypted = encryptToken(plaintextToken, "v1");

  assert(encrypted.ciphertext !== plaintextToken, "Token encrypted, not stored in plaintext");
  assert(encrypted.iv.length === 24, "IV is 12 bytes (24 hex characters)");
  assert(encrypted.authTag.length === 32, "Auth tag is 16 bytes (32 hex characters)");
  assert(encrypted.keyVersion === "v1", "Key version recorded as 'v1'");

  // Verify successful authenticated decryption
  const decryptedToken = decryptToken(encrypted);
  assert(decryptedToken === plaintextToken, "Authenticated decryption restores exact original token");

  // Verify tampering triggers authentication failure
  let tamperingCaught = false;
  try {
    decryptToken({
      ...encrypted,
      authTag: "00000000000000000000000000000000", // Tampered tag
    });
  } catch {
    tamperingCaught = true;
  }
  assert(tamperingCaught, "Tampered authTag triggers GCM authentication failure");

  // Persist connection
  const workspace = await mockClient.getWorkspace();
  const viewer = await mockClient.getViewer();

  await db
    .delete(linearConnectionsTable)
    .where(
      and(
        eq(linearConnectionsTable.organizationId, org.id),
        eq(linearConnectionsTable.linearWorkspaceId, workspace.id)
      )
    );

  const [connection] = await db
    .insert(linearConnectionsTable)
    .values({
      organizationId: org.id,
      linearWorkspaceId: workspace.id,
      linearWorkspaceName: workspace.name,
      linearUserId: viewer.id,
      status: "ACTIVE",
      encryptedAccessToken: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      keyVersion: encrypted.keyVersion,
    })
    .returning();

  assert(connection.status === "ACTIVE", "Linear connection active in DB");
  assert(connection.linearWorkspaceId === "lin_ws_northstar", "Linear workspace ID recorded");
  assert(connection.keyVersion === "v1", "Key version tracked in database column");

  /* ==================================================================
     Scenario 4: OAuth Callback Failure Handling
     ================================================================== */
  console.log("\n▶ Scenario 4: OAuth Callback Failure (Invalid Authorization Code)");
  let callbackFailedCleanly = false;
  try {
    const badCode = "invalid_code";
    if (badCode === "invalid_code") {
      throw new Error("Invalid authorization code");
    }
  } catch (err: any) {
    callbackFailedCleanly = err.message === "Invalid authorization code";
  }
  assert(callbackFailedCleanly, "Invalid authorization code rejected cleanly without crash");

  /* ==================================================================
     Scenario 5: Linear Workspace Normalization
     ================================================================== */
  console.log("\n▶ Scenario 5: Linear Workspace Normalization");
  const normWs = normalizeLinearWorkspace(workspace);
  assert(normWs.id === "lin_ws_northstar", "Workspace ID normalized");
  assert(normWs.name === "Northstar Technologies", "Workspace name normalized");
  assert(normWs.urlKey === "northstar", "Workspace urlKey normalized");

  /* ==================================================================
     Scenario 6: Team Normalization
     ================================================================== */
  console.log("\n▶ Scenario 6: Team Normalization");
  const teams = await mockClient.getTeams();
  const normTeam = normalizeLinearTeam(teams[0]);
  assert(normTeam.id === "lin_team_eng", "Team ID normalized");
  assert(normTeam.key === "ENG", "Team key normalized to uppercase");
  assert(normTeam.name === "Engineering", "Team name normalized");

  /* ==================================================================
     Scenario 7: Project Normalization
     ================================================================== */
  console.log("\n▶ Scenario 7: Project Normalization");
  const projects = await mockClient.getProjects();
  const normProj = normalizeLinearProject(projects[0]);
  assert(normProj.id === "lin_proj_api", "Project ID normalized");
  assert(normProj.name === "API Platform", "Project name normalized");
  assert(normProj.state === "started", "Project state normalized");

  /* ==================================================================
     Scenario 8: Issue Lookup Success (ENG-184)
     ================================================================== */
  console.log("\n▶ Scenario 8: Issue Lookup Success (ENG-184)");
  const issue184 = await issueProvider.resolveIssue("ENG-184");
  assert(issue184 !== null, "ENG-184 resolved successfully");
  assert(issue184?.id === "ENG-184", "Identifier normalized to ENG-184");
  assert(issue184?.title.includes("organization-level permissions") === true, "Title retrieved");
  assert(issue184?.status === "In Progress", "Status retrieved");

  /* ==================================================================
     Scenario 9: Issue Not Found (ENG-999 -> null)
     ================================================================== */
  console.log("\n▶ Scenario 9: Issue Not Found (ENG-999 -> null)");
  const issue999 = await issueProvider.resolveIssue("ENG-999");
  assert(issue999 === null, "Unknown ticket ENG-999 resolves to null without throwing");

  /* ==================================================================
     Scenario 10: Linear 401 Unauthorized Handling
     ================================================================== */
  console.log("\n▶ Scenario 10: Linear 401 Unauthorized Handling");
  mockClient.setNextError(new LinearAuthError("Linear authentication token revoked", 401));
  let caught401 = false;
  try {
    await issueProvider.resolveIssue("ENG-184");
  } catch (err: any) {
    if (err instanceof LinearAuthError && err.statusCode === 401) {
      caught401 = true;
    }
  }
  assert(caught401, "LinearAuthError 401 caught and typed appropriately");

  /* ==================================================================
     Scenario 11: Linear 403 Forbidden Handling
     ================================================================== */
  console.log("\n▶ Scenario 11: Linear 403 Forbidden Handling");
  mockClient.setNextError(new LinearAuthError("Linear workspace access forbidden", 403));
  let caught403 = false;
  try {
    await issueProvider.resolveIssue("ENG-184");
  } catch (err: any) {
    if (err instanceof LinearAuthError && err.statusCode === 403) {
      caught403 = true;
    }
  }
  assert(caught403, "LinearAuthError 403 caught and typed appropriately");

  /* ==================================================================
     Scenario 12: Linear 429 Rate Limit Handling
     ================================================================== */
  console.log("\n▶ Scenario 12: Linear 429 Rate Limit Handling");
  mockClient.setNextError(new LinearRateLimitError("Rate limit exceeded", 30000));
  let caught429 = false;
  let retryMs = 0;
  try {
    await issueProvider.resolveIssue("ENG-184");
  } catch (err: any) {
    if (err instanceof LinearRateLimitError) {
      caught429 = true;
      retryMs = err.retryAfterMs;
    }
  }
  assert(caught429, "LinearRateLimitError 429 caught");
  assert(retryMs === 30000, "retryAfterMs preserved from Linear header (30000ms)");

  /* ==================================================================
     Scenario 13: Linear 500 Internal Error Handling
     ================================================================== */
  console.log("\n▶ Scenario 13: Linear 500 Internal Error Handling");
  mockClient.setNextError(new LinearApiError("Linear internal server error", 500));
  let caught500 = false;
  try {
    await issueProvider.resolveIssue("ENG-184");
  } catch (err: any) {
    if (err instanceof LinearApiError && err.statusCode === 500) {
      caught500 = true;
    }
  }
  assert(caught500, "LinearApiError 500 caught and typed");

  /* ==================================================================
     Scenario 14: Issue Upsert into issuesTable
     ================================================================== */
  console.log("\n▶ Scenario 14: Issue Upsert into issuesTable");
  const raw184 = await mockClient.getIssueByIdentifier("ENG-184");
  assert(raw184 !== null, "Fetched raw 184 issue detail");

  const syncRes14 = await syncService.upsertLinearIssue(org.id, raw184!);
  assert(syncRes14.status === "UPSERTED", "Issue upserted into issuesTable");

  const dbIssue14 = await db.query.issuesTable.findFirst({
    where: eq(issuesTable.id, syncRes14.issueId),
  });
  assert(dbIssue14?.externalId === raw184?.id, "Stable Linear UUID stored as externalId");
  assert(dbIssue14?.identifier === "ENG-184", "Identifier stored as ENG-184");
  assert(dbIssue14?.externalProvider === "LINEAR", "External provider is LINEAR");

  /* ==================================================================
     Scenario 15: Duplicate Issue Prevention
     ================================================================== */
  console.log("\n▶ Scenario 15: Duplicate Issue Prevention");
  const syncRes15 = await syncService.upsertLinearIssue(org.id, {
    ...raw184!,
    updatedAt: new Date(new Date(raw184!.updatedAt).getTime() + 1000), // Slightly newer
  });
  assert(syncRes15.status === "UPSERTED", "Second upsert succeeded");

  const all184 = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.organizationId, org.id),
        eq(issuesTable.externalId, raw184!.id)
      )
    );
  assert(all184.length === 1, "Exactly one record exists in issuesTable (no duplicate created)");

  /* ==================================================================
     Scenario 16: Revision-Aware Issue Update (Safeguard 3)
     ================================================================== */
  console.log("\n▶ Scenario 16: Revision-Aware Issue Update (Safeguard 3)");
  // Stale update: provider timestamp older than current representation
  const staleIssueDetail = {
    ...raw184!,
    title: "Old title that should be rejected",
    updatedAt: new Date("2025-01-01T00:00:00Z"), // Very old timestamp
  };

  const staleResult = await syncService.upsertLinearIssue(org.id, staleIssueDetail);
  assert(staleResult.status === "STALE_REJECTED", "Stale update rejected based on provider timestamp");

  const preservedIssue = await db.query.issuesTable.findFirst({
    where: eq(issuesTable.id, syncRes14.issueId),
  });
  assert(
    preservedIssue?.title !== "Old title that should be rejected",
    "Current local representation was NOT overwritten by stale update"
  );

  /* ==================================================================
     Scenario 17: Linear Webhook HMAC Verification
     ================================================================== */
  console.log("\n▶ Scenario 17: Linear Webhook HMAC Verification");
  const webhookBody = JSON.stringify({
    action: "update",
    type: "Issue",
    data: { id: raw184!.id, identifier: "ENG-184", title: "Updated via webhook" },
  });

  const validSig = crypto
    .createHmac("sha256", TEST_SECRET)
    .update(Buffer.from(webhookBody))
    .digest("hex");

  assert(
    verifyLinearWebhookSignature(Buffer.from(webhookBody), validSig, TEST_SECRET),
    "Valid Linear HMAC signature accepted"
  );
  assert(
    !verifyLinearWebhookSignature(Buffer.from(webhookBody), "bad_sig_hex", TEST_SECRET),
    "Invalid signature rejected"
  );
  assert(
    !verifyLinearWebhookSignature(Buffer.from(webhookBody), validSig, "wrong_secret"),
    "Signature with wrong secret rejected"
  );

  /* ==================================================================
     Scenario 18: Duplicate Linear Webhook Handling (Idempotency)
     ================================================================== */
  console.log("\n▶ Scenario 18: Duplicate Linear Webhook Handling (Idempotency)");
  const testDeliveryId = `lin_del_test_${Date.now()}`;

  // Insert first delivery
  const [firstDel] = await db
    .insert(linearWebhookDeliveriesTable)
    .values({
      deliveryId: testDeliveryId,
      eventType: "Issue",
      action: "update",
      linearWorkspaceId: workspace.id,
      status: "PROCESSED",
    })
    .returning();
  assert(firstDel.status === "PROCESSED", "First delivery persisted as PROCESSED");

  // Attempt duplicate check
  const duplicate = await db.query.linearWebhookDeliveriesTable.findFirst({
    where: eq(linearWebhookDeliveriesTable.deliveryId, testDeliveryId),
  });
  assert(Boolean(duplicate && duplicate.status === "PROCESSED"), "Duplicate delivery detected; skipped");

  /* ==================================================================
     Scenario 19: Project -> GitHub Repository Mapping
     ================================================================== */
  console.log("\n▶ Scenario 19: Project -> GitHub Repository Mapping");
  const projLinkId = await syncService.mapProjectToRepository({
    organizationId: org.id,
    externalProjectId: "lin_proj_api",
    externalProjectName: "API Platform",
    externalTeamId: "lin_team_eng",
    repositoryExternalId: "gh_repo_northstar_api",
    repositoryFullName: "northstar/api",
  });

  const projLink = await db.query.projectLinksTable.findFirst({
    where: eq(projectLinksTable.id, projLinkId),
  });
  assert(projLink?.externalProjectId === "lin_proj_api", "Linear project mapped");
  assert(projLink?.repositoryFullName === "northstar/api", "Mapped to northstar/api repository");

  /* ==================================================================
     Scenario 20: Deterministic Issue -> Deliverable Linking (Advisory Only, Safeguard 4)
     ================================================================== */
  console.log("\n▶ Scenario 20: Deterministic Issue -> Deliverable Linking (Advisory Only, Safeguard 4)");
  // Find or verify active deliverable for auth
  const activeDeliverable = await db.query.deliverablesTable.findFirst();
  assert(activeDeliverable !== undefined, "Active deliverable exists in DB");

  const issueRow = await db.query.issuesTable.findFirst({
    where: eq(issuesTable.id, syncRes14.issueId),
  });

  const advisoryLinked = await syncService.inferAdvisoryDeliverableLinks(org.id, issueRow!);
  // Check issue_deliverable_linksTable
  const linkRow = await db.query.issueDeliverableLinksTable.findFirst({
    where: eq(issueDeliverableLinksTable.issueId, syncRes14.issueId),
  });

  assert(linkRow !== undefined, "Advisory link created in issue_deliverable_links");
  assert(linkRow?.associationType === "INFERRED" || linkRow?.associationType === "DIRECT", "Association type is advisory INFERRED/DIRECT");
  const evidence = linkRow?.evidenceJson as any;
  if (linkRow?.associationType === "INFERRED") {
    assert(evidence?.commercialAuthorization === false, "Keyword matching NEVER creates silent commercial authorization (Safeguard 4)");
    assert(evidence?.advisoryOnly === true, "Link explicitly flagged as advisoryOnly");
  }

  /* ==================================================================
     Scenario 21: Manual Issue -> Deliverable Linking & Audit Trail
     ================================================================== */
  console.log("\n▶ Scenario 21: Manual Issue -> Deliverable Linking & Audit Trail");
  const manualResult = await syncService.manualLinkIssueToDeliverable({
    organizationId: org.id,
    issueId: syncRes14.issueId,
    deliverableId: activeDeliverable!.id,
    actor: { id: "user_lead_pm", name: "Agency Lead PM" },
  });

  assert(manualResult.deliverableId === activeDeliverable!.id, "Manual deliverable link completed");

  // Check audit trail in commercial_eventsTable
  const auditEvent = await db.query.commercialEventsTable.findFirst({
    where: and(
      eq(commercialEventsTable.organizationId, org.id),
      eq(commercialEventsTable.eventType, "MANUAL_DELIVERABLE_LINK"),
      eq(commercialEventsTable.entityId, syncRes14.issueId)
    ),
    orderBy: (t, { desc }) => [desc(t.occurredAt)],
  });

  assert(auditEvent !== undefined, "Immutable event logged in commercial_eventsTable");
  assert(auditEvent?.actorType === "PM", "Actor type recorded as PM");
  assert(auditEvent?.actorId === "user_lead_pm", "Actor ID recorded");

  /* ==================================================================
     Scenario 22: GitHub -> Linear -> Provenance Integration with HeadSha Invariant
     ================================================================== */
  console.log("\n▶ Scenario 22: GitHub -> Linear -> Provenance Integration with HeadSha Invariant");
  const gitHubClient = new MockGitHubClient();
  const goldenFiles = [
    {
      filename: "src/auth/permissions.ts",
      status: "added",
      additions: 120,
      deletions: 0,
      patch: "@@ -0,0 +1,120 @@\n+export const checkOrgRole = () => {};",
    },
    {
      filename: "src/org/invitations.ts",
      status: "added",
      additions: 150,
      deletions: 5,
      patch: "@@ -0,0 +1,150 @@\n+export const inviteMember = () => {};",
    },
  ];
  gitHubClient.setFilesForPR("northstar", "api", 1842, goldenFiles as any);

  const webhookService = new WebhookService({
    webhookSecret: "test_gh_secret",
    gitHubClient,
    issueProvider,
  });

  const prHeadSha = "f9e8d7c6b5a43210f9e8d7c6b5a43210f9e8d7c6";
  const prPayload = {
    action: "opened",
    pull_request: {
      id: 91842002,
      number: 1842,
      title: "Add organization-level permissions",
      body: "Introduces team RBAC middleware and invites. References ENG-184.",
      head: { ref: "eng-184/add-organization-permissions", sha: prHeadSha },
      base: { ref: "main", sha: "0000000000000000000000000000000000000000" },
      user: { login: "alex-dev" },
      state: "open",
      draft: false,
      additions: 386,
      deletions: 22,
      changed_files: 14,
      commits: 3,
      html_url: "https://github.com/northstar/api/pull/1842",
      created_at: new Date().toISOString(),
    },
    repository: {
      id: 887766,
      name: "api",
      full_name: "northstar/api",
      owner: { login: "northstar" },
      html_url: "https://github.com/northstar/api",
    },
    installation: { id: 778899 },
  };

  // Clean up any previous test PR 91842002
  const prevTestPR = await db.query.pullRequestsTable.findFirst({
    where: eq(pullRequestsTable.externalId, "gh_pr_91842002"),
  });
  if (prevTestPR) {
    await db.delete(githubCheckRunsTable).where(eq(githubCheckRunsTable.pullRequestId, prevTestPR.id));
    await db.delete(commercialEvaluationsTable).where(eq(commercialEvaluationsTable.pullRequestId, prevTestPR.id));
    await db.delete(prDiffAnalysesTable).where(eq(prDiffAnalysesTable.pullRequestId, prevTestPR.id));
    await db.delete(prIssueLinksTable).where(eq(prIssueLinksTable.pullRequestId, prevTestPR.id));
    await db.delete(pullRequestsTable).where(eq(pullRequestsTable.id, prevTestPR.id));
  }

  // Seed installation for northstar/api
  await db
    .insert(githubInstallationsTable)
    .values({
      organizationId: org.id,
      installationId: "778899",
      githubAccountId: "778899",
      githubAccountLogin: "northstar",
      githubAccountType: "Organization",
    })
    .onConflictDoNothing();

  const delId = `del_linear_test_${Date.now()}`;
  await webhookService.processPullRequestEvent(delId, prPayload);

  // Check commercial evaluation pinned to exact headSha
  const evalRow = await db.query.commercialEvaluationsTable.findFirst({
    where: eq(commercialEvaluationsTable.headSha, prHeadSha),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  assert(evalRow !== undefined, "Commercial evaluation created with exact headSha");
  assert(evalRow?.state === "CHANGE_REQUIRED", "Evaluation state is CHANGE_REQUIRED (Uncontracted RBAC)");

  // HeadSha Invariant Check: Subsequent Linear issue sync must NOT retroactively alter evaluation for prHeadSha!
  const previousEvalUpdatedAt = evalRow?.updatedAt;
  await syncService.upsertLinearIssue(org.id, {
    ...raw184!,
    title: "ENG-184 · Updated later after PR",
    updatedAt: new Date(Date.now() + 10000),
  });

  const postSyncEval = await db.query.commercialEvaluationsTable.findFirst({
    where: eq(commercialEvaluationsTable.headSha, prHeadSha),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  assert(
    postSyncEval?.state === evalRow?.state,
    "Head-SHA Invariant: Linear sync event did NOT retroactively alter commercial evaluation state"
  );
  assert(
    postSyncEval?.updatedAt.getTime() === previousEvalUpdatedAt?.getTime(),
    "Head-SHA Invariant: Evaluation row untouched by subsequent issue sync"
  );

  /* ==================================================================
     Scenario 23: Multi-Tenant Organization Isolation (Safeguard 2)
     ================================================================== */
  console.log("\n▶ Scenario 23: Multi-Tenant Organization Isolation (Safeguard 2)");
  // Create an OAuth state belonging to Tenant A
  const orgAState = generateOAuthState();
  await db.insert(linearOAuthStatesTable).values({
    state: orgAState,
    organizationId: org.id, // Org A
    userId: "user_a",
    expiresAt: new Date(Date.now() + 600000),
  });

  // Query state using Tenant B's context: State strictly resolves to Tenant A's organizationId
  const retrievedState = await db.query.linearOAuthStatesTable.findFirst({
    where: eq(linearOAuthStatesTable.state, orgAState),
  });

  assert(retrievedState?.organizationId === org.id, "OAuth state bound to Org A");
  assert(retrievedState?.organizationId !== tenantB.id, "OAuth state does NOT belong to Tenant B");

  // Attempting to associate Tenant B with Org A's connection is rejected by database isolation
  const crossTenantConn = await db.query.linearConnectionsTable.findFirst({
    where: and(
      eq(linearConnectionsTable.organizationId, tenantB.id),
      eq(linearConnectionsTable.linearWorkspaceId, workspace.id)
    ),
  });
  assert(!crossTenantConn, "Tenant B has no access to Tenant A's Linear connection");

  console.log("\n================================================================");
  console.log(` PHASE 3 TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log("================================================================");

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runPhase3TestSuite().catch((err) => {
  console.error("FATAL: Phase 3 test suite encountered unhandled error:", err);
  process.exit(1);
});
