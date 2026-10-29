import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
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
  scopeBaselinesTable,
} from "@workspace/db/schema";
import {
  AcceptPullRequestBody,
  AcceptPullRequestResponse,
  WithdrawPullRequestAcceptanceResponse,
  CreateProjectBody,
  CreateProjectResponse,
  GetProjectResponse,
  LinkProjectRepositoryBody,
  ListGitHubRepositoriesResponse,
  ListProjectPullRequestsResponse,
  ListArchivedProjectsResponse,
  ListProjectsResponse,
  RestoreProjectResponse,
  RecheckProjectResponse,
  SaveProjectScopeBody,
  SaveProjectScopeResponse,
  UpdateChangeOrderBody,
  UpdateChangeOrderResponse,
  UpdateProjectBody,
  UpdateProjectResponse,
  WithdrawPullRequestAcceptanceQueryParams,
} from "@workspace/api-zod";
import { composeChangeOrder, type ChangeOrderItem, type EvidenceBundle } from "@workspace/commercial-engine";
import { currentWebhookService } from "./github.js";
import { rateLimiter } from "../middlewares/rate-limit.js";
import { accountOf, requireAccount, sameOriginWrites, type Account } from "../lib/session.js";
import { checklistFromRecord, loadActiveBaseline, saveChecklist } from "../lib/scope-store.js";
import { GitHubReauthRequired, userGitHubToken } from "../lib/github-token.js";
import { installUrl, listInstallationRepositories, listUserInstallations } from "../github/user-api.js";
import { GitHubApiError } from "../github/github-http.js";
import { runInBackground } from "../lib/background.js";
import { ACCEPTED, WITHDRAWN, acceptanceFor, acceptancesFor, itemKey } from "../lib/acceptance.js";
import { changeOrderPlan, isDecided, itemsOf, letterHash, letterUntouched } from "../lib/change-orders.js";

/**
 * The signed-in app: projects, their confirmed scope, the repository each
 * one checks, and the results. Everything is scoped to the caller's
 * organization; another organization's project answers 404, not 403.
 */
const router: IRouter = Router();

router.use(["/projects", "/github/repositories"], sameOriginWrites, requireAccount);

const gitHubLimiter = rateLimiter({ windowMs: 60_000, max: 30, message: "Too many GitHub lookups. Wait a minute." });

/**
 * Checks the project's open pull requests again in the background, after
 * something that changes their verdict: a new scope version, a newly
 * connected repository, a different policy or an approved change order.
 */
function recheckLater(req: Request, projectId: string): void {
  runInBackground(
    new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => currentWebhookService())
      .then((service) => service?.recheckOpenPullRequests(projectId))
      .catch((err) => req.log.warn({ err, projectId }, "Re-checking open pull requests failed")),
  );
}

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

