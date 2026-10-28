import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  changeOrdersTable,
  commercialEvaluationsTable,
  commercialEventsTable,
  contractsTable,
  githubInstallationsTable,
  prDiffAnalysesTable,
  projectsTable,
  pullRequestsTable,
} from "@workspace/db/schema";
import {
  CreateProjectBody,
  CreateProjectResponse,
  GetProjectResponse,
  LinkProjectRepositoryBody,
  ListGitHubRepositoriesResponse,
  ListProjectPullRequestsResponse,
  ListProjectsResponse,
  SaveProjectScopeBody,
  SaveProjectScopeResponse,
  UpdateChangeOrderBody,
  UpdateChangeOrderResponse,
  UpdateProjectBody,
  UpdateProjectResponse,
} from "@workspace/api-zod";
import { composeChangeOrder, type ChangeOrderItem, type EvidenceBundle } from "@workspace/commercial-engine";
import { currentWebhookService } from "./github.js";
import { rateLimiter } from "../middlewares/rate-limit.js";
import { accountOf, requireAccount, sameOriginWrites, type Account } from "../lib/session.js";
import { checklistFromRecord, loadActiveBaseline, saveChecklist } from "../lib/scope-store.js";
import { GitHubReauthRequired, userGitHubToken } from "../lib/github-token.js";
import { installUrl, listInstallationRepositories, listUserInstallations } from "../github/user-api.js";

/**
 * The signed-in app: projects, their confirmed scope, the repository each
 * one checks, and the results. Everything is scoped to the caller's
 * organization; another organization's project answers 404, not 403.
 */
const router: IRouter = Router();

router.use(["/projects", "/github/repositories"], sameOriginWrites, requireAccount);

const gitHubLimiter = rateLimiter({ windowMs: 60_000, max: 30, message: "Too many GitHub lookups. Wait a minute." });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ProjectRow = typeof projectsTable.$inferSelect;
type ChangeOrderRow = typeof changeOrdersTable.$inferSelect;
type Counts = {
  checked: number;
  changeOrders: number;
  decisions: number;
  changeOrdersSent: number;
  changeOrdersApproved: number;
  approvedValue: number;
};
const noCounts = (): Counts => ({
  checked: 0,
  changeOrders: 0,
  decisions: 0,
  changeOrdersSent: 0,
  changeOrdersApproved: 0,
  approvedValue: 0,
});

function badRequest(res: Response, error: { issues: Array<{ path: PropertyKey[]; message: string }> }): void {
  const [issue] = error.issues;
  res.status(400).json({ error: `Check ${issue?.path.join(".") || "the request"}: ${issue?.message ?? "invalid"}.` });
}

async function findProject(account: Account, projectId: string): Promise<ProjectRow | null> {
  if (!UUID.test(projectId)) return null;
  const row = await db.query.projectsTable.findFirst({
    where: and(
      eq(projectsTable.id, projectId),
      eq(projectsTable.organizationId, account.organizationId),
      isNull(projectsTable.archivedAt),
    ),
  });
  return row ?? null;
}

async function withProject(req: Request, res: Response): Promise<ProjectRow | null> {
  const project = await findProject(accountOf(res), String(req.params.projectId));
  if (!project) res.status(404).json({ error: "No such project." });
  return project;
}

/** Counts from the latest result of each pull request, and from tracked change orders. */
async function countsFor(projectIds: string[]): Promise<Map<string, Counts>> {
  const counts = new Map<string, Counts>(projectIds.map((id) => [id, noCounts()]));
  if (projectIds.length === 0) return counts;
  const rows = await db.execute<{ project_id: string; state: string }>(sql`
    select distinct on (pr.id) pr.project_id, e.state
    from ${pullRequestsTable} pr
    join ${commercialEvaluationsTable} e on e.pull_request_id = pr.id
    where pr.project_id in (${sql.join(projectIds.map((id) => sql`${id}::uuid`), sql`, `)})
    order by pr.id, e.created_at desc
  `);
  for (const row of rows.rows) {
    const c = counts.get(row.project_id);
    if (!c) continue;
    c.checked++;
    if (row.state === "CHANGE_REQUIRED") c.changeOrders++;
    if (row.state === "REVIEW_REQUIRED") c.decisions++;
  }

  const orders = await db
    .select({ projectId: changeOrdersTable.projectId, status: changeOrdersTable.status, value: changeOrdersTable.estimatedValueMax })
    .from(changeOrdersTable)
    .where(inArray(changeOrdersTable.projectId, projectIds));
  for (const order of orders) {
    const c = order.projectId ? counts.get(order.projectId) : undefined;
    if (!c) continue;
    if (order.status === "SENT") c.changeOrdersSent++;
    if (order.status === "APPROVED") {
      c.changeOrdersApproved++;
      c.approvedValue += order.value;
    }
  }
  return counts;
}

