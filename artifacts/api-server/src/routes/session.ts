import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { organizationMembersTable, organizationsTable, usersTable } from "@workspace/db/schema";
import { GetSessionResponse } from "@workspace/api-zod";
import { timingSafeCompare } from "../middlewares/auth.js";
import { rateLimiter } from "../middlewares/rate-limit.js";
import { encryptedTokenColumns } from "../lib/github-token.js";
import {
  createSession,
  destroySession,
  loadAccount,
  readCookie,
  sameOriginWrites,
  serializeCookie,
} from "../lib/session.js";
import { authorizeUrl, exchangeCode, fetchUser, oauthConfig } from "../github/user-api.js";

/**
 * Sign in with GitHub. The App's own OAuth credentials are used, so the token
 * that comes back can list the App's installations the person can see.
 */
const router: IRouter = Router();

const STATE_COOKIE = "scopeci_oauth";
const STATE_TTL_SECONDS = 10 * 60;
const signInLimiter = rateLimiter({ windowMs: 60_000, max: 20, message: "Too many sign-in attempts. Wait a minute." });

function signInAvailable(): boolean {
  if (!oauthConfig()) return false;
  // Tokens are stored encrypted; production must not fall back to the test key.
  return process.env.NODE_ENV !== "production" || Boolean(process.env.GITHUB_TOKEN_ENCRYPTION_KEY);
}

function appOrigin(req: Request): string {
  if (process.env.APP_BASE_URL) {
    try {
      return new URL(process.env.APP_BASE_URL).origin;
    } catch {
      // fall through to the request's own host
    }
  }
  return `${req.protocol}://${req.get("host")}`;
}

/** Only our own app pages, so the sign-in flow can't be used as an open redirect. */
function safeNext(value: unknown): string {
  return typeof value === "string" && /^\/app(?:[/?#][^\s\\]*)?$/.test(value) && !value.startsWith("//")
    ? value
    : "/app";
}

router.get("/auth/github", signInLimiter, (req, res): void => {
  const config = oauthConfig();
  if (!config || !signInAvailable()) {
    res.redirect(302, "/app?signin=unavailable");
    return;
  }
  const state = crypto.randomBytes(24).toString("hex");
  const payload = Buffer.from(JSON.stringify({ state, next: safeNext(req.query.next) })).toString("base64url");
  res.setHeader(
    "Set-Cookie",
    serializeCookie(STATE_COOKIE, payload, { maxAgeSeconds: STATE_TTL_SECONDS, path: "/api/auth" }),
  );
  res.redirect(302, authorizeUrl(config.clientId, state, `${appOrigin(req)}/api/auth/github/callback`));
});

router.get("/auth/github/callback", signInLimiter, async (req, res): Promise<void> => {
  const clearState = serializeCookie(STATE_COOKIE, "", { maxAgeSeconds: 0, path: "/api/auth" });
  let saved: { state?: string; next?: string } = {};
  try {
    saved = JSON.parse(Buffer.from(readCookie(req, STATE_COOKIE) ?? "", "base64url").toString("utf8"));
  } catch {
    saved = {};
  }

  const fail = (reason: string) => {
    res.setHeader("Set-Cookie", clearState);
    res.redirect(302, `/app?signin=${reason}`);
  };

  if (req.query.error) return fail("cancelled");
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!saved.state || !state || !code || !timingSafeCompare(state, saved.state)) return fail("expired");

  try {
    const tokens = await exchangeCode(code, `${appOrigin(req)}/api/auth/github/callback`);
    const gitHubUser = await fetchUser(tokens.accessToken);

    const userId = await db.transaction(async (tx) => {
      const profile = {
        login: gitHubUser.login.slice(0, 100),
        name: gitHubUser.name?.slice(0, 255) ?? null,
        email: gitHubUser.email?.slice(0, 320) ?? null,
        avatarUrl: gitHubUser.avatarUrl,
        ...encryptedTokenColumns(tokens),
        lastLoginAt: new Date(),
      };
      const [user] = await tx
        .insert(usersTable)
        .values({ githubUserId: String(gitHubUser.id), ...profile })
        .onConflictDoUpdate({ target: usersTable.githubUserId, set: profile })
        .returning({ id: usersTable.id });

      const membership = await tx.query.organizationMembersTable.findFirst({
        where: eq(organizationMembersTable.userId, user.id),
      });
      if (!membership) {
        // Everyone starts with their own workspace, named after them.
        const slug = `gh-${gitHubUser.id}`;
        await tx
          .insert(organizationsTable)
          .values({ name: (gitHubUser.name || gitHubUser.login).slice(0, 255), slug })
          .onConflictDoNothing({ target: organizationsTable.slug });
        const org = await tx.query.organizationsTable.findFirst({ where: eq(organizationsTable.slug, slug) });
        await tx
          .insert(organizationMembersTable)
          .values({ organizationId: org!.id, userId: user.id, role: "OWNER" })
          .onConflictDoNothing();
      }
      return user.id;
    });

    const { cookie } = await createSession(userId);
    res.setHeader("Set-Cookie", [clearState, cookie]);
    res.redirect(302, safeNext(saved.next));
  } catch (err) {
    req.log.warn({ err }, "GitHub sign-in failed");
    fail("failed");
  }
});

router.get("/session", async (req, res): Promise<void> => {
  const account = await loadAccount(req);
  res.setHeader("Cache-Control", "no-store");
  res.json(
    GetSessionResponse.parse({
      signInAvailable: signInAvailable(),
      user: account
        ? { id: account.userId, login: account.login, name: account.name, avatarUrl: account.avatarUrl }
        : null,
      organization: account ? { id: account.organizationId, name: account.organizationName } : null,
    }),
  );
});

router.delete("/session", sameOriginWrites, async (req, res): Promise<void> => {
  res.setHeader("Set-Cookie", await destroySession(req));
  res.status(204).end();
});

export default router;