/** "A", "A and B", "A, B and C". */
function names(list: string[]): string {
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : (list[0] ?? "");
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
  if (!parsed.data.name.trim()) {
    res.status(400).json({ error: "Give the project a name." });
    return;
  }
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

router.get("/projects/archived", async (_req, res): Promise<void> => {
  const account = accountOf(res);
  const rows = await db.query.projectsTable.findMany({
    where: and(eq(projectsTable.organizationId, account.organizationId), isNotNull(projectsTable.archivedAt)),
    orderBy: [desc(projectsTable.archivedAt)],
    limit: 200,
  });
  const versions = await scopeVersions(rows.flatMap((r) => (r.contractId ? [r.contractId] : [])));
  const counts = await countsFor(rows.map((r) => r.id));
  res.json(
    ListArchivedProjectsResponse.parse({
      projects: rows.map((r) => toProject(r, r.contractId ? versions.get(r.contractId) : undefined, counts.get(r.id))),
    }),
  );
});

/** An archived project comes back with its scope, results and change orders; its repository is connected again by hand. */
router.post("/projects/:projectId/restore", async (req, res): Promise<void> => {
  const account = accountOf(res);
  const projectId = String(req.params.projectId);
  const [row] = UUID.test(projectId)
    ? await db
        .update(projectsTable)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(projectsTable.id, projectId),
            eq(projectsTable.organizationId, account.organizationId),
            isNotNull(projectsTable.archivedAt),
          ),
        )
        .returning()
    : [];
  if (!row) {
    res.status(404).json({ error: "No such archived project." });
    return;
  }
  res.json(RestoreProjectResponse.parse(await presentProject(row)));
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
  if (patch.name !== undefined && !patch.name.trim()) {
    res.status(400).json({ error: "Give the project a name." });
    return;
  }
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
  // A stricter or looser policy changes what the GitHub check says.
  if (patch.policyMode !== undefined && patch.policyMode !== project.policyMode) recheckLater(req, project.id);
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
  // Open pull requests are judged against the new version straight away.
  recheckLater(req, project.id);
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

/** GitHub refusing the person's token means the same as it having expired. */
function gitHubRefused(err: unknown): boolean {
  return err instanceof GitHubReauthRequired || (err instanceof GitHubApiError && err.status === 401);
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

  const repositories = [];
  // Accounts with more repositories than GitHub's list gives ScopeCI; the picker says so.
  const truncatedAccounts: string[] = [];
  try {
    const installations = (await listUserInstallations(token)).slice(0, 20);
    for (const installation of installations) {
      const list = await listInstallationRepositories(token, installation.id);
      if (list.truncated) truncatedAccounts.push(installation.accountLogin);
      for (const repo of list) {
        repositories.push({
          installationId: installation.id,
          accountLogin: installation.accountLogin,
          id: repo.id,
          fullName: repo.fullName,
          private: repo.private,
        });
      }
    }
  } catch (err) {
    if (gitHubRefused(err)) return reauth(res);
    throw err;
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
      truncatedAccounts,
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
  let installation: Awaited<ReturnType<typeof listUserInstallations>>[number] | undefined;
  let repo: Awaited<ReturnType<typeof listInstallationRepositories>>[number] | undefined;
  try {
    installation = (await listUserInstallations(token)).find((i) => i.id === parsed.data.installationId);
    repo = installation
      ? (await listInstallationRepositories(token, installation.id)).find((r) => r.id === parsed.data.repositoryId)
      : undefined;
  } catch (err) {
    if (gitHubRefused(err)) return reauth(res);
    throw err;
  }
  if (!installation || !repo) {
    res.status(403).json({ error: "You don't have access to that repository through the ScopeCI GitHub App." });
    return;
  }

  const installationId = String(installation.id);
  const existing = await db.query.githubInstallationsTable.findFirst({
    where: eq(githubInstallationsTable.installationId, installationId),
  });
  // A GitHub account feeds one workspace. It can move to this one only when
  // no project in its current workspace uses it, so a person who connected
  // it from the wrong workspace (say their personal one) can't lock their
  // agency out of its own repositories.
  if (existing && existing.organizationId !== account.organizationId) {
    const inUse = await db.query.projectsTable.findFirst({
      where: and(
        eq(projectsTable.organizationId, existing.organizationId),
        eq(projectsTable.githubInstallationId, installationId),
        isNull(projectsTable.archivedAt),
      ),
    });
    if (inUse) {
      res.status(409).json({
        error: `The GitHub account ${installation.accountLogin} feeds a project in another ScopeCI workspace. Disconnect it there first.`,
      });
      return;
    }
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
      .set({
        organizationId: account.organizationId,
        suspendedAt: null,
        permissionsJson: installation.permissions,
        updatedAt: new Date(),
      })
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
  // Pull requests already open on the repository get checked now, not on their next push.
  if (row.contractId) recheckLater(req, project.id);
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

  // The change order this pull request is on, raised now if it needs one.
  // Under a lock per contract, so two people pricing at once get one change
  // order, and references (CO-n, counted per contract) never repeat.
  const resultItems = (evaluation.changeOrderDraftJson as { items?: ChangeOrderItem[] } | null)?.items ?? [];
  const contractId = project.contractId;
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`change-orders:${contractId ?? pr.id}`}))`);
    // This project's change orders only: another project that once checked
    // the same pull request keeps its own.
    const orders = await tx.query.changeOrdersTable.findMany({
      where: and(eq(changeOrdersTable.pullRequestId, pr.id), eq(changeOrdersTable.projectId, project.id)),
      orderBy: [changeOrdersTable.createdAt],
    });
    const plan = changeOrderPlan(orders, resultItems);
    // An open change order stands whichever result the page showed.
    if (plan.current && !isDecided(plan.current.status)) return plan.current;
    // Anything else follows from this result, so it has to be the pull
    // request's latest: one from before a push would leave the new work off
    // the change order and its letter.
    const latest = await tx.query.commercialEvaluationsTable.findFirst({
      where: eq(commercialEvaluationsTable.pullRequestId, pr.id),
      orderBy: [desc(commercialEvaluationsTable.createdAt)],
      columns: { id: true },
    });
    if (latest?.id !== evaluation.id) return "stale" as const;
    if (plan.current) return plan.current;
    if (plan.fresh.length === 0 || !contractId) return null;
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(changeOrdersTable)
      .where(eq(changeOrdersTable.contractId, contractId));
    const message = compose(plan.fresh, null);
    const [created] = await tx
      .insert(changeOrdersTable)
      .values({
        organizationId: project.organizationId,
        contractId,
        sourceBaselineId: evaluation.scopeBaselineId,
        reference: `CO-${count + 1}`,
        title: plan.fresh.map((i) => i.item).join(", ").slice(0, 255),
        description: `Raised by pull request #${pr.number}: ${pr.title}`,
        estimatedHoursMin: 0,
        estimatedHoursMax: 0,
        estimatedValueMin: 0,
        estimatedValueMax: 0,
        currency: project.currency,
        status: "DRAFT",
        projectId: project.id,
        pullRequestId: pr.id,
        itemsJson: plan.fresh,
        messageSubject: message.subject,
        messageBody: message.body,
        letterHash: letterHash(message.subject, message.body),
      })
      .returning();
    return created;
  });
  if (row === "stale") {
    res.status(409).json({
      error: "This pull request was checked again since the page loaded. Reload to see its latest result, then try again.",
    });
    return;
  }
  if (!row) {
    res.status(409).json({ error: "This pull request has no out-of-scope work to raise a change order for." });
    return;
  }

  const decided = isDecided(row.status);
  if (decided && (input.status !== undefined || input.hours !== undefined)) {
    res.status(409).json({ error: `${row.reference} was already ${row.status === "APPROVED" ? "approved" : "declined"}.` });
    return;
  }

  // Once sent, the letter is what the client received: it no longer changes,
  // though hours can still be recorded against it.
  const sent = row.status !== "DRAFT";
  if (sent && (input.subject !== undefined || input.body !== undefined)) {
    res.status(409).json({ error: `${row.reference} was already sent; its letter is kept as sent.` });
    return;
  }
  const items = itemsOf(row);

  // Nothing is sent or approved that the PM hasn't seen: a push since the
  // page loaded may have changed the items, and the letter may not name them.
  if ((input.status === "SENT" || input.status === "APPROVED") && input.items !== undefined) {
    const seen = new Set(input.items.map(itemKey));
    const listed = new Set(items.map((i) => itemKey(i.item)));
    if (seen.size !== listed.size || [...listed].some((key) => !seen.has(key))) {
      const added = items.filter((i) => !seen.has(itemKey(i.item))).map((i) => i.item);
      res.status(409).json({
        error: added.length
          ? `${row.reference} now also lists ${names(added)}. Review the letter, then try again.`
          : `${row.reference} now lists ${names(items.map((i) => i.item)) || "nothing"}. Review the letter, then try again.`,
      });
      return;
    }
  }

  const hours = input.hours !== undefined ? input.hours || null : row.hours;
  let subject = row.messageSubject ?? "";
  let body = row.messageBody ?? "";
  let hash = row.letterHash;
  // New hours redraw ScopeCI's own letter with the new price. A letter the
  // PM edited is theirs: it is kept as they wrote it.
  if (
    input.hours !== undefined &&
    !sent &&
    input.subject === undefined &&
    input.body === undefined &&
    letterUntouched(row, () => compose(items, row.hours))
  ) {
    ({ subject, body } = compose(items, hours));
    hash = letterHash(subject, body);
  }
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
      letterHash: hash,
      status: nextStatus,
      ...(nextStatus === "SENT" && !row.sentAt ? { sentAt: now } : {}),
      ...(nextStatus === "APPROVED" ? { approvedAt: now } : {}),
      ...(nextStatus === "REJECTED" ? { rejectedAt: now } : {}),
      updatedAt: now,
    })
    // Only if nobody changed its status meanwhile (two people deciding at once).
    .where(and(eq(changeOrdersTable.id, row.id), eq(changeOrdersTable.status, row.status)))
    .returning();
  if (!updated) {
    res.status(409).json({ error: `${row.reference} was changed by someone else just now. Reload to see it.` });
    return;
  }

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
    // Check again now, so GitHub reflects the approval without waiting for
    // another push: this pull request first, then the project's other open
    // ones, since the approved work is covered on them too.
    runInBackground(
      new Promise<void>((resolve) => setImmediate(resolve))
        .then(() => currentWebhookService())
        .then(async (service) => {
          await service?.reevaluatePullRequest(pr.id);
          await service?.recheckOpenPullRequests(project.id, [pr.number]);
        })
        .catch((err) => req.log.warn({ err, pullRequestId: pr.id }, "Re-check after change order approval failed")),
    );
  }

  res.json(UpdateChangeOrderResponse.parse(toTracked(updated)));
});

