/**
 * Shared plumbing for every call ScopeCI makes to GitHub: base URLs (so a
 * GitHub Enterprise host or a local fake can stand in), the fetch function
 * (so tests can replace the network), and one error type.
 */

export type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;

let gitHubFetch: GitHubFetch = (url, init) => fetch(url, init);

/** Test hook: replaces the network for OAuth, user and App API calls. */
export function setGitHubFetch(fn: GitHubFetch | null): void {
  gitHubFetch = fn ?? ((url, init) => fetch(url, init));
}

export function gitHubApiUrl(): string {
  return (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
}

export function gitHubWebUrl(): string {
  return (process.env.GITHUB_WEB_URL || "https://github.com").replace(/\/+$/, "");
}

/**
 * GitHub answered with an error, or (status 0) couldn't be reached at all.
 * `rateLimited` is set when GitHub said it was limiting requests: a 429, or
 * a 403 carrying the rate-limit headers (other 403s are about access).
 */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number,
    public rateLimited = false,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "ScopeCI",
  "X-GitHub-Api-Version": "2022-11-28",
};

/** Waits between tries; a test can make it instant. */
let pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Test hook: replaces the wait between retries. */
export function setGitHubRetryPause(fn: ((ms: number) => Promise<void>) | null): void {
  pause = fn ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

/** How long to wait before try `attempt` (1 or 2), honouring Retry-After up to 10s. */
function backoff(attempt: number, retryAfter?: number): number {
  if (retryAfter) return Math.min(retryAfter, 10) * 1000;
  return attempt === 1 ? 500 : 1500;
}

/**
 * Whether an answer is worth asking again for. A rate limit (429, or a 403
 * that says so) never did the work, so any request can be repeated. A 5xx
 * might have, so only requests that are safe to repeat are: reads and edits,
 * not creating a comment or a check run twice.
 */
function rateLimit(status: number, headers: Headers): boolean {
  return status === 429 || (status === 403 && Boolean(headers.get("retry-after") || headers.get("x-ratelimit-remaining") === "0"));
}

function retryable(status: number, method: string, headers: Headers): boolean {
  if (rateLimit(status, headers)) return true;
  return status >= 500 && method !== "POST";
}

/**
 * One request with a timeout, tried up to three times when GitHub is busy or
 * briefly failing. Non-2xx answers throw GitHubApiError carrying the status
 * and, for rate limits, how long GitHub asked us to wait.
 */
export async function gitHubRequest<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ data: T; headers: Headers }> {
  const { timeoutMs = 10_000, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await gitHubFetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err: any) {
      // No answer at all (DNS, a reset connection, the timeout): GitHub's
      // trouble, never to be mistaken for the database's.
      const why = err?.name === "TimeoutError" ? "timed out" : (err?.cause?.code ?? err?.message ?? "failed");
      throw new GitHubApiError(`GitHub couldn't be reached (${why})`, 0);
    }
    if (res.ok) {
      const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
      return { data, headers: res.headers };
    }
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    if (attempt < 2 && retryable(res.status, method, res.headers)) {
      await res.body?.cancel().catch(() => undefined);
      await pause(backoff(attempt + 1, retryAfter));
      continue;
    }
    let message = `GitHub answered ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = `${message}: ${body.message}`;
    } catch {
      // body wasn't JSON
    }
    throw new GitHubApiError(message, res.status, retryAfter, rateLimit(res.status, res.headers));
  }
}

/** The `next` page URL from a Link header, if any. */
export function nextPage(headers: Headers): string | undefined {
  const link = headers.get("link");
  if (!link) return undefined;
  const match = link.split(",").find((part) => /rel="next"/.test(part));
  return match?.match(/<([^>]+)>/)?.[1];
}
