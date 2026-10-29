import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { decryptToken, encryptToken, type EncryptedPayload } from "../linear/crypto.js";
import { GitHubApiError } from "../github/github-http.js";
import { refreshUserToken, type GitHubOAuthTokens } from "../github/user-api.js";
import { logger } from "./logger.js";

/**
 * The person's GitHub user token, kept encrypted, so ScopeCI can ask GitHub
 * which installations and repositories they can see. It is only used while
 * they are signed in and acting in the app.
 */

const KEY_ENV = "GITHUB_TOKEN_ENCRYPTION_KEY";

export class GitHubReauthRequired extends Error {
  constructor() {
    super("GitHub access expired. Sign in again.");
    this.name = "GitHubReauthRequired";
  }
}

export function encryptedTokenColumns(tokens: GitHubOAuthTokens) {
  return {
    githubTokenJson: encryptToken(tokens.accessToken, "v1", KEY_ENV),
    githubRefreshTokenJson: tokens.refreshToken ? encryptToken(tokens.refreshToken, "v1", KEY_ENV) : null,
    githubTokenExpiresAt: tokens.expiresAt ?? null,
  };
}

/** A stored token that no longer decrypts (GITHUB_TOKEN_ENCRYPTION_KEY changed): a fresh sign-in stores it again. */
function decryptStored(payload: unknown): string {
  try {
    return decryptToken(payload as EncryptedPayload, KEY_ENV);
  } catch {
    throw new GitHubReauthRequired();
  }
}

const usable = (expiresAt: Date | null) => !expiresAt || expiresAt.getTime() - Date.now() > 60_000;

// GitHub's refresh tokens work once, so two requests refreshing together
// (the repository list and a link, two tabs) share one refresh.
const refreshing = new Map<string, Promise<string>>();

export async function userGitHubToken(userId: string): Promise<string> {
  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user?.githubTokenJson) throw new GitHubReauthRequired();
  if (usable(user.githubTokenExpiresAt)) return decryptStored(user.githubTokenJson);

  if (!user.githubRefreshTokenJson) throw new GitHubReauthRequired();
  let pending = refreshing.get(userId);
  if (!pending) {
    pending = refresh(userId, user.githubRefreshTokenJson).finally(() => refreshing.delete(userId));
    refreshing.set(userId, pending);
  }
  return pending;
}

async function refresh(userId: string, refreshTokenJson: unknown): Promise<string> {
  let tokens: GitHubOAuthTokens;
  try {
    tokens = await refreshUserToken(decryptStored(refreshTokenJson));
  } catch (err) {
    // GitHub unreachable, failing or limiting requests: app.ts says so and to
    // try again. Signing in again would go through the same GitHub.
    if (err instanceof GitHubApiError && (err.status === 0 || err.status >= 500 || err.rateLimited)) throw err;
    // GitHub refused the refresh token. Another server may have just used it
    // and stored the new one; otherwise a sign-in is the only way back.
    const fresh = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
    if (fresh?.githubTokenJson && usable(fresh.githubTokenExpiresAt)) {
      return decryptStored(fresh.githubTokenJson);
    }
    throw new GitHubReauthRequired();
  }
  try {
    await db.update(usersTable).set(encryptedTokenColumns(tokens)).where(eq(usersTable.id, userId));
  } catch (err: any) {
    // GitHub has already spent the old refresh token, so this request still
    // uses the new access token; the next one will ask for a sign-in.
    logger.error({ userId, code: err?.cause?.code ?? err?.code }, "Couldn't save the refreshed GitHub token");
  }
  return tokens.accessToken;
}