const STATUS_OUT: Record<string, "DRAFT" | "SENT" | "APPROVED" | "DECLINED"> = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  APPROVED: "APPROVED",
  REJECTED: "DECLINED",
};

function toTracked(row: ChangeOrderRow) {
  const items = (row.itemsJson as ChangeOrderItem[] | null) ?? [];
  return {
    id: row.id,
    reference: row.reference,
    status: STATUS_OUT[row.status] ?? "DRAFT",
    items: items.map((i) => i.item),
    hours: row.hours,
    amount: row.hours && row.estimatedValueMax > 0 ? row.estimatedValueMax : null,
    currency: row.currency,
    subject: row.messageSubject ?? row.title,
    body: row.messageBody ?? row.description,
    sentAt: row.sentAt,
    decidedAt: row.approvedAt ?? row.rejectedAt,
  };
}

/** The most files a result lists; fileCount still says how many there are. */
const MAX_FILES = 200;
const FILE_STATUSES = new Set(["added", "modified", "deleted", "renamed"]);

/**
 * The changed files behind one result, by name and line count only: the
 * stored diff may carry patches, which never leave the server. A file the
 * check cited for an excluded item carries that item and comes first.
 */
function changedFiles(
  diff: unknown,
  bundle: Partial<EvidenceBundle> | null,
  items: ReadonlyArray<{ item?: string; capability?: string }>,
) {
  const rows = Array.isArray(diff) ? (diff as Array<Record<string, unknown>>) : [];
  const files = rows.flatMap((f) =>
    typeof f.path === "string"
      ? [{
          path: f.path,
          status: (FILE_STATUSES.has(String(f.status)) ? f.status : "modified") as "added" | "modified" | "deleted" | "renamed",
          additions: Number(f.additions) || 0,
          deletions: Number(f.deletions) || 0,
          excludedItem: null as string | null,
        }]
      : [],
  );
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const { item, capability: name } of items) {
    const capability = bundle?.detectedCapabilities?.find((c) => c.name === name);
    if (!item || !capability) continue;
    // Contract-phrase matches list up to four cited places ("a, b and 3 more");
    // other capabilities point at one. Only exact file paths count.
    const cited =
      capability.extractionMethod === "CONTRACT_PHRASE_MATCH"
        ? capability.evidenceText.replace(/ and \d+ more$/, "").split(", ")
        : [capability.evidenceLocation];
    for (const path of cited) {
      const file = byPath.get(path);
      if (file && !file.excludedItem) file.excludedItem = item;
    }
  }
  const ordered = [...files.filter((f) => f.excludedItem), ...files.filter((f) => !f.excludedItem)];
  return { files: ordered.slice(0, MAX_FILES), fileCount: files.length };
}

async function scopeVersions(contractIds: string[]) {
  const versions = new Map<string, { version: string; savedAt: Date }>();
  for (const contractId of contractIds) {
    const baseline = await loadActiveBaseline(contractId);
    if (baseline) versions.set(contractId, { version: baseline.versionNumber, savedAt: baseline.createdAt });
  }
  return versions;
}

function toProject(row: ProjectRow, scope: { version: string; savedAt: Date } | undefined, counts: Counts | undefined) {
  return {
    id: row.id,
    name: row.name,
    clientName: row.clientName,
    hourlyRate: row.hourlyRate,
    currency: row.currency,
    policyMode: row.policyMode as "OBSERVE" | "REVIEW" | "ENFORCE",
    repository:
      row.repositoryFullName && row.githubInstallationId
        ? { fullName: row.repositoryFullName, installationId: row.githubInstallationId }
        : null,
    scopeVersion: scope?.version ?? null,
    scopeSavedAt: scope?.savedAt ?? null,
    createdAt: row.createdAt,
    counts: counts ?? noCounts(),
  };
}

