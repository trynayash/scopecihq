import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { organizationMembersTable, usersTable } from "@workspace/db/schema";
import { GetSessionResponse } from "@workspace/api-zod";
import { timingSafeCompare } from "../middlewares/auth.js";
import { rateLimiter } from "../middlewares/rate-limit.js";
import { encryptedTokenColumns } from "../lib/github-token.js";
import {
  appOrigin,
  createPersonalWorkspace,
  createSession,
  destroySession,
  listWorkspaces,
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

async function signInAvailable(): Promise<boolean> {
  if (!(await oauthConfig())) return false;
  // Tokens are stored encrypted; production must not fall back to the test key.
  return process.env.NODE_ENV !== "production" || Boolean(process.env.GITHUB_TOKEN_ENCRYPTION_KEY);
}

/** Only our own app pages, so the sign-in flow can't be used as an open redirect. */
function safeNext(value: unknown): string {
  return typeof value === "string" && /^\/app(?:[/?#][^\s\\]*)?$/.test(value) && !value.startsWith("//")
    ? value
    : "/app";
}

/** Back to the page they started from (an invite link, say), saying what went wrong. */
function backWith(next: unknown, reason: string): string {
  return `${safeNext(next).replace(/[?#].*$/, "")}?signin=${reason}`;
}

function savedState(req: Request): { state?: string; next?: string } {
  try {
    const saved = JSON.parse(Buffer.from(readCookie(req, STATE_COOKIE) ?? "", "base64url").toString("utf8"));
    return {
      state: typeof saved?.state === "string" ? saved.state : undefined,
      next: typeof saved?.next === "string" ? saved.next : undefined,
    };
  } catch {
    return {};
  }
}

// Both are page loads, not fetches, so a limited one goes back to the app with
// a notice rather than showing raw JSON. Separate budgets, so one sign-in uses
// one from each and a burst of people (an office on one IP) gets twenty.
const LIMIT = { windowMs: 60_000, max: 20 };
const startLimiter = rateLimiter({
  ...LIMIT,
  onLimit: (req, res) => res.redirect(302, backWith(req.query.next, "busy")),
});
const callbackLimiter = rateLimiter({
  ...LIMIT,
  onLimit: (req, res) => res.redirect(302, backWith(savedState(req).next, "busy")),
});

router.get("/auth/github", startLimiter, async (req, res): Promise<void> => {
  const config = await oauthConfig();
  if (!config || !(await signInAvailable())) {
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

router.get("/auth/github/callback", callbackLimiter, async (req, res): Promise<void> => {
  const clearState = serializeCookie(STATE_COOKIE, "", { maxAgeSeconds: 0, path: "/api/auth" });
  const saved = savedState(req);

  const fail = (reason: string) => {
    res.setHeader("Set-Cookie", clearState);
    res.redirect(302, backWith(saved.next, reason));
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

      // The same lock leaving and removal take, so two first sign-ins at once
      // make one workspace, and a sign-in can't race someone removing them.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`memberships:${user.id}`}))`);
      const membership = await tx.query.organizationMembersTable.findFirst({
        where: eq(organizationMembersTable.userId, user.id),
      });
      if (!membership) {
        // Everyone starts with their own workspace, named after them. Never one
        // that already exists: that would put someone an owner removed back in.
        await createPersonalWorkspace(tx, {
          userId: user.id,
          githubUserId: String(gitHubUser.id),
          name: gitHubUser.name || gitHubUser.login,
        });
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
      signInAvailable: await signInAvailable(),
      user: account
        ? { id: account.userId, login: account.login, name: account.name, avatarUrl: account.avatarUrl }
        : null,
      organization: account
        ? { id: account.organizationId, name: account.organizationName, role: account.role }
        : null,
      workspaces: account ? await listWorkspaces(account.userId) : [],
    }),
  );
});

router.delete("/session", sameOriginWrites, async (req, res): Promise<void> => {
  res.setHeader("Set-Cookie", await destroySession(req));
  res.status(204).end();
});

export default router;
