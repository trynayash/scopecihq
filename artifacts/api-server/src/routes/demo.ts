import { Router, type IRouter } from "express";
import {
  SOWDecomposer,
  SOWDecompositionError,
  baselineFromChecklist,
  checklistFromBaseline,
  describeEstimate,
  draftChangeOrder,
  evaluateCommercialScope,
  pullRequestAsWorkItem,
  type ChangedFile,
  type LinearIssue,
  type PullRequest,
  type ScopeChecklist,
} from "@workspace/commercial-engine";
import {
  EvaluateDemoBody,
  EvaluateDemoResponse,
  GetDemoGithubPrQueryParams,
  GetDemoGithubPrResponse,
  ParseDemoSowBody,
  ParseDemoSowResponse,
} from "@workspace/api-zod";
import { rateLimiter } from "../middlewares/rate-limit.js";
import { formatScopeCIComment } from "../github/comment-formatter.js";

/**
 * The public "try it with your SOW" demo. It runs the real parser and
 * evaluator on whatever the visitor pastes and stores nothing.
 */
const router: IRouter = Router();

const sowLimiter = rateLimiter({ windowMs: 60_000, max: 20, message: "Too many documents at once. Wait a minute." });
const evaluateLimiter = rateLimiter({ windowMs: 60_000, max: 40, message: "Too many checks at once. Wait a minute." });
const gitHubLimiter = rateLimiter({ windowMs: 60_000, max: 10, message: "Too many GitHub lookups. Wait a minute." });

/** The same limits the request schema enforces, so a parsed scope can always be sent back. */
const LIMITS = { clauses: 60, items: 100, title: 200, item: 300, ref: 40 };

function clampChecklist(checklist: ScopeChecklist): ScopeChecklist {
  const items = (list: string[]) => list.slice(0, LIMITS.items).map((item) => item.slice(0, LIMITS.item));
  return {
    title: checklist.title.slice(0, LIMITS.title),
    clauses: checklist.clauses.slice(0, LIMITS.clauses).map((clause) => ({
      clauseRef: clause.clauseRef.slice(0, LIMITS.ref),
      title: clause.title.slice(0, LIMITS.title),
      included: items(clause.included),
      excluded: items(clause.excluded),
    })),
  };
}

router.post("/demo/sow", sowLimiter, (req, res): void => {
  const parsed = ParseDemoSowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Paste a statement of work of up to 40,000 characters." });
    return;
  }

  try {
    const { baseline, warnings } = new SOWDecomposer().decompose(parsed.data.markdown);
    res.json(ParseDemoSowResponse.parse({ ...clampChecklist(checklistFromBaseline(baseline)), warnings }));
  } catch (error) {
    if (error instanceof SOWDecompositionError) {
      res.status(400).json({
        error: "We couldn't find any scope in that text. Paste the sections that say what's included and what's excluded.",
      });
      return;
    }
    throw error;
  }
});

router.post("/demo/evaluate", evaluateLimiter, (req, res): void => {
  const parsed = EvaluateDemoBody.safeParse(req.body);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    res.status(400).json({ error: `Check ${issue?.path.join(".") || "the request"}: ${issue?.message ?? "invalid"}.` });
    return;
  }

  const { scope, pullRequest: pr, issue, estimateHours, hourlyRate, projectName } = parsed.data;
  const baseline = baselineFromChecklist(scope);
  const pullRequest: PullRequest = {
    id: "demo_pr",
    number: pr.number ?? 1,
    title: pr.title,
    body: pr.body ?? undefined,
    branch: pr.branch ?? undefined,
    filesChanged: pr.files.length,
    additions: 0,
    deletions: 0,
    changedFiles: pr.files.map(
      (file): ChangedFile => ({
        path: file.path.trim(),
        status: file.status ?? "modified",
        module: file.path.trim().split("/")[0] || "root",
      }),
    ),
  };

  // Without a linked issue the PR itself is the work item: nothing extra is
  // read, and the effort is whatever the visitor typed in.
  const linkedIssue: LinearIssue = issue
    ? {
        id: issue.id,
        title: issue.title,
        description: issue.description ?? undefined,
        status: "Open",
        estimateHours: issue.estimateHours ?? undefined,
      }
    : pullRequestAsWorkItem(estimateHours ?? undefined);

  // A rate of 0 means none given: the demo never prices work at a made-up rate.
  const rate = hourlyRate && hourlyRate > 0 ? hourlyRate : 0;
  const evaluation = evaluateCommercialScope({
    baseline,
    pullRequest,
    issue: linkedIssue,
    policyMode: "REVIEW",
    hourlyRate: rate,
  });

  // Without an issue the hours are the visitor's own, so say so.
  const wording = (text: string) =>
    issue
      ? text
      : text
          .replace("(no linked issue with an estimate)", "(enter the hours to price it)")
          .replace("from the hours given for this pull request", "from the hours you entered")
          .replace("at the configured hourly rate", "at the rate you entered")
          .replace("no hourly rate is configured", "no hourly rate was entered");
  const estimate = describeEstimate(evaluation);
  const clause = baseline.clauses.find((c) => c.id === evaluation.contractClauseId);
  const changeOrder = draftChangeOrder({
    evaluation,
    pullRequestTitle: pr.title,
    projectName: projectName ?? scope.title,
    hourlyRate: rate || undefined,
  });

  res.json(
    EvaluateDemoResponse.parse({
      state: evaluation.state,
      taxonomy: evaluation.taxonomy,
      checkConclusion: evaluation.checkConclusion,
      reason: evaluation.evidenceBundle.decisionExplanation.reason,
      delta: evaluation.detectedDelta,
      clause: clause ? { clauseRef: clause.clauseRef, title: clause.title } : null,
      estimate: estimate ? wording(estimate) : null,
      // The same comment a connected repository gets, so the demo shows the real thing.
      comment: wording(
        formatScopeCIComment({
          projectName: (projectName ?? scope.title) || "Your project",
          prNumber: pr.number ?? 1,
          evaluation,
        }),
      ),
      changeOrder: changeOrder ? { subject: changeOrder.subject, body: changeOrder.body } : null,
    }),
  );
});

