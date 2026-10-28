import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  changeOrdersTable,
  commercialEvaluationsTable,
  commercialEventsTable,
  githubCheckRunsTable,
  githubInstallationsTable,
  contractsTable,
  issuesTable,
  prDiffAnalysesTable,
  prIssueLinksTable,
  projectLinksTable,
  projectsTable,
  pullRequestsTable,
  webhookDeliveriesTable,
} from "@workspace/db/schema";
import {
  describeEstimate,
  composeChangeOrder,
  draftChangeOrder,
  evaluateCommercialScope,
  pullRequestAsWorkItem,
  type ChangeOrder,
  type ChangeOrderItem,
  type CommercialEvaluation,
  type LinearIssue,
} from "@workspace/commercial-engine";
import { type IGitHubClient } from "./github-client.js";
import { type IssueProvider } from "./issue-provider.js";
import { extractIssueReferences } from "./extractor.js";
import { normalizePullRequestDiff } from "./diff-collector.js";
import { VERDICT_LABELS, formatScopeCIComment } from "./comment-formatter.js";
import { logger } from "../lib/logger.js";
import { loadActiveBaseline, toDomainBaseline } from "../lib/scope-store.js";

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

/**
 * Whether a pull_request event changes anything the check reads: a new or
 * reopened pull request, new commits, leaving draft, or a new title,
 * description or base branch. "rechecked" is ScopeCI's own re-run.
 */
