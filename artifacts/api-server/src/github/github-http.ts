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

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number,
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

/**
 * One request with a timeout. Non-2xx answers throw GitHubApiError carrying
 * the status and, for rate limits, how long GitHub asked us to wait.
 */
export async function gitHubRequest<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ data: T; headers: Headers }> {
  const { timeoutMs = 10_000, ...rest } = init;
  const res = await gitHubFetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    let message = `GitHub answered ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = `${message}: ${body.message}`;
    } catch {
      // body wasn't JSON
    }
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    throw new GitHubApiError(message, res.status, retryAfter);
  }
  const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { data, headers: res.headers };
}

/** The `next` page URL from a Link header, if any. */
export function nextPage(headers: Headers): string | undefined {
  const link = headers.get("link");
  if (!link) return undefined;
  const match = link.split(",").find((part) => /rel="next"/.test(part));
  return match?.match(/<([^>]+)>/)?.[1];
}