async function presentProject(row: ProjectRow) {
  const versions = row.contractId ? await scopeVersions([row.contractId]) : new Map();
  const counts = await countsFor([row.id]);
  return toProject(row, row.contractId ? versions.get(row.contractId) : undefined, counts.get(row.id));
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

router.get("/projects", async (_req, res): Promise<void> => {
  const account = accountOf(res);
  const rows = await db.query.projectsTable.findMany({
    where: and(eq(projectsTable.organizationId, account.organizationId), isNull(projectsTable.archivedAt)),
    orderBy: [desc(projectsTable.createdAt)],
    limit: 200,
  });
  const versions = await scopeVersions(rows.flatMap((r) => (r.contractId ? [r.contractId] : [])));
  const counts = await countsFor(rows.map((r) => r.id));
  res.json(
    ListProjectsResponse.parse({
      projects: rows.map((r) => toProject(r, r.contractId ? versions.get(r.contractId) : undefined, counts.get(r.id))),
    }),
  );
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const account = accountOf(res);
  const [row] = await db
    .insert(projectsTable)
    .values({
      organizationId: account.organizationId,
      name: parsed.data.name.trim(),
      clientName: parsed.data.clientName?.trim() || null,
      hourlyRate: parsed.data.hourlyRate ?? null,
      createdByUserId: account.userId,
    })
    .returning();
  res.status(201).json(CreateProjectResponse.parse(toProject(row, undefined, undefined)));
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const project = await withProject(req, res);
  if (!project) return;
  const baseline = project.contractId ? await loadActiveBaseline(project.contractId) : undefined;
  const counts = await countsFor([project.id]);
  res.json(
    GetProjectResponse.parse({
      project: toProject(
        project,
        baseline ? { version: baseline.versionNumber, savedAt: baseline.createdAt } : undefined,
        counts.get(project.id),
      ),
      scope: baseline
        ? { version: baseline.versionNumber, savedAt: baseline.createdAt, ...checklistFromRecord(baseline) }
        : null,
    }),
  );
});

router.patch("/projects/:projectId", async (req, res): Promise<void> => {
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const project = await withProject(req, res);
  if (!project) return;
  const patch = parsed.data;
  const [row] = await db
    .update(projectsTable)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.clientName !== undefined ? { clientName: patch.clientName?.trim() || null } : {}),
      ...(patch.hourlyRate !== undefined ? { hourlyRate: patch.hourlyRate } : {}),
      ...(patch.policyMode !== undefined ? { policyMode: patch.policyMode } : {}),
      updatedAt: new Date(),
    })
    .where(eq(projectsTable.id, project.id))
    .returning();
  res.json(UpdateProjectResponse.parse(await presentProject(row)));
});

