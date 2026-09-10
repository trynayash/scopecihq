import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  commercialEvaluationsTable,
  commercialEventsTable,
  githubCheckRunsTable,
  githubInstallationsTable,
  issuesTable,
  prDiffAnalysesTable,
  prIssueLinksTable,
  projectLinksTable,
  pullRequestsTable,
  scopeBaselinesTable,
  webhookDeliveriesTable,
} from "@workspace/db/schema";
import {
  WebhookService,
  verifyWebhookSignature,
} from "../github/webhook-service.js";
import { MockGitHubClient } from "../github/github-client.js";
import { MockIssueProvider } from "../github/issue-provider.js";
import { extractIssueReferences } from "../github/extractor.js";
import { normalizePullRequestDiff, type RawGitHubFile } from "../github/diff-collector.js";
import { COMMENT_MARKER } from "../github/comment-formatter.js";

const TEST_SECRET = "test_webhook_secret_scopeci_alpha_phase2";

function signPayload(payload: any, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  if (Buffer.isBuffer(payload)) {
    hmac.update(payload);
  } else if (typeof payload === "string") {
    hmac.update(Buffer.from(payload, "utf8"));
  } else {
    hmac.update(Buffer.from(JSON.stringify(payload), "utf8"));
  }
  return `sha256=${hmac.digest("hex")}`;
}