export function checksPullRequest(payload: any): boolean {
  switch (payload?.action) {
    case "opened":
    case "reopened":
    case "synchronize":
    case "ready_for_review":
    case "rechecked":
    case "closed":
      return true;
    case "edited": {
      const changes = payload.changes ?? {};
      return Boolean(changes.title || changes.body || changes.base);
    }
    default:
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

    if (eventType === "installation" || eventType === "installation_repositories") {
      await this.handleInstallationEvent(eventType, payload);
      return { shouldProcess: false, reason: "installation_updated" };
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
   * Keeps installation records in step with GitHub: an uninstalled or
   * suspended App stops checks, and a repository removed from the App is
   * disconnected from its project so the app shows it as unconnected.
   */
  async handleInstallationEvent(eventType: string, payload: any): Promise<void> {
    const installationId = payload.installation?.id ? String(payload.installation.id) : null;
    if (!installationId) return;
    const unlink = { githubInstallationId: null, repositoryExternalId: null, repositoryFullName: null, updatedAt: new Date() };

    if (eventType === "installation") {
      const action = payload.action;
      if (action === "deleted" || action === "suspend") {
        await db
          .update(githubInstallationsTable)
          .set({ suspendedAt: new Date(), updatedAt: new Date() })
          .where(eq(githubInstallationsTable.installationId, installationId));
      } else if (action === "unsuspend" || action === "new_permissions_accepted") {
        await db
          .update(githubInstallationsTable)
          .set({ suspendedAt: null, updatedAt: new Date() })
          .where(eq(githubInstallationsTable.installationId, installationId));
      }
      if (action === "deleted") {
        await db.update(projectsTable).set(unlink).where(eq(projectsTable.githubInstallationId, installationId));
      }
      return;
    }

    const removed = (payload.repositories_removed ?? []) as Array<{ id?: unknown }>;
    const ids = removed.flatMap((r) => (typeof r.id === "number" ? [String(r.id)] : []));
    if (ids.length > 0) {
      await db
        .update(projectsTable)
        .set(unlink)
        .where(and(eq(projectsTable.githubInstallationId, installationId), inArray(projectsTable.repositoryExternalId, ids)));
    }
  }

  /**
   * Checks a project's pull request again at the commit it was last checked
   * on, as if GitHub had sent the event again. Used when a change order is
   * approved, so the check and comment change straight away rather than on
   * the next push.
   */
  async reevaluatePullRequest(pullRequestId: string): Promise<WebhookProcessResult> {
    const deliveryId = `recheck_${crypto.randomUUID()}`;
    const pr = await db.query.pullRequestsTable.findFirst({ where: eq(pullRequestsTable.id, pullRequestId) });
    const project = pr?.projectId
      ? await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, pr.projectId) })
      : undefined;
    const latest = pr
      ? await db.query.commercialEvaluationsTable.findFirst({
          where: eq(commercialEvaluationsTable.pullRequestId, pr.id),
          orderBy: [desc(commercialEvaluationsTable.createdAt)],
        })
      : undefined;
    if (!pr || !project?.githubInstallationId || !project.repositoryFullName || !project.repositoryExternalId || !latest?.headSha) {
      return { deliveryId, status: "ignored" };
    }

    const [owner, name] = project.repositoryFullName.split("/");
    return this.processPullRequestEvent(deliveryId, {
      action: "rechecked",
      installation: { id: Number(project.githubInstallationId) },
      repository: { id: Number(project.repositoryExternalId), name, full_name: project.repositoryFullName, owner: { login: owner } },
      pull_request: {
        id: Number(pr.externalId.replace(/^gh_pr_/, "")),
        number: pr.number,
        title: pr.title,
        body: pr.body,
        head: { ref: pr.headBranch, sha: latest.headSha },
        base: { ref: pr.baseBranch },
        user: { login: pr.authorExternalId },
        state: pr.state === "OPEN" ? "open" : "closed",
        merged: pr.state === "MERGED",
        draft: pr.isDraft,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changedFiles,
        commits: pr.commitsCount,
        html_url: pr.url,
        created_at: pr.openedAt.toISOString(),
        merged_at: pr.mergedAt?.toISOString() ?? null,
      },
    });
  }

  /**
   * Checks the open pull requests on a project's repository again, as GitHub
   * has them now. Run after the scope is saved, the repository connected, the
   * policy changed or a change order approved, so pull requests opened before
   * the project was set up get a result and none stays judged against an
   * older scope. Newest first, at most 30, one at a time.
   */
  async recheckOpenPullRequests(projectId: string, skipNumbers: number[] = []): Promise<{ checked: number }> {
    const project = await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) });
    if (
      !project ||
      project.archivedAt ||
      !project.githubInstallationId ||
      !project.repositoryFullName ||
      !project.repositoryExternalId ||
      !this.gitHubClient.listOpenPullRequests
    ) {
      return { checked: 0 };
    }
    const [owner, name] = project.repositoryFullName.split("/");
    const open = await this.gitHubClient.listOpenPullRequests(project.githubInstallationId, owner, name, 30);
    let checked = 0;
    for (const pullRequest of open) {
      if (skipNumbers.includes(pullRequest.number)) continue;
      const result = await this.processPullRequestEvent(`recheck_${crypto.randomUUID()}`, {
        action: "rechecked",
        installation: { id: Number(project.githubInstallationId) },
        repository: { id: Number(project.repositoryExternalId), name, full_name: project.repositoryFullName, owner: { login: owner } },
        pull_request: pullRequest,
      });
      if (result.status === "processed") checked++;
    }
    return { checked };
  }

  /** The last piece of work queued for each pull request, keyed by repository and number. */
  private pullRequestQueues = new Map<string, Promise<unknown>>();

  /**
   * Handles one pull request event. Events for the same pull request run one
   * after another, never side by side: GitHub sends several at once when a
   * pull request is opened with reviewers and labels, and two checks running
   * together would each post their own comment and check run.
   */
  async processPullRequestEvent(deliveryId: string, payload: any): Promise<WebhookProcessResult> {
    const key = `${payload?.repository?.full_name}#${payload?.pull_request?.number}`;
    const previous = this.pullRequestQueues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.handlePullRequestEvent(deliveryId, payload));
    this.pullRequestQueues.set(key, run);
    try {
      return await run;
    } finally {
      if (this.pullRequestQueues.get(key) === run) this.pullRequestQueues.delete(key);
    }
  }

  /**
   * Asynchronous delivery processing.
   * Handles installation resolution, PR upsert, issue extraction, diff analysis,
   * commercial scope evaluation, check-run update, and PR comment.
   */
  private async handlePullRequestEvent(
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

    // Only events that change what the check reads start one. Labels,
    // assignees, review requests and the like leave the verdict as it is.
    if (!checksPullRequest(payload)) {
      await db
        .update(webhookDeliveriesTable)
        .set({ status: "IGNORED", errorMessage: `Nothing to check on "${action}"` })
        .where(eq(webhookDeliveriesTable.deliveryId, deliveryId));
      return { deliveryId, status: "ignored", action, prNumber: prData.number };
    }

    const prNumber = prData.number;
    const headSha = prData.head?.sha;
    const repositoryFullName = repoData.full_name;

    logger.info(
      { deliveryId, prNumber, headSha, repositoryFullName, action },
      "Processing GitHub pull request event"
    );

    // Set once the pull request is known to belong to a project, so a
    // failure can still be reported on it.
    let failureCheck: { installationId: string; owner: string; repo: string; detailsUrl?: string } | null = null;

    try {
      // 1. Resolve GitHub App Installation -> ScopeCI Organization
      let organizationId: string | null = null;
      if (installationId) {
        const installRecord = await db.query.githubInstallationsTable.findFirst({
          where: eq(githubInstallationsTable.installationId, installationId),
        });
        if (installRecord?.suspendedAt) {
          await db
            .update(webhookDeliveriesTable)
            .set({ status: "IGNORED", errorMessage: "Installation suspended" })
            .where(eq(webhookDeliveriesTable.deliveryId, deliveryId));
          return { deliveryId, status: "ignored", action, prNumber };
        }
        if (installRecord) {
          organizationId = installRecord.organizationId;
        }
      }

      // A project in the app owns the repository when the installation is
      // mapped; older setups map repositories through project links instead.
      const project = organizationId
        ? await db.query.projectsTable.findFirst({
            where: and(
              eq(projectsTable.organizationId, organizationId),
              eq(projectsTable.repositoryExternalId, String(repoData.id)),
              isNull(projectsTable.archivedAt),
            ),
          })
        : undefined;

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

      if (!projectLink && !project) {
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
          projectLinkId: projectLink?.id ?? null,
          projectId: project?.id ?? null,
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
            projectId: project?.id ?? null,
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
      // GitHub lists at most 3,000 files for a pull request.
      const reportedFiles = Number(prData.changed_files) || 0;
      const partialNote =
        reportedFiles > rawFiles.length
          ? `GitHub listed ${rawFiles.length.toLocaleString("en-US")} of this pull request's ${reportedFiles.toLocaleString("en-US")} changed files; the rest weren't checked.`
          : undefined;

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

      // 5. The scope to check against: the project's confirmed baseline, or
      // for older setups the organization's contract. Never another
      // organization's, and never a guess when there is none.
      const owner = repoData.owner?.login || repositoryFullName.split("/")[0];
      const repo = repoData.name || repositoryFullName.split("/")[1];
      const detailsUrl = project && process.env.APP_BASE_URL
        ? `${process.env.APP_BASE_URL.replace(/\/+$/, "")}/app/projects/${project.id}`
        : undefined;
      if (project && installationId && headSha) failureCheck = { installationId, owner, repo, detailsUrl };

      let baselineRecord: Awaited<ReturnType<typeof loadActiveBaseline>>;
      if (project) {
        baselineRecord = project.contractId ? await loadActiveBaseline(project.contractId) : undefined;
      } else {
        const contract = await db.query.contractsTable.findFirst({
          where: eq(contractsTable.organizationId, organizationId),
        });
        baselineRecord = contract ? await loadActiveBaseline(contract.id) : undefined;
      }

      if (!baselineRecord) {
        if (project && installationId) {
          // Connected but not set up: say so on the pull request rather than stay silent.
          await this.gitHubClient.createCheckRun({
            installationId,
            owner,
            repo,
            headSha,
            name: "scopeci / commercial",
            status: "completed",
            conclusion: "neutral",
            title: "ScopeCI: scope not confirmed yet",
            summary: `This repository feeds the ScopeCI project "${project.name}", but its scope hasn't been confirmed. Pull requests are checked once it is.`,
            detailsUrl,
          });
        }
        await db
          .update(webhookDeliveriesTable)
          .set({ status: "IGNORED", errorMessage: "No confirmed scope for this repository" })
          .where(eq(webhookDeliveriesTable.deliveryId, deliveryId));
        return { deliveryId, status: "ignored", action, prNumber };
      }

      const domainBaseline = toDomainBaseline(baselineRecord);
      const policyMode = (project?.policyMode ?? "OBSERVE") as CommercialEvaluation["policyMode"];

      // Work a client approved through a change order is covered from then on,
      // on this pull request and any later one.
      const approvedChangeOrders: ChangeOrder[] = project
        ? (
            await db
              .select()
              .from(changeOrdersTable)
              .where(and(eq(changeOrdersTable.projectId, project.id), eq(changeOrdersTable.status, "APPROVED")))
          ).map((row) => {
            const items = (row.itemsJson as ChangeOrderItem[] | null) ?? [];
            return {
              id: row.reference,
              contractId: row.contractId,
              baselineVersion: baselineRecord!.versionNumber,
              title: row.title,
              reason: row.description,
              authorizedSubsystems: items.flatMap((i) => [i.item, ...(i.capability ? [i.capability] : [])]),
              hours: { min: row.estimatedHoursMin, max: row.estimatedHoursMax },
              amount: row.estimatedValueMax,
              status: "APPROVED" as const,
              approvedAt: row.approvedAt?.toISOString(),
            };
          })
        : [];

      // 6. Invoke Commercial Engine (OBSERVE mode, HeadSha Invariant Enforced)
      const evaluation = evaluateCommercialScope({
        baseline: domainBaseline,
        pullRequest: {
          id: prRecord.id,
          number: prNumber,
          title: prRecord.title,
          // The description is read like the title, as on the /try demo.
          body: prRecord.body || undefined,
          headSha,
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
          // The path-fragment "subsystems" the diff collector guesses (any
          // path containing "org" or "token") are kept for the record but
          // not judged on: they flagged files like components/organisms as
          // organization roles. The check reads the paths themselves.
        },
        // A project's pull request is judged on its own when no issue is
        // linked; older Linear-mapped setups still ask for the link.
        issue: primaryIssue ?? (project ? pullRequestAsWorkItem() : undefined),
        approvedChangeOrders,
        policyMode,
        // A project prices work only at the rate it was given; older setups keep the default.
        ...(project ? { hourlyRate: project.hourlyRate ?? 0 } : {}),
      });

      const projectName = project?.name ?? projectLink?.externalProjectName ?? repositoryFullName;
      const changeOrder = draftChangeOrder({
        evaluation,
        pullRequestTitle: prRecord.title,
        // The client reads this: name the contract they signed, as the demo does.
        projectName: domainBaseline.title || projectName,
        clientName: project?.clientName ?? undefined,
        hourlyRate: project?.hourlyRate ?? undefined,
      });

      // 7. Persist Evaluation with exact headSha
      const [evalRecord] = await db
        .insert(commercialEvaluationsTable)
        .values({
          pullRequestId: prRecord.id,
          scopeBaselineId: baselineRecord.id,
          prDiffAnalysisId: diffAnalysis.id,
          headSha,
          state: evaluation.state,
          evaluationStatus: "COMPLETED",
          scopeTaxonomy: evaluation.taxonomy,
          reviewReasonCode: evaluation.reviewReasonCode || null,
          policyMode,
          confidence: String(evaluation.confidence),
          commercialConfidence: String(evaluation.commercialConfidence),
          // The evaluator is rule based; there is no model confidence to record.
          modelConfidence: evaluation.modelConfidence != null ? String(evaluation.modelConfidence) : null,
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
          estimateSummary: describeEstimate(evaluation) ?? null,
          changeOrderDraftJson: changeOrder
            ? { subject: changeOrder.subject, body: changeOrder.body, items: changeOrder.items }
            : null,
          evaluatorVersion: evaluation.evaluatorVersion || "scopeci-alpha-0.2.0",
        })
        .returning();

      // 7b. A change order still in draft follows the pull request: new
      // excluded work on a later push joins its items. The letter is redrawn
      // only if nobody edited it; an edited letter is the PM's to change.
      if (project && changeOrder && changeOrder.items.length > 0) {
        const draft = await db.query.changeOrdersTable.findFirst({
          where: and(eq(changeOrdersTable.pullRequestId, prRecord.id), eq(changeOrdersTable.status, "DRAFT")),
        });
        const oldItems = (draft?.itemsJson as ChangeOrderItem[] | null) ?? [];
        const key = (items: ChangeOrderItem[]) => items.map((i) => `${i.item}|${i.clauseRef ?? ""}`).sort().join("\n");
        if (draft && key(oldItems) !== key(changeOrder.items)) {
          const letterFor = (items: ChangeOrderItem[]) =>
            composeChangeOrder({
              items,
              pullRequestTitle: prRecord.title,
              projectName: domainBaseline.title || project.name,
              clientName: project.clientName ?? undefined,
              hours: draft.hours ?? undefined,
              hourlyRate: project.hourlyRate ?? undefined,
            });
          const before = letterFor(oldItems);
          const untouched = draft.messageSubject === before.subject && draft.messageBody === before.body;
          const after = untouched ? letterFor(changeOrder.items) : null;
          await db
            .update(changeOrdersTable)
            .set({
              itemsJson: changeOrder.items,
              title: changeOrder.items.map((i) => i.item).join(", ").slice(0, 255),
              ...(after ? { messageSubject: after.subject, messageBody: after.body } : {}),
              updatedAt: new Date(),
            })
            .where(eq(changeOrdersTable.id, draft.id));
        }
      }

      // 8. One check run per commit: GitHub attaches a check run to the SHA it
      // was created on, so a new push gets a new run and a redelivery for the
      // same commit updates the existing one.
      const checkTitle = `ScopeCI: ${VERDICT_LABELS[evaluation.state] ?? evaluation.state}`;
      const estimateLine = describeEstimate(evaluation);
      const checkSummary = [
        evaluation.evidenceBundle?.decisionExplanation?.reason ?? evaluation.detectedDelta.join("; "),
        partialNote ?? "",
        estimateLine ? `Estimated impact: ${estimateLine}.` : "",
        `Scope version ${baselineRecord.versionNumber}. Policy: ${policyMode}.`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const existingCheckRun = await db.query.githubCheckRunsTable.findFirst({
        where: and(
          eq(githubCheckRunsTable.pullRequestId, prRecord.id),
          eq(githubCheckRunsTable.headSha, headSha),
        ),
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
          title: checkTitle,
          summary: checkSummary,
          detailsUrl,
        });

        await db
          .update(githubCheckRunsTable)
          .set({
            headSha,
            status: "completed",
            conclusion: evaluation.checkConclusion,
            title: checkTitle,
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
          title: checkTitle,
          summary: checkSummary,
          detailsUrl,
        });

        await db.insert(githubCheckRunsTable).values({
          pullRequestId: prRecord.id,
          githubCheckRunId: checkRunResult.id,
          checkName: "scopeci / commercial",
          headSha,
          status: "completed",
          conclusion: evaluation.checkConclusion,
          title: checkTitle,
          summary: checkSummary,
          detailsUrl: detailsUrl ?? null,
          latestEvaluationId: evalRecord.id,
        });
      }

      // 9. Post / Update PR Comment
      const commentBody = formatScopeCIComment({
        projectName,
        issueIdentifier: primaryIssue?.id,
        prNumber,
        headSha,
        evaluation,
        detailsUrl,
        scopeVersion: baselineRecord.versionNumber,
        note: partialNote,
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

      // Say so on the pull request rather than leave it with no result. A
      // neutral check doesn't block a merge, even where the check is required.
      if (failureCheck) {
        try {
          await this.gitHubClient.createCheckRun({
            ...failureCheck,
            headSha,
            name: "scopeci / commercial",
            status: "completed",
            conclusion: "neutral",
            title: "ScopeCI couldn't check this commit",
            summary: "Something went wrong while checking this commit, so it has no verdict. Push again, or use Re-check on the pull request in ScopeCI.",
          });
        } catch (reportErr: any) {
          logger.warn({ deliveryId, err: reportErr.message }, "Couldn't report the failed check on the pull request");
        }
      }

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
