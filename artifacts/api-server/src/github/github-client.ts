import { COMMENT_MARKER } from "./comment-formatter.js";
import type { RawGitHubFile } from "./diff-collector.js";

export interface CreateCheckRunParams {
  installationId: string;
  owner: string;
  repo: string;
  headSha: string;
  name: string; // "scopeci / commercial"
  status: "queued" | "in_progress" | "completed";
  conclusion?: "neutral" | "success" | "failure" | "action_required";
  title: string;
  summary: string;
  detailsUrl?: string;
}

export interface UpdateCheckRunParams {
  installationId: string;
  owner: string;
  repo: string;
  checkRunId: string;
  status?: "queued" | "in_progress" | "completed";
  conclusion?: "neutral" | "success" | "failure" | "action_required";
  title?: string;
  summary?: string;
  detailsUrl?: string;
}

export interface CheckRunResult {
  id: string;
  headSha: string;
  status: string;
  conclusion?: string;
  htmlUrl?: string;
}

export interface CommentResult {
  id: string;
  body: string;
  action: "created" | "updated";
}

export interface IGitHubClient {
  createCheckRun(params: CreateCheckRunParams): Promise<CheckRunResult>;
  updateCheckRun(params: UpdateCheckRunParams): Promise<CheckRunResult>;
  createOrUpdateComment(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<CommentResult>;
  getPullRequestFiles(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<RawGitHubFile[]>;
}

/**
 * Mock implementation of GitHub API for tests and local development.
 * Allows simulating rate limits (429), server errors (500), and inspects state.
 */
export class MockGitHubClient implements IGitHubClient {
  public checkRuns: Map<string, CheckRunResult & { name: string; title: string; summary: string }> = new Map();
  public comments: Map<string, { id: string; prNumber: number; body: string }[]> = new Map();
  public prFiles: Map<string, RawGitHubFile[]> = new Map();
  public simulatedFailure: { code: number; message: string; retryAfter?: number } | null = null;
  public failureCountRemaining = 0;

  private checkRunCounter = 5000;
  private commentCounter = 8000;

  public setFilesForPR(owner: string, repo: string, prNumber: number, files: RawGitHubFile[]): void {
    const key = `${owner}/${repo}#${prNumber}`;
    this.prFiles.set(key, files);
  }

  public simulateFailureOnce(code: number, message: string, retryAfter?: number): void {
    this.simulatedFailure = { code, message, retryAfter };
    this.failureCountRemaining = 1;
  }

  public simulateFailure(code: number, message: string, count = 1): void {
    this.simulatedFailure = { code, message };
    this.failureCountRemaining = count;
  }

  private checkFailure(): void {
    if (this.simulatedFailure && this.failureCountRemaining > 0) {
      this.failureCountRemaining--;
      const err = new Error(this.simulatedFailure.message) as any;
      err.status = this.simulatedFailure.code;
      err.statusCode = this.simulatedFailure.code;
      if (this.simulatedFailure.retryAfter) {
        err.retryAfter = this.simulatedFailure.retryAfter;
      }
      throw err;
    }
  }

  async createCheckRun(params: CreateCheckRunParams): Promise<CheckRunResult> {
    this.checkFailure();
    const id = `check_${++this.checkRunCounter}`;
    const result = {
      id,
      headSha: params.headSha,
      name: params.name,
      status: params.status,
      conclusion: params.conclusion,
      title: params.title,
      summary: params.summary,
      htmlUrl: `https://github.com/${params.owner}/${params.repo}/runs/${id}`,
    };
    this.checkRuns.set(id, result);
    return {
      id,
      headSha: params.headSha,
      status: params.status,
      conclusion: params.conclusion,
      htmlUrl: result.htmlUrl,
    };
  }

  async updateCheckRun(params: UpdateCheckRunParams): Promise<CheckRunResult> {
    this.checkFailure();
    let existing = this.checkRuns.get(params.checkRunId);
    if (!existing) {
      existing = {
        id: params.checkRunId,
        headSha: "",
        name: "scopeci / commercial",
        status: params.status || "completed",
        conclusion: params.conclusion,
        title: params.title || "ScopeCI Commercial Review",
        summary: params.summary || "",
        htmlUrl: `https://github.com/${params.owner}/${params.repo}/runs/${params.checkRunId}`,
      };
      this.checkRuns.set(params.checkRunId, existing);
    }

    if (params.status) existing.status = params.status;
    if (params.conclusion) existing.conclusion = params.conclusion;
    if (params.title) existing.title = params.title;
    if (params.summary) existing.summary = params.summary;

    return {
      id: existing.id,
      headSha: existing.headSha,
      status: existing.status,
      conclusion: existing.conclusion,
      htmlUrl: existing.htmlUrl,
    };
  }

  async createOrUpdateComment(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<CommentResult> {
    this.checkFailure();
    const key = `${owner}/${repo}#${prNumber}`;
    const existingComments = this.comments.get(key) || [];

    const existingIndex = existingComments.findIndex((c) => c.body.includes(COMMENT_MARKER));
    if (existingIndex >= 0) {
      // Update existing comment without creating duplicates!
      const comment = existingComments[existingIndex];
      comment.body = body;
      return {
        id: comment.id,
        body: comment.body,
        action: "updated",
      };
    }

    // Create new comment
    const id = `comment_${++this.commentCounter}`;
    const newComment = { id, prNumber, body };
    existingComments.push(newComment);
    this.comments.set(key, existingComments);

    return {
      id,
      body,
      action: "created",
    };
  }

  async getPullRequestFiles(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<RawGitHubFile[]> {
    this.checkFailure();
    const key = `${owner}/${repo}#${prNumber}`;
    return this.prFiles.get(key) || [];
  }
}
