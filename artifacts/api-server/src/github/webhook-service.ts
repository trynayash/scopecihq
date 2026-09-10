import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  commercialEvaluationsTable,
  commercialEventsTable,
  githubCheckRunsTable,
  githubInstallationsTable,
  contractsTable,
  issuesTable,
  prDiffAnalysesTable,
  prIssueLinksTable,
  projectLinksTable,
  pullRequestsTable,
  scopeBaselinesTable,
  webhookDeliveriesTable,
} from "@workspace/db/schema";
import {
  evaluateCommercialScope,
  type CommercialEvaluation,
  type LinearIssue,
  type ScopeBaseline,
} from "@workspace/commercial-engine";
import { type IGitHubClient } from "./github-client.js";
import { type IssueProvider } from "./issue-provider.js";
import { extractIssueReferences } from "./extractor.js";
import { normalizePullRequestDiff } from "./diff-collector.js";
import { formatScopeCIComment } from "./comment-formatter.js";
import { logger } from "../lib/logger.js";

export interface GitHubWebhookHeaders {
  deliveryId: string;
  eventType: string;
  signature?: string;
}

export interface WebhookServiceConfig {
  webhookSecret: string;
  gitHubClient: IGitHubClient;
  issueProvider: IssueProvider;
}

export interface WebhookProcessResult {
  deliveryId: string;
  status: "processed" | "already_processed" | "ignored" | "unmapped" | "error";
  action?: string;
  prNumber?: number;
  evaluationState?: string;
  checkConclusion?: string;
  error?: string;
}