router.delete("/projects/:projectId", async (req, res): Promise<void> => {
  const project = await withProject(req, res);
  if (!project) return;
  // Archiving frees the repository so pull requests stop being checked.
  await db
    .update(projectsTable)
    .set({
      archivedAt: new Date(),
      githubInstallationId: null,
      repositoryExternalId: null,
      repositoryFullName: null,
      updatedAt: new Date(),
    })
    .where(eq(projectsTable.id, project.id));
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

router.put("/projects/:projectId/scope", async (req, res): Promise<void> => {
  const parsed = SaveProjectScopeBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const project = await withProject(req, res);
  if (!project) return;

  const itemCount = parsed.data.clauses.reduce((n, c) => n + c.included.length + c.excluded.length, 0);
  if (itemCount === 0) {
    res.status(400).json({ error: "Add at least one included or excluded item before saving." });
    return;
  }

  const account = accountOf(res);
  const saved = await saveChecklist(project, parsed.data, account.login);
  const baseline = await loadActiveBaseline((await findProject(account, project.id))!.contractId!);
  res.json(
    SaveProjectScopeResponse.parse({
      version: saved.version,
      savedAt: saved.savedAt,
      ...checklistFromRecord(baseline!),
    }),
  );
});

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

function reauth(res: Response): void {
  res.status(401).json({ error: "GitHub access expired. Sign in again to see your repositories." });
}

router.get("/github/repositories", gitHubLimiter, async (_req, res): Promise<void> => {
  const account = accountOf(res);
  let token: string;
  try {
    token = await userGitHubToken(account.userId);
  } catch (err) {
    if (err instanceof GitHubReauthRequired) return reauth(res);
    throw err;
  }

  const installations = (await listUserInstallations(token)).slice(0, 20);
  const repositories = [];
  for (const installation of installations) {
    for (const repo of await listInstallationRepositories(token, installation.id)) {
      repositories.push({
        installationId: installation.id,
        accountLogin: installation.accountLogin,
        id: repo.id,
        fullName: repo.fullName,
        private: repo.private,
      });
    }
  }

  const linked = repositories.length
    ? await db
        .select({ id: projectsTable.id, repo: projectsTable.repositoryExternalId })
        .from(projectsTable)
        .where(
          and(
            eq(projectsTable.organizationId, account.organizationId),
            inArray(
              projectsTable.repositoryExternalId,
              repositories.map((r) => String(r.id)),
            ),
          ),
        )
    : [];
  const linkedBy = new Map(linked.map((l) => [l.repo, l.id]));

  res.setHeader("Cache-Control", "no-store");
  res.json(
    ListGitHubRepositoriesResponse.parse({
      installUrl: await installUrl(),
      repositories: repositories.map((r) => ({ ...r, linkedProjectId: linkedBy.get(String(r.id)) ?? null })),
    }),
  );
});

router.put("/projects/:projectId/repository", gitHubLimiter, async (req, res): Promise<void> => {
  const parsed = LinkProjectRepositoryBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const project = await withProject(req, res);
  if (!project) return;
  const account = accountOf(res);

  let token: string;
  try {
    token = await userGitHubToken(account.userId);
  } catch (err) {
    if (err instanceof GitHubReauthRequired) return reauth(res);
    throw err;
  }

  // Ask GitHub, as this person, whether they can see the installation and
  // the repository. Nothing the browser sends is trusted on its own.
  const installation = (await listUserInstallations(token)).find((i) => i.id === parsed.data.installationId);
  const repo = installation
    ? (await listInstallationRepositories(token, installation.id)).find((r) => r.id === parsed.data.repositoryId)
    : undefined;
  if (!installation || !repo) {
    res.status(403).json({ error: "You don't have access to that repository through the ScopeCI GitHub App." });
    return;
  }

  const installationId = String(installation.id);
  const existing = await db.query.githubInstallationsTable.findFirst({
    where: eq(githubInstallationsTable.installationId, installationId),
  });
  if (existing && existing.organizationId !== account.organizationId) {
    res.status(409).json({ error: `The GitHub account ${installation.accountLogin} is already connected to another ScopeCI workspace.` });
    return;
  }

  const takenBy = await db.query.projectsTable.findFirst({
    where: and(eq(projectsTable.repositoryExternalId, String(repo.id)), ne(projectsTable.id, project.id)),
  });
  if (takenBy) {
    res.status(409).json({
      error:
        takenBy.organizationId === account.organizationId
          ? `${repo.fullName} already feeds the project "${takenBy.name}". Disconnect it there first.`
          : `${repo.fullName} is already connected to another ScopeCI workspace.`,
    });
    return;
  }

  if (existing) {
    await db
      .update(githubInstallationsTable)
      .set({ suspendedAt: null, permissionsJson: installation.permissions, updatedAt: new Date() })
      .where(eq(githubInstallationsTable.id, existing.id));
  } else {
    await db.insert(githubInstallationsTable).values({
      installationId,
      organizationId: account.organizationId,
      githubAccountId: String(installation.accountId),
      githubAccountLogin: installation.accountLogin,
      githubAccountType: installation.accountType,
      permissionsJson: installation.permissions,
      repositorySelection: installation.repositorySelection,
      installedBy: account.login,
    });
  }

  const [row] = await db
    .update(projectsTable)
    .set({
      githubInstallationId: installationId,
      repositoryExternalId: String(repo.id),
      repositoryFullName: repo.fullName,
      updatedAt: new Date(),
    })
    .where(eq(projectsTable.id, project.id))
    .returning();
  res.json(UpdateProjectResponse.parse(await presentProject(row)));
});

router.delete("/projects/:projectId/repository", async (req, res): Promise<void> => {
  const project = await withProject(req, res);
  if (!project) return;
  const [row] = await db
    .update(projectsTable)
    .set({ githubInstallationId: null, repositoryExternalId: null, repositoryFullName: null, updatedAt: new Date() })
    .where(eq(projectsTable.id, project.id))
    .returning();
  res.json(UpdateProjectResponse.parse(await presentProject(row)));
});

/* ------------------------------------------------------------------ */
/* Change orders                                                       */
/* ------------------------------------------------------------------ */

router.put("/projects/:projectId/change-order", async (req, res): Promise<void> => {
  const parsed = UpdateChangeOrderBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const project = await withProject(req, res);
  if (!project) return;
  const account = accountOf(res);
  const input = parsed.data;

  const evaluation = UUID.test(input.evaluationId)
    ? await db.query.commercialEvaluationsTable.findFirst({
        where: eq(commercialEvaluationsTable.id, input.evaluationId),
      })
    : undefined;
  const pr = evaluation
    ? await db.query.pullRequestsTable.findFirst({
        where: and(eq(pullRequestsTable.id, evaluation.pullRequestId), eq(pullRequestsTable.projectId, project.id)),
      })
    : undefined;
  if (!evaluation || !pr) {
    res.status(404).json({ error: "No such result in this project." });
    return;
  }

  const contract = project.contractId
    ? await db.query.contractsTable.findFirst({ where: eq(contractsTable.id, project.contractId) })
    : undefined;
  const compose = (items: ChangeOrderItem[], hours: number | null) =>
    composeChangeOrder({
      items,
      pullRequestTitle: pr.title,
      // The client reads this: name the contract they signed.
      projectName: contract?.name || project.name,
      clientName: project.clientName ?? undefined,
      hours: hours ?? undefined,
      hourlyRate: project.hourlyRate ?? undefined,
    });

  let row = await db.query.changeOrdersTable.findFirst({ where: eq(changeOrdersTable.pullRequestId, pr.id) });
  if (!row) {
    const items = (evaluation.changeOrderDraftJson as { items?: ChangeOrderItem[] } | null)?.items ?? [];
    if (items.length === 0 || !project.contractId) {
      res.status(409).json({ error: "This pull request has no out-of-scope work to raise a change order for." });
      return;
    }
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(changeOrdersTable)
      .where(eq(changeOrdersTable.contractId, project.contractId));
    const message = compose(items, null);
    [row] = await db
      .insert(changeOrdersTable)
      .values({
        organizationId: project.organizationId,
        contractId: project.contractId,
        sourceBaselineId: evaluation.scopeBaselineId,
        reference: `CO-${count + 1}`,
        title: items.map((i) => i.item).join(", ").slice(0, 255),
        description: `Raised by pull request #${pr.number}: ${pr.title}`,
        estimatedHoursMin: 0,
        estimatedHoursMax: 0,
        estimatedValueMin: 0,
        estimatedValueMax: 0,
        currency: project.currency,
        status: "DRAFT",
        projectId: project.id,
        pullRequestId: pr.id,
        itemsJson: items,
        messageSubject: message.subject,
        messageBody: message.body,
      })
      .returning();
  }

  const decided = row.status === "APPROVED" || row.status === "REJECTED";
  if (decided && (input.status !== undefined || input.hours !== undefined)) {
    res.status(409).json({ error: `${row.reference} was already ${row.status === "APPROVED" ? "approved" : "declined"}.` });
    return;
  }

  const items = (row.itemsJson as ChangeOrderItem[] | null) ?? [];
  const hours = input.hours !== undefined ? input.hours || null : row.hours;
  let subject = row.messageSubject ?? "";
  let body = row.messageBody ?? "";
  if (input.hours !== undefined) ({ subject, body } = compose(items, hours));
  if (input.subject !== undefined) subject = input.subject;
  if (input.body !== undefined) body = input.body;
  const value = hours && project.hourlyRate ? hours * project.hourlyRate : 0;

  const now = new Date();
  const nextStatus =
    input.status === "SENT" ? "SENT" : input.status === "APPROVED" ? "APPROVED" : input.status === "DECLINED" ? "REJECTED" : row.status;
  const [updated] = await db
    .update(changeOrdersTable)
    .set({
      hours,
      estimatedHoursMin: hours ?? 0,
      estimatedHoursMax: hours ?? 0,
      estimatedValueMin: value,
      estimatedValueMax: value,
      messageSubject: subject,
      messageBody: body,
      status: nextStatus,
      ...(nextStatus === "SENT" && !row.sentAt ? { sentAt: now } : {}),
      ...(nextStatus === "APPROVED" ? { approvedAt: now } : {}),
      ...(nextStatus === "REJECTED" ? { rejectedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(changeOrdersTable.id, row.id))
    .returning();

  if (nextStatus !== row.status) {
    await db.insert(commercialEventsTable).values({
      organizationId: project.organizationId,
      entityType: "CHANGE_ORDER",
      entityId: row.id,
      eventType: `CHANGE_ORDER_${STATUS_OUT[nextStatus]}`,
      actorType: "PM",
      actorId: account.login,
      previousState: row.status,
      newState: nextStatus,
      metadataJson: { reference: row.reference, pullRequestId: pr.id, hours, value },
    });
  }

  if (nextStatus === "APPROVED" && row.status !== "APPROVED") {
    // Check the pull request again now, so the GitHub check reflects the
    // approval without waiting for another push.
    setImmediate(() => {
      currentWebhookService()
        .then((service) => service?.reevaluatePullRequest(pr.id))
        .catch((err) => {
          req.log.warn({ err, pullRequestId: pr.id }, "Re-check after change order approval failed");
        });
    });
  }

  res.json(UpdateChangeOrderResponse.parse(toTracked(updated)));
});

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

router.get("/projects/:projectId/pull-requests", async (req, res): Promise<void> => {
  const project = await withProject(req, res);
  if (!project) return;

  const prs = await db.query.pullRequestsTable.findMany({
    where: eq(pullRequestsTable.projectId, project.id),
    orderBy: [desc(pullRequestsTable.updatedAt)],
    limit: 100,
  });
  const evaluations = prs.length
    ? await db.query.commercialEvaluationsTable.findMany({
        where: inArray(
          commercialEvaluationsTable.pullRequestId,
          prs.map((p) => p.id),
        ),
        orderBy: [desc(commercialEvaluationsTable.createdAt)],
      })
    : [];
  const latest = new Map<string, (typeof evaluations)[number]>();
  for (const e of evaluations) if (!latest.has(e.pullRequestId)) latest.set(e.pullRequestId, e);
  const tracked = prs.length
    ? await db.query.changeOrdersTable.findMany({
        where: inArray(
          changeOrdersTable.pullRequestId,
          prs.map((p) => p.id),
        ),
      })
    : [];
  const trackedBy = new Map(tracked.map((t) => [t.pullRequestId, t]));
  // The file list the check read for each result's commit.
  const diffs = prs.length
    ? await db
        .select({
          pullRequestId: prDiffAnalysesTable.pullRequestId,
          headSha: prDiffAnalysesTable.headSha,
          files: prDiffAnalysesTable.filesChangedJson,
        })
        .from(prDiffAnalysesTable)
        .where(inArray(prDiffAnalysesTable.pullRequestId, prs.map((p) => p.id)))
        .orderBy(desc(prDiffAnalysesTable.createdAt))
    : [];
  const diffFor = (pullRequestId: string, headSha: string | null) =>
    diffs.find((d) => d.pullRequestId === pullRequestId && d.headSha === headSha)?.files;

  const pullRequests = prs.flatMap((pr) => {
    const e = latest.get(pr.id);
    if (!e) return [];
    const draft = e.changeOrderDraftJson as {
      subject?: string;
      body?: string;
      items?: Array<{ item?: string; clauseRef?: string; clauseTitle?: string; capability?: string }>;
    } | null;
    // The draft keeps each excluded item with its clause; drafts saved before
    // items were stored simply have none.
    const excluded = (draft?.items ?? []).flatMap((i) =>
      i.item && i.clauseRef ? [{ item: i.item, clauseRef: i.clauseRef, clauseTitle: i.clauseTitle ?? "" }] : [],
    );
    return [
      {
        evaluationId: e.id,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        branch: pr.headBranch || null,
        prState: pr.state as "OPEN" | "CLOSED" | "MERGED",
        headSha: e.headSha,
        verdict: e.state,
        reason:
          (e.decisionExplanationJson as { reason?: string } | null)?.reason ?? e.reason,
        estimate: e.estimateSummary,
        changeOrder: draft?.subject && draft.body ? { subject: draft.subject, body: draft.body } : null,
        trackedChangeOrder: trackedBy.has(pr.id) ? toTracked(trackedBy.get(pr.id)!) : null,
        excluded,
        ...changedFiles(
          diffFor(pr.id, e.headSha),
          e.evidenceBundleJson as Partial<EvidenceBundle> | null,
          draft?.items ?? [],
        ),
        checkedAt: e.createdAt,
      },
    ];
  });

  res.setHeader("Cache-Control", "no-store");
  res.json(ListProjectPullRequestsResponse.parse({ pullRequests }));
});

export default router;
