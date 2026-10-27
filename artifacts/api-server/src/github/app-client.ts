import crypto from "node:crypto";
import { COMMENT_MARKER } from "./comment-formatter.js";
import type { RawGitHubFile } from "./diff-collector.js";
import type {
  CheckRunResult,
  CommentResult,
  CreateCheckRunParams,
  IGitHubClient,
  UpdateCheckRunParams,
} from "./github-client.js";
import { API_HEADERS, GitHubApiError, gitHubApiUrl, gitHubRequest, nextPage } from "./github-http.js";

/**
 * The real GitHub App client: signs a JWT as the App, swaps it for a
 * short-lived installation token, and uses that to read pull request files,
 * post check runs and keep one ScopeCI comment per pull request up to date.
 */

/** PEM from an env var: accepts real newlines, "\n" escapes, or the whole file base64-encoded. */
export function normalisePrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("BEGIN")) return trimmed.replace(/\\n/g, "\n");
  return Buffer.from(trimmed, "base64").toString("utf8").trim();
}

/** An App JWT, valid for nine minutes and backdated one to absorb clock drift. */
export function createAppJwt(appId: string, privateKey: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId })}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  /** The App's slug, so only its own bot comment is ever edited. */
  slug?: string;
}

export function appConfigFromEnv(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const key = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !key) return null;
  return { appId, privateKey: normalisePrivateKey(key), slug: process.env.GITHUB_APP_SLUG || undefined };
}

const MAX_FILE_PAGES = 30; // GitHub lists at most 3,000 files per pull request
const MAX_COMMENT_PAGES = 10;

export class GitHubAppClient implements IGitHubClient {
  private tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private config: GitHubAppConfig) {}

  private async installationToken(installationId: string): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;

    const jwt = createAppJwt(this.config.appId, this.config.privateKey);
    const { data } = await gitHubRequest<{ token: string; expires_at: string }>(
      `${gitHubApiUrl()}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      { method: "POST", headers: { ...API_HEADERS, Authorization: `Bearer ${jwt}` } },
    );
    this.tokens.set(installationId, { token: data.token, expiresAt: Date.parse(data.expires_at) });
    return data.token;
  }

  private async api<T>(
    installationId: string,
    method: string,
    pathOrUrl: string,
    body?: unknown,
  ): Promise<{ data: T; headers: Headers }> {
    const token = await this.installationToken(installationId);
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${gitHubApiUrl()}${pathOrUrl}`;
    try {
      return await gitHubRequest<T>(url, {
        method,
        headers: {
          ...API_HEADERS,
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // A revoked or expired token: drop it so the next call mints a fresh one.
      if (err instanceof GitHubApiError && err.status === 401) this.tokens.delete(installationId);
      throw err;
    }
  }

  private repoPath(owner: string, repo: string): string {
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  }

  async getPullRequestFiles(installationId: string, owner: string, repo: string, prNumber: number): Promise<RawGitHubFile[]> {
    const files: RawGitHubFile[] = [];
    let next: string | undefined = `${this.repoPath(owner, repo)}/pulls/${prNumber}/files?per_page=100`;
    for (let page = 0; next && page < MAX_FILE_PAGES; page++) {
      const { data, headers }: { data: any[]; headers: Headers } = await this.api(installationId, "GET", next);
      for (const f of data) {
        files.push({
          filename: f.filename,
          status: f.status,
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          changes: f.changes,
          patch: f.patch,
          previous_filename: f.previous_filename,
        });
      }
      next = nextPage(headers);
    }
    return files;
  }

  private checkRunBody(params: Partial<CreateCheckRunParams>) {
    // GitHub refuses action_required without a link to act on.
    const conclusion =
      params.conclusion === "action_required" && !params.detailsUrl ? "neutral" : params.conclusion;
    return {
      ...(params.name ? { name: params.name } : {}),
      ...(params.headSha ? { head_sha: params.headSha } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.status === "completed" && conclusion ? { conclusion, completed_at: new Date().toISOString() } : {}),
      ...(params.detailsUrl ? { details_url: params.detailsUrl } : {}),
      ...(params.title || params.summary
        ? { output: { title: (params.title ?? "ScopeCI").slice(0, 250), summary: (params.summary ?? "").slice(0, 60_000) } }
        : {}),
    };
  }

  private toCheckRun(data: any): CheckRunResult {
    return {
      id: String(data.id),
      headSha: data.head_sha,
      status: data.status,
      conclusion: data.conclusion ?? undefined,
      htmlUrl: data.html_url,
    };
  }

  async createCheckRun(params: CreateCheckRunParams): Promise<CheckRunResult> {
    const { data } = await this.api<any>(
      params.installationId,
      "POST",
      `${this.repoPath(params.owner, params.repo)}/check-runs`,
      this.checkRunBody(params),
    );
    return this.toCheckRun(data);
  }

  async updateCheckRun(params: UpdateCheckRunParams): Promise<CheckRunResult> {
    const { data } = await this.api<any>(
      params.installationId,
      "PATCH",
      `${this.repoPath(params.owner, params.repo)}/check-runs/${encodeURIComponent(params.checkRunId)}`,
      this.checkRunBody(params),
    );
    return this.toCheckRun(data);
  }

  async createOrUpdateComment(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<CommentResult> {
    const text = body.slice(0, 65_000);
    const botLogin = this.config.slug ? `${this.config.slug}[bot]` : undefined;
    let existingId: number | undefined;
    let next: string | undefined = `${this.repoPath(owner, repo)}/issues/${prNumber}/comments?per_page=100`;
    for (let page = 0; next && page < MAX_COMMENT_PAGES && existingId === undefined; page++) {
      const { data, headers }: { data: any[]; headers: Headers } = await this.api(installationId, "GET", next);
      // Only ever edit our own comment, never a person's that happens to quote the marker.
      const ours = data.find(
        (c) =>
          typeof c.body === "string" &&
          c.body.includes(COMMENT_MARKER) &&
          c.user?.type === "Bot" &&
          (!botLogin || c.user?.login === botLogin),
      );
      existingId = ours?.id;
      next = nextPage(headers);
    }

    if (existingId !== undefined) {
      const { data } = await this.api<any>(
        installationId,
        "PATCH",
        `${this.repoPath(owner, repo)}/issues/comments/${existingId}`,
        { body: text },
      );
      return { id: String(data.id), body: data.body, action: "updated" };
    }
    const { data } = await this.api<any>(
      installationId,
      "POST",
      `${this.repoPath(owner, repo)}/issues/${prNumber}/comments`,
      { body: text },
    );
    return { id: String(data.id), body: data.body, action: "created" };
  }
}