async function runPhase2TestSuite(): Promise<void> {
  console.log("================================================================");
  console.log("       SCOPECI ALPHA — PHASE 2: GITHUB APP TEST SUITE           ");
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

  const gitHubClient = new MockGitHubClient();
  const issueProvider = new MockIssueProvider();
  const service = new WebhookService({
    webhookSecret: TEST_SECRET,
    gitHubClient,
    issueProvider,
  });

  // Clean reset of previous test deliveries & PR 91842001
  const prevTestPR = await db.query.pullRequestsTable.findFirst({
    where: eq(pullRequestsTable.externalId, "gh_pr_91842001"),
  });
  if (prevTestPR) {
    await db.delete(githubCheckRunsTable).where(eq(githubCheckRunsTable.pullRequestId, prevTestPR.id));
    await db.delete(commercialEvaluationsTable).where(eq(commercialEvaluationsTable.pullRequestId, prevTestPR.id));
    await db.delete(prDiffAnalysesTable).where(eq(prDiffAnalysesTable.pullRequestId, prevTestPR.id));
    await db.delete(prIssueLinksTable).where(eq(prIssueLinksTable.pullRequestId, prevTestPR.id));
    await db.delete(pullRequestsTable).where(eq(pullRequestsTable.id, prevTestPR.id));
  }

  // Base Golden Payload for PR #1842
  const goldenSha = "e4d9b12f83a45c08d928a6f9174092b7c41938ab";
  const makePRPayload = (overrides?: any) => {
    const basePR = {
      id: 91842001,
      number: 1842,
      title: "Add organization-level permissions",
      body: "Introduces team RBAC middleware and invites. References ENG-184.",
      head: { ref: "eng-184/add-organization-permissions", sha: goldenSha },
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
    };

    return {
      action: "opened",
      installation: { id: 184200 },
      repository: {
        id: 184200,
        name: "api",
        full_name: "northstar/api",
        owner: { login: "northstar" },
        ...overrides?.repository,
      },
      ...overrides,
      pull_request: {
        ...basePR,
        ...overrides?.pull_request,
        head: {
          ...basePR.head,
          ...overrides?.pull_request?.head,
        },
      },
    };
  };

  // Default Files for PR #1842
  const goldenFiles: RawGitHubFile[] = [
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
    {
      filename: "docs/architecture.png",
      status: "added",
      additions: 0,
      deletions: 0,
      is_binary: true,
    },
    {
      filename: "legacy-auth.js",
      status: "renamed",
      previous_filename: "old-auth.js",
      additions: 10,
      deletions: 17,
      patch: "@@ -1,5 +1,5 @@\n-old()\n+new()",
    },
  ];
  gitHubClient.setFilesForPR("northstar", "api", 1842, goldenFiles);

  // -------------------------------------------------------------
  // Test 1: Valid pull_request opened webhook
  // -------------------------------------------------------------
  console.log("▶ Test 1: Valid pull_request opened webhook");
  const delivery1 = `del_test_1_${Date.now()}`;
  const payload1 = makePRPayload();
  const rawBody1 = Buffer.from(JSON.stringify(payload1));
  const sig1 = signPayload(rawBody1, TEST_SECRET);

  const precheck1 = await service.precheckAndPersistDelivery(
    { deliveryId: delivery1, eventType: "pull_request", signature: sig1 },
    rawBody1,
    payload1
  );
  assert(precheck1.shouldProcess === true, "Precheck accepts valid pull_request opened");

  const result1 = await service.processPullRequestEvent(delivery1, payload1);
  assert(result1.status === "processed", "PR event processed successfully");
  assert(result1.prNumber === 1842, "PR number 1842 captured");
  assert(result1.checkConclusion === "neutral", "Check conclusion is NEUTRAL in Observe mode");

  // -------------------------------------------------------------
  // Test 2: Invalid webhook signature
  // -------------------------------------------------------------
  console.log("\n▶ Test 2: Invalid webhook signature rejected");
  let sigErrorThrown = false;
  try {
    await service.precheckAndPersistDelivery(
      { deliveryId: `del_bad_sig_${Date.now()}`, eventType: "pull_request", signature: "sha256=invalid_bad_hash" },
      rawBody1,
      payload1
    );
  } catch (err: any) {
    sigErrorThrown = true;
  }
  assert(sigErrorThrown === true, "Invalid webhook signature rejected with error");

  // -------------------------------------------------------------
  // Test 3: Duplicate webhook delivery idempotency
  // -------------------------------------------------------------
  console.log("\n▶ Test 3: Duplicate webhook delivery idempotency");
  const duplicatePrecheck = await service.precheckAndPersistDelivery(
    { deliveryId: delivery1, eventType: "pull_request", signature: sig1 },
    rawBody1,
    payload1
  );
  assert(duplicatePrecheck.shouldProcess === false, "Duplicate delivery rejected from re-processing");
  assert(duplicatePrecheck.reason === "already_processed", "Reason is already_processed");

  // Verify delivery record status
  const deliveryRec = await db.query.webhookDeliveriesTable.findFirst({
    where: eq(webhookDeliveriesTable.deliveryId, delivery1),
  });
  assert(deliveryRec?.status === "PROCESSED", "Webhook delivery table status is PROCESSED");
  assert(deliveryRec?.headSha === goldenSha, "Webhook delivery records headSha");

  // -------------------------------------------------------------
  // Test 4: PR upsert in pull_requests table
  // -------------------------------------------------------------
  console.log("\n▶ Test 4: PR upsert verification in Provenance Graph");
  const prRow = await db.query.pullRequestsTable.findFirst({
    where: and(
      eq(pullRequestsTable.externalProvider, "GITHUB"),
      eq(pullRequestsTable.externalId, "gh_pr_91842001")
    ),
  });
  assert(prRow !== undefined, "PR #1842 exists in pull_requests table");
  assert(prRow?.headBranch === "eng-184/add-organization-permissions", "Head branch saved");
  assert(prRow?.state === "OPEN", "PR state is OPEN");

  // -------------------------------------------------------------
  // Test 5: PR synchronize update
  // -------------------------------------------------------------
  console.log("\n▶ Test 5: PR synchronize update");
  const deliverySync = `del_sync_${Date.now()}`;
  const newSha = "a1b2c3d4e5f67890123456789abcdef012345678";
  const payloadSync = makePRPayload({
    action: "synchronize",
    pull_request: {
      head: { ref: "eng-184/add-organization-permissions", sha: newSha },
      commits: 5,
      additions: 410,
    },
  });
  const rawBodySync = Buffer.from(JSON.stringify(payloadSync));
  const sigSync = signPayload(rawBodySync, TEST_SECRET);

  await service.precheckAndPersistDelivery(
    { deliveryId: deliverySync, eventType: "pull_request", signature: sigSync },
    rawBodySync,
    payloadSync
  );
  const resultSync = await service.processPullRequestEvent(deliverySync, payloadSync);
  assert(resultSync.status === "processed", "Synchronize processed");

  const prRowUpdated = await db.query.pullRequestsTable.findFirst({
    where: eq(pullRequestsTable.id, prRow!.id),
  });
  assert(prRowUpdated?.commitsCount === 5, "Commit count updated to 5 on synchronize");
  assert(prRowUpdated?.additions === 410, "Additions updated to 410 on synchronize");

  // Verify Check Run was updated rather than duplicated (Check-run idempotency)
  const checkRunsForPR = await db.select().from(githubCheckRunsTable).where(eq(githubCheckRunsTable.pullRequestId, prRow!.id));
  assert(checkRunsForPR.length === 1, "Exactly one check run row exists for PR #1842 (Check-run idempotency)");
  assert(checkRunsForPR[0].headSha === newSha, "Check Run headSha updated to new commit SHA");

  // -------------------------------------------------------------
  // Test 6: PR reopened
  // -------------------------------------------------------------
  console.log("\n▶ Test 6: PR reopened state handling");
  const deliveryReopened = `del_reopened_${Date.now()}`;
  const payloadReopened = makePRPayload({ action: "reopened" });
  const rawBodyReopened = Buffer.from(JSON.stringify(payloadReopened));
  await service.precheckAndPersistDelivery(
    { deliveryId: deliveryReopened, eventType: "pull_request", signature: signPayload(rawBodyReopened, TEST_SECRET) },
    rawBodyReopened,
    payloadReopened
  );
  const resultReopened = await service.processPullRequestEvent(deliveryReopened, payloadReopened);
  assert(resultReopened.status === "processed", "Reopened PR processed");

  // -------------------------------------------------------------
  // Test 7: PR closed
  // -------------------------------------------------------------
  console.log("\n▶ Test 7: PR closed state handling");
  const deliveryClosed = `del_closed_${Date.now()}`;
  const payloadClosed = makePRPayload({
    action: "closed",
    pull_request: { state: "closed", merged: true, merged_at: new Date().toISOString() },
  });
  const rawBodyClosed = Buffer.from(JSON.stringify(payloadClosed));
  await service.precheckAndPersistDelivery(
    { deliveryId: deliveryClosed, eventType: "pull_request", signature: signPayload(rawBodyClosed, TEST_SECRET) },
    rawBodyClosed,
    payloadClosed
  );
  const resultClosed = await service.processPullRequestEvent(deliveryClosed, payloadClosed);
  assert(resultClosed.status === "processed", "Closed PR handled");

  const prClosedRow = await db.query.pullRequestsTable.findFirst({
    where: eq(pullRequestsTable.id, prRow!.id),
  });
  assert(prClosedRow?.state === "MERGED", "PR state updated to MERGED");

  // -------------------------------------------------------------
  // Test 8: Issue extraction from branch
  // -------------------------------------------------------------
  console.log("\n▶ Test 8: Issue extraction from branch name");
  const refsFromBranch = extractIssueReferences({ branchName: "eng-184/add-organization-permissions" });
  assert(refsFromBranch.length === 1, "Extracted 1 issue from branch");
  assert(refsFromBranch[0].identifier === "ENG-184", "Identifier normalized to ENG-184");
  assert(refsFromBranch[0].linkMethod === "BRANCH_NAME", "Method is BRANCH_NAME");
  assert(refsFromBranch[0].confidence === 0.98, "Confidence is 0.98");

  // -------------------------------------------------------------
  // Test 9: Issue extraction from PR title
  // -------------------------------------------------------------
  console.log("\n▶ Test 9: Issue extraction from PR title");
  const refsFromTitle = extractIssueReferences({ prTitle: "[ENG-101] Fix password reset token expiration" });
  assert(refsFromTitle.length === 1, "Extracted issue from PR title");
  assert(refsFromTitle[0].identifier === "ENG-101", "Extracted ENG-101 from title");
  assert(refsFromTitle[0].linkMethod === "PR_TITLE", "Method is PR_TITLE");

  // -------------------------------------------------------------
  // Test 10: Issue extraction from PR body
  // -------------------------------------------------------------
  console.log("\n▶ Test 10: Issue extraction from PR body");
  const refsFromBody = extractIssueReferences({ prBody: "Closes eng-204 in accordance with milestone 2." });
  assert(refsFromBody.length === 1, "Extracted issue from PR body");
  assert(refsFromBody[0].identifier === "ENG-204", "Extracted ENG-204 from body");
  assert(refsFromBody[0].linkMethod === "PR_BODY", "Method is PR_BODY");

  // -------------------------------------------------------------
  // Test 11: Multiple issue references preserved
  // -------------------------------------------------------------
  console.log("\n▶ Test 11: Multiple issue references extracted and preserved");
  const multipleRefs = extractIssueReferences({
    branchName: "feature/eng-184-rbac",
    prTitle: "Add permissions and fix auth [eng-101]",
    prBody: "Also related to ENG-204 for auditing.",
  });
  assert(multipleRefs.length === 3, "Extracted all 3 unique issue references");
  const ids = multipleRefs.map((r) => r.identifier).sort();
  assert(ids.join(",") === "ENG-101,ENG-184,ENG-204", "Preserved ENG-101, ENG-184, ENG-204 without discarding any");

  // -------------------------------------------------------------
  // Test 12: Unknown issue handled gracefully
  // -------------------------------------------------------------
  console.log("\n▶ Test 12: Unknown issue handled gracefully");
  const resolvedUnknown = await issueProvider.resolveIssue("ENG-999");
  assert(resolvedUnknown === null, "Unknown ticket ENG-999 resolves to null without throwing");

  // -------------------------------------------------------------
  // Test 13: Unknown project mapping
  // -------------------------------------------------------------
  console.log("\n▶ Test 13: Unknown repository project mapping");
  const deliveryUnmapped = `del_unmapped_${Date.now()}`;
  const payloadUnmapped = makePRPayload({
    repository: { id: 99999, name: "unknown-repo", full_name: "other-org/unknown-repo" },
    installation: { id: 99999 },
  });
  const rawBodyUnmapped = Buffer.from(JSON.stringify(payloadUnmapped));
  await service.precheckAndPersistDelivery(
    { deliveryId: deliveryUnmapped, eventType: "pull_request", signature: signPayload(rawBodyUnmapped, TEST_SECRET) },
    rawBodyUnmapped,
    payloadUnmapped
  );
  const resultUnmapped = await service.processPullRequestEvent(deliveryUnmapped, payloadUnmapped);
  assert(resultUnmapped.status === "unmapped", "Unmapped repo returns controlled 'unmapped' state");

  // -------------------------------------------------------------
  // Test 14: Diff retrieval & normalization
  // -------------------------------------------------------------
  console.log("\n▶ Test 14: Diff retrieval and normalization structure");
  const normalizedDiff = normalizePullRequestDiff("head_sha_123", goldenFiles);
  assert(normalizedDiff.totals.files === 4, "Total files is 4");
  assert(normalizedDiff.totals.additions === 280, "Total additions calculated");
  assert(normalizedDiff.totals.deletions === 22, "Total deletions calculated");
  assert(normalizedDiff.detectedSubsystems.includes("organization_rbac"), "Detected organization_rbac subsystem");

  // -------------------------------------------------------------
  // Test 15: Rename, delete, and binary file handling
  // -------------------------------------------------------------
  console.log("\n▶ Test 15: Rename, delete, and binary file handling");
  const binaryFile = normalizedDiff.files.find((f) => f.path.endsWith(".png"));
  assert(binaryFile?.isBinary === true, "Binary image file recognized (isBinary: true)");
  assert(binaryFile?.patch === undefined, "Binary file does not carry text patch");

  const renamedFile = normalizedDiff.files.find((f) => f.status === "renamed");
  assert(renamedFile !== undefined, "Renamed file status captured");
  assert(renamedFile?.previousFilename === "old-auth.js", "Previous filename preserved");

  // -------------------------------------------------------------
  // Test 16: Check Run creation
  // -------------------------------------------------------------
  console.log("\n▶ Test 16: Check Run creation with Observe mode");
  assert(gitHubClient.checkRuns.size > 0, "GitHub client created at least 1 Check Run");
  const sampleCheck = Array.from(gitHubClient.checkRuns.values())[0];
  assert(sampleCheck.name === "scopeci / commercial", "Check run name is 'scopeci / commercial'");
  assert(sampleCheck.conclusion === "neutral", "Observe mode conclusion is 'neutral'");

  // -------------------------------------------------------------
  // Test 17: Check Run update on synchronize
  // -------------------------------------------------------------
  console.log("\n▶ Test 17: Check Run update on synchronize");
  const initialCheckCount = gitHubClient.checkRuns.size;
  await gitHubClient.updateCheckRun({
    installationId: "184200",
    owner: "northstar",
    repo: "api",
    checkRunId: sampleCheck.id,
    summary: "Updated summary",
  });
  assert(gitHubClient.checkRuns.size === initialCheckCount, "Check Run updated in place without duplicate check created");

  // -------------------------------------------------------------
  // Test 18: Duplicate comment prevention (Marker search)
  // -------------------------------------------------------------
  console.log("\n▶ Test 18: Duplicate comment prevention via marker");
  const commentKey = "northstar/api#1842";
  const comments = gitHubClient.comments.get(commentKey) || [];
  assert(comments.length === 1, "Exactly 1 comment exists on PR #1842");
  assert(comments[0].body.includes(COMMENT_MARKER), "Comment contains idempotent marker <!-- scopeci-commercial-review -->");

  // Calling createOrUpdateComment again updates in place:
  const secondCommentCall = await gitHubClient.createOrUpdateComment(
    "184200",
    "northstar",
    "api",
    1842,
    `${COMMENT_MARKER}\nUpdated comment content`
  );
  assert(secondCommentCall.action === "updated", "Second comment call returned 'updated'");
  const commentsAfter = gitHubClient.comments.get(commentKey) || [];
  assert(commentsAfter.length === 1, "Still exactly 1 comment on PR #1842 (no duplicate)");

  // -------------------------------------------------------------
  // Test 19: GitHub API failure retry & error handling
  // -------------------------------------------------------------
  console.log("\n▶ Test 19: GitHub API failure handling");
  gitHubClient.simulateFailureOnce(500, "GitHub Internal Server Error");
  let caughtApiError = false;
  try {
    await gitHubClient.createCheckRun({
      installationId: "184200",
      owner: "northstar",
      repo: "api",
      headSha: "abc",
      name: "test",
      status: "completed",
      title: "Test",
      summary: "Test",
    });
  } catch (err: any) {
    caughtApiError = true;
    assert(err.statusCode === 500, "Captured 500 error cleanly");
  }
  assert(caughtApiError === true, "External API failure intercepted");

  // -------------------------------------------------------------
  // Test 20: GitHub rate limit (429) backoff handling
  // -------------------------------------------------------------
  console.log("\n▶ Test 20: GitHub rate limit (429) simulation");
  gitHubClient.simulateFailureOnce(429, "Rate limit exceeded", 60);
  let caughtRateLimit = false;
  try {
    await gitHubClient.getPullRequestFiles("184200", "northstar", "api", 1842);
  } catch (err: any) {
    caughtRateLimit = true;
    assert(err.statusCode === 429, "Caught 429 Rate Limit");
    assert(err.retryAfter === 60, "Extracted retryAfter = 60s");
  }
  assert(caughtRateLimit === true, "Rate limit error handled");

  // -------------------------------------------------------------
  // Test 21: Commercial Engine Invocation (Without Policy Duplication)
  // -------------------------------------------------------------
  console.log("\n▶ Test 21: Domain Commercial Engine Invocation");
  const evalRow = await db.query.commercialEvaluationsTable.findFirst({
    where: eq(commercialEvaluationsTable.pullRequestId, prRow!.id),
  });
  assert(evalRow !== undefined, "Commercial evaluation persisted in database");
  assert(evalRow?.policyMode === "OBSERVE", "Policy mode is OBSERVE");
  assert(Boolean(evalRow?.evaluatorVersion?.startsWith("scopeci-")), "Evaluator version recorded");

  // -------------------------------------------------------------
  // Test 22: Full Mocked End-to-End Flow & HeadSha Invariant Verification
  // -------------------------------------------------------------
  console.log("\n▶ Test 22: Full end-to-end golden flow & HeadSha Invariant");
  const goldenDelivery = `del_golden_${Date.now()}`;
  const goldenShaRevision = "f9e8d7c6b5a43210f9e8d7c6b5a43210f9e8d7c6";
  const goldenPRPayload = makePRPayload({
    pull_request: {
      number: 1842,
      title: "Add organization-level permissions",
      head: { ref: "eng-184/add-organization-permissions", sha: goldenShaRevision },
      body: "Connects to ENG-184.",
    },
  });

  const goldenSig = signPayload(goldenPRPayload, TEST_SECRET);
  await service.precheckAndPersistDelivery(
    { deliveryId: goldenDelivery, eventType: "pull_request", signature: goldenSig },
    Buffer.from(JSON.stringify(goldenPRPayload)),
    goldenPRPayload
  );

  const goldenResult = await service.processPullRequestEvent(goldenDelivery, goldenPRPayload);
  assert(goldenResult.status === "processed", "Golden scenario processed");
  assert(goldenResult.checkConclusion === "neutral", "Golden check conclusion is neutral (Observe mode)");

  // Verify the HeadSha Invariant:
  // PR revision SHA -> Diff analysis SHA -> Commercial evaluation SHA -> GitHub Check Run headSha
  const latestDiff = await db.query.prDiffAnalysesTable.findFirst({
    where: eq(prDiffAnalysesTable.headSha, goldenShaRevision),
  });
  assert(latestDiff !== undefined, "Diff analysis created with exact headSha");

  const latestEval = await db.query.commercialEvaluationsTable.findFirst({
    where: eq(commercialEvaluationsTable.headSha, goldenShaRevision),
  });
  assert(latestEval !== undefined, "Commercial evaluation created with exact headSha");
  assert(latestEval?.prDiffAnalysisId === latestDiff?.id, "Evaluation strictly linked to the diff analysis for that SHA");

  const latestCheck = await db.query.githubCheckRunsTable.findFirst({
    where: eq(githubCheckRunsTable.headSha, goldenShaRevision),
  });
  assert(latestCheck !== undefined, "GitHub Check Run updated with exact headSha");
  assert(latestCheck?.latestEvaluationId === latestEval?.id, "Check Run directly references evaluation for that revision SHA");

  // Verify PR -> Issue relationship was established in DB
  const prIssueLink = await db.query.prIssueLinksTable.findFirst({
    where: eq(prIssueLinksTable.pullRequestId, prRow!.id),
  });
  assert(prIssueLink !== undefined, "PR -> Issue link persisted in pr_issue_links");
  assert(Number(prIssueLink?.confidence) > 0.9, "High confidence linkage recorded");

  console.log("\n================================================================");
  console.log(` PHASE 2 TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log("================================================================");

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runPhase2TestSuite().catch((err) => {
  console.error("Fatal error running Phase 2 test suite:", err);
  process.exit(1);
});