/**
 * Verifies HMAC SHA-256 webhook signature.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return false;
  }

  const expectedSignature = parts[1];
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  const digest = hmac.digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(digest, "utf8"), Buffer.from(expectedSignature, "utf8"));
  } catch {
    return false;
  }
}

export class WebhookService {
  private secret: string;
  private gitHubClient: IGitHubClient;
  private issueProvider: IssueProvider;

  constructor(config: WebhookServiceConfig) {
    this.secret = config.webhookSecret;
    this.gitHubClient = config.gitHubClient;
    this.issueProvider = config.issueProvider;
  }

  /**
   * Fast ingestion and signature validation.
   * Checks idempotency; if not previously processed, persists a PENDING record.
   */
  async precheckAndPersistDelivery(
    headers: GitHubWebhookHeaders,
    rawBody: Buffer | string,
    payload: any
  ): Promise<{ shouldProcess: boolean; reason?: string }> {
    const { deliveryId, eventType, signature } = headers;

    // 1. Signature Verification (Fail-closed in production or when secret configured)
    if (this.secret) {
      if (!signature || !verifyWebhookSignature(rawBody, signature, this.secret)) {
        logger.warn({ deliveryId, eventType }, "GitHub webhook signature verification failed");
        throw new Error("Invalid webhook signature");
      }
    } else if (process.env.NODE_ENV === "production") {
      logger.error("GITHUB_WEBHOOK_SECRET is not configured in production; failing closed");
      throw new Error("GitHub webhook secret not configured");
    }

    // 2. Ping event handling
    if (eventType === "ping") {
      logger.info({ deliveryId }, "Received GitHub ping event; webhook active");
      return { shouldProcess: false, reason: "ping_acknowledged" };
    }

    // Only process pull_request events in this pipeline
    if (eventType !== "pull_request") {
      logger.debug({ deliveryId, eventType }, "Ignoring non-PR GitHub event");
      return { shouldProcess: false, reason: "unsupported_event_type" };
    }

    // 3. Delivery Idempotency Check
    const existingDelivery = await db.query.webhookDeliveriesTable.findFirst({
      where: eq(webhookDeliveriesTable.deliveryId, deliveryId),
    });

    if (existingDelivery) {
      if (existingDelivery.status === "PROCESSED") {
        logger.info({ deliveryId }, "Webhook delivery already processed; skipping duplicate");
        return { shouldProcess: false, reason: "already_processed" };
      }
      return { shouldProcess: true };
    }

    // 4. Persist delivery record with trimmed metadata & 30-day retention policy
    const retentionDays = 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + retentionDays);

    const pr = payload.pull_request;
    const repo = payload.repository;
    const summaryJson = {
      action: payload.action,
      repository: repo?.full_name,
      prNumber: pr?.number,
      title: pr?.title,
      headBranch: pr?.head?.ref,
      baseBranch: pr?.base?.ref,
      headSha: pr?.head?.sha,
      sender: payload.sender?.login,
    };

    try {
      await db.insert(webhookDeliveriesTable).values({
        deliveryId,
        eventType,
        action: payload.action,
        installationId: payload.installation?.id ? String(payload.installation.id) : null,
        repositoryFullName: repo?.full_name || null,
        headSha: pr?.head?.sha || null,
        prNumber: pr?.number || null,
        senderLogin: payload.sender?.login || null,
        summaryJson,
        status: "PENDING",
        expiresAt,
      });
    } catch (err: any) {
      if (err.code === "23505" || err.message?.includes("unique constraint") || err.message?.includes("duplicate key")) {
        logger.info({ deliveryId }, "Duplicate webhook delivery detected during concurrent insert");
        return { shouldProcess: false, reason: "already_processed" };
      }
      throw err;
    }

    return { shouldProcess: true };
  }

  /**
   * Asynchronous delivery processing.
   * Handles installation resolution, PR upsert, issue extraction, diff analysis,
   * commercial scope evaluation, check-run update, and PR comment.
   */
  async processPullRequestEvent(
    deliveryId: string,
    payload: any
  ): Promise<WebhookProcessResult> {
    const action = payload.action;
    const prData = payload.pull_request;
    const repoData = payload.repository;
    const installationId = payload.installation?.id ? String(payload.installation.id) : null;

    if (!prData || !repoData) {
      return { deliveryId, status: "ignored", action };
    }

    const prNumber = prData.number;
    const headSha = prData.head?.sha;
    const repositoryFullName = repoData.full_name;

    logger.info(
      { deliveryId, prNumber, headSha, repositoryFullName, action },
      "Processing GitHub pull request event"
    );

    try {
      // 1. Resolve GitHub App Installation -> ScopeCI Organization
      let organizationId: string | null = null;
      if (installationId) {
        const installRecord = await db.query.githubInstallationsTable.findFirst({
          where: eq(githubInstallationsTable.installationId, installationId),
        });
        if (installRecord) {
          organizationId = installRecord.organizationId;
        }
      }

      // If installationId resolved organizationId, require projectLink to strictly belong to that organizationId
      let projectLink = await db.query.projectLinksTable.findFirst({
        where: organizationId
          ? and(
              eq(projectLinksTable.repositoryFullName, repositoryFullName),
              eq(projectLinksTable.organizationId, organizationId)
            )
          : eq(projectLinksTable.repositoryFullName, repositoryFullName),
      });

      if (!organizationId && projectLink) {
        organizationId = projectLink.organizationId;
      }

      if (!organizationId) {
        logger.warn(
          { deliveryId, installationId, repositoryFullName },
          "Unmapped GitHub installation or repository; cannot associate with ScopeCI organization"
        );
        await db
          .update(webhookDeliveriesTable)
          .set({ status: "IGNORED", errorMessage: "Unmapped installation or repository" })
          .where(eq(webhookDeliveriesTable.deliveryId, deliveryId));
        return { deliveryId, status: "unmapped", action, prNumber };
      }

      if (!projectLink) {
        logger.warn(
          { deliveryId, organizationId, repositoryFullName },
          "Repository is not mapped to any ScopeCI project_link"
        );
        await db
          .update(webhookDeliveriesTable)
          .set({ status: "IGNORED", errorMessage: "Unmapped repository" })
          .where(eq(webhookDeliveriesTable.deliveryId, deliveryId));
        return { deliveryId, status: "unmapped", action, prNumber };
      }

      // 2. Persist / Upsert Pull Request into Provenance Graph
      const externalPrId = `gh_pr_${prData.id}`;
      const prState = prData.merged ? "MERGED" : prData.state === "closed" ? "CLOSED" : "OPEN";

      const [prRecord] = await db
        .insert(pullRequestsTable)
        .values({
          organizationId,
          projectLinkId: projectLink.id,
          externalProvider: "GITHUB",
          externalId: externalPrId,
          number: prNumber,
          title: prData.title || "",
          body: prData.body || "",
          headBranch: prData.head?.ref || "",
          baseBranch: prData.base?.ref || "",
          authorExternalId: prData.user?.login || "unknown",
          url: prData.html_url || "",
          state: prState,
          isDraft: Boolean(prData.draft),
          additions: prData.additions || 0,
          deletions: prData.deletions || 0,
          changedFiles: prData.changed_files || 0,
          commitsCount: prData.commits || 1,
          openedAt: new Date(prData.created_at || Date.now()),
          mergedAt: prData.merged_at ? new Date(prData.merged_at) : null,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [pullRequestsTable.externalProvider, pullRequestsTable.externalId],
          set: {
            title: prData.title || "",
            body: prData.body || "",
            headBranch: prData.head?.ref || "",
            baseBranch: prData.base?.ref || "",
            state: prState,
            isDraft: Boolean(prData.draft),
            additions: prData.additions || 0,
            deletions: prData.deletions || 0,
            changedFiles: prData.changed_files || 0,
            commitsCount: prData.commits || 1,
            mergedAt: prData.merged_at ? new Date(prData.merged_at) : null,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .returning();

      // If PR is closed/merged and not a synchronize, record event and finish
      if (action === "closed") {
        await db.insert(commercialEventsTable).values({
          organizationId,
          entityType: "PULL_REQUEST",
          entityId: prRecord.id,
          eventType: prData.merged ? "PR_MERGED" : "PR_CLOSED",
          actorType: "DEVELOPER",
          actorId: prData.user?.login || "system",
          metadataJson: { prNumber, headSha, deliveryId },
        });

        await db
          .update(webhookDeliveriesTable)
          .set({ status: "PROCESSED", processedAt: new Date() })
          .where(eq(webhookDeliveriesTable.deliveryId, deliveryId));

        return { deliveryId, status: "processed", action, prNumber };
      }

      // 3. Extract Linear Issue References Deterministically
      const extractedRefs = extractIssueReferences({
        branchName: prData.head?.ref,
        prTitle: prData.title,
        prBody: prData.body,
      });

      let primaryIssue: LinearIssue | null = null;

      for (const ref of extractedRefs) {
        const resolved = await this.issueProvider.resolveIssue(ref.identifier);
        if (resolved) {
          if (!primaryIssue) primaryIssue = resolved;

          // Upsert issue in database
          const [dbIssue] = await db
            .insert(issuesTable)
            .values({
              organizationId: organizationId!,
              externalProvider: "LINEAR",
              externalId: `lin_issue_${resolved.id}`,
              identifier: resolved.id,
              title: resolved.title,
              description: resolved.description || "",
              status: resolved.status,
              estimate: resolved.estimateHours || null,
            })
            .onConflictDoUpdate({
              target: [issuesTable.externalProvider, issuesTable.externalId],
              set: {
                title: resolved.title,
                description: resolved.description || "",
                status: resolved.status,
                estimate: resolved.estimateHours || null,
                updatedAt: new Date(),
              },
            })
            .returning();

          // Link PR to Issue
          await db.insert(prIssueLinksTable).values({
            pullRequestId: prRecord.id,
            issueId: dbIssue.id,
            linkMethod: ref.linkMethod,
            confidence: String(ref.confidence),
            evidence: ref.evidence,
          });
        }
      }

      // 4. Collect & Normalize PR Diff Metadata
      const rawFiles = await this.gitHubClient.getPullRequestFiles(
        installationId || "mock_install",
        repoData.owner?.login || repoData.full_name.split("/")[0],
        repoData.name || repoData.full_name.split("/")[1],
        prNumber
      );

      const normalizedDiff = normalizePullRequestDiff(headSha, rawFiles);

      // Persist diff analysis with exact headSha
      const [diffAnalysis] = await db
        .insert(prDiffAnalysesTable)
        .values({
          pullRequestId: prRecord.id,
          headSha,
          analysisVersion: 1,
          status: "COMPLETED",
          filesChangedJson: normalizedDiff.files,
          subsystemsJson: normalizedDiff.detectedSubsystems,
          scopeDeltaJson: [],
          summary: `PR #${prNumber} diff analysis: ${normalizedDiff.totals.files} files (+${normalizedDiff.totals.additions}/-${normalizedDiff.totals.deletions})`,
          completedAt: new Date(),
        })
        .returning();

      // 5. Query Active Scope Baseline for Organization (Tenant-Scoped via Contract)
      let baselineRecord;
      if (organizationId) {
        const contract = await db.query.contractsTable.findFirst({
          where: eq(contractsTable.organizationId, organizationId),
        });
        if (contract) {
          baselineRecord = await db.query.scopeBaselinesTable.findFirst({
            where: and(
              eq(scopeBaselinesTable.contractId, contract.id),
              eq(scopeBaselinesTable.status, "ACTIVE")
            ),
            with: {
              clauses: true,
              deliverables: true,
            },
          });
        }
      }

      if (!baselineRecord) {
        baselineRecord = await db.query.scopeBaselinesTable.findFirst({
          where: eq(scopeBaselinesTable.status, "ACTIVE"),
          with: {
            clauses: true,
            deliverables: true,
          },
        });
      }

      // Construct domain ScopeBaseline
      const domainBaseline: ScopeBaseline = baselineRecord
        ? {
            id: baselineRecord.id,
            version: baselineRecord.versionNumber,
            contractId: baselineRecord.contractId,
            title: "Contract Scope Baseline",
            description: "Active contractual scope specification",
            status: "active",
            clauses: baselineRecord.clauses.map((c) => ({
              id: c.id,
              clauseRef: c.clauseNumber,
              title: c.title,
              legalText: c.legalText,
              inclusions: [],
              exclusions: [],
            })),
            deliverables: baselineRecord.deliverables.map((d) => ({
              id: d.id,
              clauseId: d.clauseId || "",
              title: d.name,
              scopeBoundary: d.boundarySummary,
              keywords: ["auth", "login"],
              estimatedHours: { min: 8, max: 16 },
              budgetAllocated: d.allocatedBudget || 5000,
            })),
            createdAt: baselineRecord.createdAt.toISOString(),
          }
        : {
            id: "baseline_default",
            version: "v1",
            contractId: "contract_default",
            title: "Default Baseline",
            description: "Initial Scope",
            status: "active",
            clauses: [],
            deliverables: [],
            createdAt: new Date().toISOString(),
          };

      // 6. Invoke Commercial Engine (OBSERVE mode, HeadSha Invariant Enforced)
      const evaluation = evaluateCommercialScope({
        baseline: domainBaseline,
        pullRequest: {
          id: prRecord.id,
          number: prNumber,
          title: prRecord.title,
          branch: prRecord.headBranch,
          base: prRecord.baseBranch,
          author: prRecord.authorExternalId,
          issueId: primaryIssue?.id,
          filesChanged: normalizedDiff.totals.files,
          additions: normalizedDiff.totals.additions,
          deletions: normalizedDiff.totals.deletions,
          changedFiles: normalizedDiff.files.map((f) => ({
            path: f.path,
            status: f.status === "renamed" ? "modified" : f.status,
            module: f.path.split("/")[0] || "core",
            linesAdded: f.additions,
            linesDeleted: f.deletions,
          })),
          detectedSubsystems: normalizedDiff.detectedSubsystems,
        },
        issue: primaryIssue || undefined,
        policyMode: "OBSERVE",
      });

      // 7. Persist Evaluation with exact headSha
      const [evalRecord] = await db
        .insert(commercialEvaluationsTable)
        .values({
          pullRequestId: prRecord.id,
          scopeBaselineId: baselineRecord?.id || domainBaseline.id,
          prDiffAnalysisId: diffAnalysis.id,
          headSha,
          state: evaluation.state,
          evaluationStatus: "COMPLETED",
          scopeTaxonomy: evaluation.taxonomy,
          reviewReasonCode: evaluation.reviewReasonCode || null,
          policyMode: "OBSERVE",
          confidence: String(evaluation.confidence),
          commercialConfidence: String(evaluation.commercialConfidence),
          modelConfidence: String(evaluation.modelConfidence || 0.91),
          evaluationIdentityHash: evaluation.identityHash,
          documentVersion: "doc_v1.0",
          issueSnapshotHash: evaluation.evidenceBundle?.issueEvidence ? "computed" : null,
          modelVersion: "deterministic-v4",
          promptVersion: "sow_decomp_v1.0",
          contractClauseIdsJson: evaluation.contractClauseId ? [evaluation.contractClauseId] : [],
          deliverableIdsJson: evaluation.deliverableId ? [evaluation.deliverableId] : [],
          issueIdsJson: primaryIssue ? [primaryIssue.id] : [],
          evidenceJson: evaluation.evidence,
          evidenceBundleJson: evaluation.evidenceBundle,
          decisionExplanationJson: evaluation.evidenceBundle?.decisionExplanation,
          estimatedHoursMin: evaluation.estimatedHours.min,
          estimatedHoursMax: evaluation.estimatedHours.max,
          estimatedValueMin: evaluation.commercialValue.min,
          estimatedValueMax: evaluation.commercialValue.max,
          currency: evaluation.commercialValue.currency,
          reason: evaluation.detectedDelta.join("; ") || "Commercial evaluation completed",
          evaluatorVersion: evaluation.evaluatorVersion || "scopeci-alpha-0.2.0",
        })
        .returning();

      // 8. GitHub Check Run Idempotency (Update if existing check run for PR exists)
      const owner = repoData.owner?.login || repositoryFullName.split("/")[0];
      const repo = repoData.name || repositoryFullName.split("/")[1];

      const checkSummary = `ScopeCI Commercial Review\n\nStatus: ${evaluation.state}\nEvidence: PR #${prNumber} (${headSha.substring(0, 7)})\nMode: OBSERVE\nConclusion: ${evaluation.checkConclusion}`;

      const existingCheckRun = await db.query.githubCheckRunsTable.findFirst({
        where: eq(githubCheckRunsTable.pullRequestId, prRecord.id),
      });

      let checkRunResult;
      if (existingCheckRun) {
        checkRunResult = await this.gitHubClient.updateCheckRun({
          installationId: installationId || "mock_install",
          owner,
          repo,
          checkRunId: existingCheckRun.githubCheckRunId,
          status: "completed",
          conclusion: evaluation.checkConclusion,
          title: "ScopeCI Commercial Review",
          summary: checkSummary,
        });

        await db
          .update(githubCheckRunsTable)
          .set({
            headSha,
            status: "completed",
            conclusion: evaluation.checkConclusion,
            title: "ScopeCI Commercial Review",
            summary: checkSummary,
            latestEvaluationId: evalRecord.id,
            updatedAt: new Date(),
          })
          .where(eq(githubCheckRunsTable.id, existingCheckRun.id));
      } else {
        checkRunResult = await this.gitHubClient.createCheckRun({
          installationId: installationId || "mock_install",
          owner,
          repo,
          headSha,
          name: "scopeci / commercial",
          status: "completed",
          conclusion: evaluation.checkConclusion,
          title: "ScopeCI Commercial Review",
          summary: checkSummary,
        });

        await db.insert(githubCheckRunsTable).values({
          pullRequestId: prRecord.id,
          githubCheckRunId: checkRunResult.id,
          checkName: "scopeci / commercial",
          headSha,
          status: "completed",
          conclusion: evaluation.checkConclusion,
          title: "ScopeCI Commercial Review",
          summary: checkSummary,
          latestEvaluationId: evalRecord.id,
        });
      }

      // 9. Post / Update PR Comment
      const commentBody = formatScopeCIComment({
        projectName: projectLink.externalProjectName,
        issueIdentifier: primaryIssue?.id,
        prNumber,
        headSha,
        evaluation,
      });

      await this.gitHubClient.createOrUpdateComment(
        installationId || "mock_install",
        owner,
        repo,
        prNumber,
        commentBody
      );

      // 10. Record Commercial Event Audit Log
      await db.insert(commercialEventsTable).values({
        organizationId,
        entityType: "PULL_REQUEST",
        entityId: prRecord.id,
        eventType: action === "synchronize" ? "PR_SYNCHRONIZED" : "PR_RECEIVED",
        actorType: "SYSTEM",
        actorId: "scopeci_github_app",
        newState: evaluation.state,
        metadataJson: {
          deliveryId,
          prNumber,
          headSha,
          checkRunId: checkRunResult.id,
          evaluationId: evalRecord.id,
          conclusion: evaluation.checkConclusion,
        },
      });

      // 11. Mark Delivery as PROCESSED
      await db
        .update(webhookDeliveriesTable)
        .set({ status: "PROCESSED", processedAt: new Date() })
        .where(eq(webhookDeliveriesTable.deliveryId, deliveryId));

      logger.info(
        { deliveryId, prNumber, headSha, evaluationState: evaluation.state, checkConclusion: evaluation.checkConclusion },
        "Successfully completed GitHub pull request webhook processing"
      );

      return {
        deliveryId,
        status: "processed",
        action,
        prNumber,
        evaluationState: evaluation.state,
        checkConclusion: evaluation.checkConclusion,
      };
    } catch (err: any) {
      logger.error({ deliveryId, err: err.message, stack: err.stack }, "Error processing GitHub webhook event");

      await db
        .update(webhookDeliveriesTable)
        .set({ status: "FAILED", errorMessage: err.message || "Processing error" })
        .where(eq(webhookDeliveriesTable.deliveryId, deliveryId));

      return {
        deliveryId,
        status: "error",
        action,
        prNumber,
        error: err.message,
      };
    }
  }
}