/* ------------------------------------------------------------------ */
/* Accepting a flagged pull request                                    */
/* ------------------------------------------------------------------ */

/**
 * A project's pull request by number. A project that moved to another
 * repository keeps the old one's results, so numbers can repeat. The result
 * the page showed (`evaluationId`) names the exact one; without it, the
 * connected repository's pull request wins, then the most recent.
 */
async function projectPullRequest(req: Request, res: Response, project: ProjectRow, evaluationId?: string) {
  const number = Number(req.params.number);
  const valid = Number.isInteger(number) && number > 0;
  let pr: typeof pullRequestsTable.$inferSelect | undefined;
  if (evaluationId !== undefined) {
    const evaluation = valid && UUID.test(evaluationId)
      ? await db.query.commercialEvaluationsTable.findFirst({
          where: eq(commercialEvaluationsTable.id, evaluationId),
          columns: { pullRequestId: true },
        })
      : undefined;
    pr = evaluation
      ? await db.query.pullRequestsTable.findFirst({
          where: and(
            eq(pullRequestsTable.id, evaluation.pullRequestId),
            eq(pullRequestsTable.projectId, project.id),
            eq(pullRequestsTable.number, number),
          ),
        })
      : undefined;
  } else {
    const rows = valid
      ? await db.query.pullRequestsTable.findMany({
          where: and(eq(pullRequestsTable.projectId, project.id), eq(pullRequestsTable.number, number)),
          orderBy: [desc(pullRequestsTable.updatedAt)],
        })
      : [];
    const repo = project.repositoryFullName?.toLowerCase();
    pr = (repo && rows.find((r) => r.url.toLowerCase().includes(`/${repo}/pull/`))) || rows[0];
  }
  if (!pr) res.status(404).json({ error: "No such pull request in this project." });
  return pr;
}

