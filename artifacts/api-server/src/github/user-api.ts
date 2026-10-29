import { gitHubAppSettings } from "./app-settings.js";
import { API_HEADERS, gitHubApiUrl, gitHubRequest, gitHubWebUrl, nextPage } from "./github-http.js";
import { logger } from "../lib/logger.js";

/**
 * Calls made as the signed-in person, with the user token the GitHub App's
 * OAuth flow hands back: who they are, and which of the App's installations
 * and repositories they can see. That last part is what lets ScopeCI link a
 * repository to a project without trusting anything the browser sends.
 */

export interface GitHubOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** When the access token stops working; undefined for tokens that don't expire. */
  expiresAt?: Date;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface GitHubInstallation {
  id: number;
  accountLogin: string;
  accountType: string;
  accountId: number;
  repositorySelection: string;
  permissions: Record<string, string>;
}

export interface GitHubRepository {
  id: number;
  fullName: string;
  private: boolean;
}

export async function oauthConfig(): Promise<{ clientId: string; clientSecret: string } | null> {
  const { clientId, clientSecret } = await gitHubAppSettings();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function authorizeUrl(clientId: string, state: string, redirectUri: string): string {
  const params = new URLSearchParams({ client_id: clientId, state, redirect_uri: redirectUri, allow_signup: "true" });
  return `${gitHubWebUrl()}/login/oauth/authorize?${params}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<GitHubOAuthTokens> {
  const config = await oauthConfig();
  if (!config) throw new Error("GitHub sign-in is not configured");
  const { data } = await gitHubRequest<TokenResponse>(`${gitHubWebUrl()}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "ScopeCI" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
  });
  // GitHub reports a bad code with 200 and an `error` field.
  if (!data.access_token) throw new Error(`GitHub refused the token request: ${data.error ?? "no token"}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
  };
}

export function exchangeCode(code: string, redirectUri: string): Promise<GitHubOAuthTokens> {
  return tokenRequest({ code, redirect_uri: redirectUri });
}

export function refreshUserToken(refreshToken: string): Promise<GitHubOAuthTokens> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

function userHeaders(token: string): Record<string, string> {
  return { ...API_HEADERS, Authorization: `Bearer ${token}` };
}

export async function fetchUser(token: string): Promise<GitHubUser> {
  const { data } = await gitHubRequest<{
    id: number;
    login: string;
    name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  }>(`${gitHubApiUrl()}/user`, { headers: userHeaders(token) });
  return {
    id: data.id,
    login: data.login,
    name: data.name ?? null,
    email: data.email ?? null,
    avatarUrl: data.avatar_url ?? null,
  };
}

/**
 * Pages through a list endpoint whose items sit under `key`, up to
 * `maxPages`, and says whether GitHub had more pages than that.
 */
async function listAll<T>(url: string, token: string, key: string, maxPages = 10): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < maxPages; page++) {
    const { data, headers }: { data: Record<string, unknown>; headers: Headers } = await gitHubRequest(next, {
      headers: userHeaders(token),
    });
    items.push(...((data[key] as T[] | undefined) ?? []));
    next = nextPage(headers);
  }
  return { items, truncated: Boolean(next) };
}

export async function listUserInstallations(token: string): Promise<GitHubInstallation[]> {
  const { items: raw } = await listAll<{
    id: number;
    account?: { login?: string; type?: string; id?: number };
    repository_selection?: string;
    permissions?: Record<string, string>;
  }>(`${gitHubApiUrl()}/user/installations?per_page=100`, token, "installations");
  return raw.map((i) => ({
    id: i.id,
    accountLogin: i.account?.login ?? "",
    accountType: i.account?.type ?? "User",
    accountId: i.account?.id ?? 0,
    repositorySelection: i.repository_selection ?? "selected",
    permissions: i.permissions ?? {},
  }));
}

/**
 * Pages of 100 read from one installation's repositories. An installation on
 * "All repositories" in a large organization can hold thousands; past this
 * many the list stops and says so.
 */
const MAX_REPOSITORY_PAGES = 50;

/** An installation's repositories; `truncated` when it holds more than ScopeCI lists. */
export type GitHubRepositoryList = GitHubRepository[] & { truncated: boolean };

export async function listInstallationRepositories(token: string, installationId: number): Promise<GitHubRepositoryList> {
  const { items, truncated } = await listAll<{ id: number; full_name: string; private?: boolean }>(
    `${gitHubApiUrl()}/user/installations/${installationId}/repositories?per_page=100`,
    token,
    "repositories",
    MAX_REPOSITORY_PAGES,
  );
  if (truncated) {
    logger.warn(
      { installationId, listed: items.length },
      "The installation has more repositories than ScopeCI lists; the rest can't be chosen until it is limited to selected repositories",
    );
  }
  const repositories = items.map((r) => ({ id: r.id, fullName: r.full_name, private: Boolean(r.private) }));
  return Object.assign(repositories, { truncated });
}

/** Where to send someone to install the App on their account or organization. */
export async function installUrl(): Promise<string | null> {
  const { slug } = await gitHubAppSettings();
  return slug ? `${gitHubWebUrl()}/apps/${encodeURIComponent(slug)}/installations/new` : null;
}