/* ------------------------------------------------------------------ */
/* Public GitHub pull requests                                         */
/* ------------------------------------------------------------------ */

const PR_URL =
  /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})(?:[/?#].*)?$/;

type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;
let gitHubFetch: GitHubFetch = (url, init) => fetch(url, init);

/**
 * Anonymous GitHub API calls are limited to 60 an hour for the whole server,
 * so lookups are cached for ten minutes. Set GITHUB_TOKEN (a token with no
 * scopes is enough for public repositories) to raise the limit.
 */
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

/** Test hook: replaces the network call and clears the cache. */
export function setDemoGitHubFetch(fn: GitHubFetch): void {
  gitHubFetch = fn;
  cache.clear();
}

function fileStatus(status: unknown): "added" | "modified" | "deleted" | "renamed" {
  if (status === "added") return "added";
  if (status === "removed") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

router.get("/demo/github-pr", gitHubLimiter, async (req, res): Promise<void> => {
  const parsed = GetDemoGithubPrQueryParams.safeParse(req.query);
  const match = parsed.success ? parsed.data.url.trim().match(PR_URL) : null;
  if (!match) {
    res.status(400).json({ error: "Paste a pull request link like https://github.com/owner/repo/pull/123." });
    return;
  }

  const [, owner, repo, number] = match;
  const key = `${owner}/${repo}#${number}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.json(hit.data);
    return;
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ScopeCI",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const base = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;

  let prRes: Response;
  let filesRes: Response;
  try {
    [prRes, filesRes] = await Promise.all([
      gitHubFetch(base, { headers, signal: AbortSignal.timeout(8000) }),
      gitHubFetch(`${base}/files?per_page=100`, { headers, signal: AbortSignal.timeout(8000) }),
    ]);
  } catch (err) {
    req.log.warn({ err }, "GitHub lookup failed");
    res.status(502).json({ error: "GitHub didn't answer. Paste the file list instead." });
    return;
  }

  if (prRes.status === 404 || filesRes.status === 404) {
    res.status(404).json({ error: "That pull request doesn't exist or isn't public." });
    return;
  }
  if ([403, 429].includes(prRes.status) || [403, 429].includes(filesRes.status)) {
    res.status(502).json({ error: "GitHub's limit for anonymous lookups was reached. Paste the file list instead." });
    return;
  }
  if (!prRes.ok || !filesRes.ok) {
    res.status(502).json({ error: "GitHub didn't answer. Paste the file list instead." });
    return;
  }

  const pr = (await prRes.json()) as { number?: number; title?: string; body?: string | null; head?: { ref?: string } };
  const files = (await filesRes.json()) as Array<{ filename?: string; status?: string }>;
  const changedFiles = (Array.isArray(files) ? files : [])
    .filter((file) => typeof file.filename === "string" && file.filename.length > 0)
    .slice(0, 300)
    .map((file) => ({ path: String(file.filename).slice(0, 400), status: fileStatus(file.status) }));

  if (changedFiles.length === 0) {
    res.status(404).json({ error: "That pull request has no changed files." });
    return;
  }

  const data = GetDemoGithubPrResponse.parse({
    number: typeof pr.number === "number" ? pr.number : Number(number),
    title: String(pr.title || `Pull request #${number}`).slice(0, 300),
    branch: pr.head?.ref ? pr.head.ref.slice(0, 200) : null,
    body: typeof pr.body === "string" ? pr.body.slice(0, 5000) : null,
    files: changedFiles,
  });

  if (cache.size >= 200) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), data });
  res.json(data);
});

export default router;