/** Where an acceptance applies: this project, in its workspace. */
const scopeOf = (project: ProjectRow) => ({ organizationId: project.organizationId, projectId: project.id });

/**
 * Checks a pull request again now, so GitHub and the results show the
 * decision. Says whether that happened; a failure is logged, not thrown, as
 * the decision itself is already recorded.
 */
async function recheckNow(req: Request, pullRequestId: string): Promise<boolean> {
  try {
    const result = await (await currentWebhookService())?.reevaluatePullRequest(pullRequestId);
    if (result?.status === "processed" || result?.status === "already_processed") return true;
    req.log.warn({ pullRequestId, status: result?.status, error: result?.error }, "Re-check after an acceptance change didn't update the check");
  } catch (err) {
    req.log.warn({ err, pullRequestId }, "Re-check after an acceptance change failed");
  }
  return false;
}

router.put("/projects/:projectId/pull-requests/:number/acceptance", async (req, res): Promise<void> => {
  const parsed = AcceptPullRequestBody.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const reason = parsed.data.reason.trim();
  if (!reason) {
    res.status(400).json({ error: "Say why it's accepted; the reason is kept with the decision." });
    return;
  }
  const project = await withProject(req, res);
  if (!project) return;
  const { evaluationId } = parsed.data;
  const pr = await projectPullRequest(req, res, project, evaluationId);
  if (!pr) return;

  const latest = await db.query.commercialEvaluationsTable.findFirst({
    where: eq(commercialEvaluationsTable.pullRequestId, pr.id),
    orderBy: [desc(commercialEvaluationsTable.createdAt)],
  });
  // What the PM accepts is the result they saw, not one that came after.
  if (evaluationId !== undefined && latest?.id !== evaluationId) {
    res.status(409).json({
      error: "The page is out of date: this pull request was checked again since it loaded. Reload to see its latest result, then try again.",
    });
    return;
  }
  if (!latest || (latest.state !== "CHANGE_REQUIRED" && latest.state !== "REVIEW_REQUIRED")) {
    res.status(409).json({ error: "Its latest result isn't flagged, so there is nothing to accept." });
    return;
  }

  const account = accountOf(res);
  const items = ((latest.changeOrderDraftJson as { items?: ChangeOrderItem[] } | null)?.items ?? []).map((i) => i.item);
  const [event] = await db
    .insert(commercialEventsTable)
    .values({
      organizationId: project.organizationId,
      entityType: "PULL_REQUEST",
      entityId: pr.id,
      eventType: ACCEPTED,
      actorType: "PM",
      actorId: account.login,
      previousState: latest.state,
      newState: "OVERRIDDEN",
      reason: reason.slice(0, 500),
      metadataJson: { reason: reason.slice(0, 500), items, headSha: latest.headSha, projectId: project.id },
    })
    .returning();
  const checkUpdated = await recheckNow(req, pr.id);
  res.json(
    AcceptPullRequestResponse.parse({ reason: reason.slice(0, 500), acceptedBy: account.login, acceptedAt: event.occurredAt, checkUpdated }),
  );
});

