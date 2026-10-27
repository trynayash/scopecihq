import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { decryptToken, encryptToken, type EncryptedPayload } from "../linear/crypto.js";
import { refreshUserToken, type GitHubOAuthTokens } from "../github/user-api.js";

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

export async function userGitHubToken(userId: string): Promise<string> {
  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user?.githubTokenJson) throw new GitHubReauthRequired();

  const expiresAt = user.githubTokenExpiresAt?.getTime();
  if (expiresAt === undefined || expiresAt - Date.now() > 60_000) {
    return decryptToken(user.githubTokenJson as EncryptedPayload, KEY_ENV);
  }

  if (!user.githubRefreshTokenJson) throw new GitHubReauthRequired();
  try {
    const tokens = await refreshUserToken(decryptToken(user.githubRefreshTokenJson as EncryptedPayload, KEY_ENV));
    await db.update(usersTable).set(encryptedTokenColumns(tokens)).where(eq(usersTable.id, userId));
    return tokens.accessToken;
  } catch {
    throw new GitHubReauthRequired();
  }
}