router.delete("/projects/:projectId/pull-requests/:number/acceptance", async (req, res): Promise<void> => {
  const query = WithdrawPullRequestAcceptanceQueryParams.safeParse(req.query);
  if (!query.success) return badRequest(res, query.error);
  const project = await withProject(req, res);
  if (!project) return;
  const pr = await projectPullRequest(req, res, project, query.data.evaluationId);
  if (!pr) return;
  if (!(await acceptanceFor(pr.id, scopeOf(project)))) {
    res.status(404).json({ error: "This pull request isn't accepted." });
    return;
  }
  const account = accountOf(res);
  await db.insert(commercialEventsTable).values({
    organizationId: project.organizationId,
    entityType: "PULL_REQUEST",
    entityId: pr.id,
    eventType: WITHDRAWN,
    actorType: "PM",
    actorId: account.login,
    metadataJson: { projectId: project.id },
  });
  const checkUpdated = await recheckNow(req, pr.id);
  res.json(WithdrawPullRequestAcceptanceResponse.parse({ checkUpdated }));
});

/* ------------------------------------------------------------------ */
/* Re-check                                                            */
/* ------------------------------------------------------------------ */

router.post("/projects/:projectId/recheck", gitHubLimiter, async (req, res): Promise<void> => {
  const project = await withProject(req, res);
  if (!project) return;
  if (!project.repositoryExternalId || !project.githubInstallationId) {
    res.status(409).json({ error: "Connect a repository first." });
    return;
  }
  if (!project.contractId) {
    res.status(409).json({ error: "Confirm the scope first; pull requests are checked against it." });
    return;
  }
  recheckLater(req, project.id);
  res.status(202).json(RecheckProjectResponse.parse({ started: true }));
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
  // Only the latest result per pull request; earlier ones stay for the record.
  const evaluations = prs.length
    ? await db
        .selectDistinctOn([commercialEvaluationsTable.pullRequestId])
        .from(commercialEvaluationsTable)
        .where(inArray(commercialEvaluationsTable.pullRequestId, prs.map((p) => p.id)))
        .orderBy(commercialEvaluationsTable.pullRequestId, desc(commercialEvaluationsTable.createdAt))
    : [];
  const latest = new Map(evaluations.map((e) => [e.pullRequestId, e]));
  const baselineIds = [...new Set(evaluations.flatMap((e) => (e.scopeBaselineId ? [e.scopeBaselineId] : [])))];
  const versionOf = new Map(
    baselineIds.length
      ? (
          await db
            .select({ id: scopeBaselinesTable.id, version: scopeBaselinesTable.versionNumber })
            .from(scopeBaselinesTable)
            .where(inArray(scopeBaselinesTable.id, baselineIds))
        ).map((b) => [b.id, b.version])
      : [],
  );
  // Each pull request's change orders in this project, oldest first.
  const tracked = prs.length
    ? await db.query.changeOrdersTable.findMany({
        where: and(
          inArray(
            changeOrdersTable.pullRequestId,
            prs.map((p) => p.id),
          ),
          eq(changeOrdersTable.projectId, project.id),
        ),
        orderBy: [changeOrdersTable.createdAt],
      })
    : [];
  const ordersBy = new Map<string, typeof tracked>();
  for (const t of tracked) {
    if (!t.pullRequestId) continue;
    ordersBy.set(t.pullRequestId, [...(ordersBy.get(t.pullRequestId) ?? []), t]);
  }
  // A follow-up change order's letter names only the new work, so the
  // contract's name is needed to write it.
  const contract = tracked.length && project.contractId
    ? await db.query.contractsTable.findFirst({ where: eq(contractsTable.id, project.contractId) })
    : undefined;
  const accepted = await acceptancesFor(prs.map((p) => p.id), scopeOf(project));
  // The file list each latest result read, and no other.
  const diffIds = evaluations.flatMap((e) => (e.prDiffAnalysisId ? [e.prDiffAnalysisId] : []));
  const diffs = new Map(
    diffIds.length
      ? (
          await db
            .select({ id: prDiffAnalysesTable.id, files: prDiffAnalysesTable.filesChangedJson })
            .from(prDiffAnalysesTable)
            .where(inArray(prDiffAnalysesTable.id, diffIds))
        ).map((d) => [d.id, d.files])
      : [],
  );

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
    // Excluded work no decided change order lists gets one of its own; the
    // decided one is shown for reference, and the suggested letter names
    // only the new work.
    const plan = changeOrderPlan(ordersBy.get(pr.id) ?? [], (draft?.items ?? []) as ChangeOrderItem[]);
    let suggested = draft?.subject && draft.body ? { subject: draft.subject, body: draft.body } : null;
    if (suggested && !plan.current && plan.previous) {
      const letter = composeChangeOrder({
        items: plan.fresh,
        pullRequestTitle: pr.title,
        projectName: contract?.name || project.name,
        clientName: project.clientName ?? undefined,
        hourlyRate: project.hourlyRate ?? undefined,
      });
      suggested = { subject: letter.subject, body: letter.body };
    }
    const acceptance = accepted.get(pr.id);
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
        changeOrder: suggested,
        trackedChangeOrder: plan.current ? toTracked(plan.current) : null,
        previousChangeOrder: plan.previous ? toTracked(plan.previous) : null,
        newItems: plan.current ? [] : plan.fresh.map((i) => i.item),
        acceptance: acceptance
          ? { reason: acceptance.reason, acceptedBy: acceptance.acceptedBy, acceptedAt: acceptance.acceptedAt }
          : null,
        excluded,
        ...changedFiles(
          e.prDiffAnalysisId ? diffs.get(e.prDiffAnalysisId) : undefined,
          e.evidenceBundleJson as Partial<EvidenceBundle> | null,
          draft?.items ?? [],
        ),
        scopeVersion: e.scopeBaselineId ? (versionOf.get(e.scopeBaselineId) ?? null) : null,
        checkedAt: e.createdAt,
      },
    ];
  });

  res.setHeader("Cache-Control", "no-store");
  res.json(ListProjectPullRequestsResponse.parse({ pullRequests }));
});

export default router;
