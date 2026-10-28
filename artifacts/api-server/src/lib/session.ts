import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  organizationMembersTable,
  organizationsTable,
  userSessionsTable,
  usersTable,
} from "@workspace/db/schema";

/**
 * Signed-in sessions. The cookie holds a random token; the database holds
 * only its SHA-256, so a leaked database row can't be replayed as a cookie
 * and signing out (or deleting the row) ends the session at once.
 */

export const SESSION_COOKIE = "scopeci_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 10 * 60 * 1000;

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; path?: string },
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path ?? "/"}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    "HttpOnly",
    // Lax, not Strict: the GitHub sign-in callback is a top-level navigation
    // from github.com, and Strict would drop the cookie on that first visit.
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string): Promise<{ cookie: string }> {
  const token = crypto.randomBytes(32).toString("base64url");
  // A new sign-in opens the workspace they last chose on another device.
  const [recent] = await db
    .select({ organizationId: userSessionsTable.organizationId })
    .from(userSessionsTable)
    .where(and(eq(userSessionsTable.userId, userId), isNotNull(userSessionsTable.organizationId)))
    .orderBy(desc(userSessionsTable.lastSeenAt))
    .limit(1);
  await db.insert(userSessionsTable).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    organizationId: recent?.organizationId ?? null,
  });
  return { cookie: serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: SESSION_TTL_MS / 1000 }) };
}

export async function destroySession(req: Request): Promise<string> {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await db.delete(userSessionsTable).where(eq(userSessionsTable.tokenHash, hashToken(token)));
  return serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0 });
}

export interface Account {
  userId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  organizationId: string;
  organizationName: string;
  role: string;
}

/**
 * The signed-in person and the workspace they are working in, or null. The
 * session remembers a chosen workspace; if they are no longer a member of
 * it (or never chose one), it falls back to the one they joined most
 * recently. Everyone gets a personal workspace at first sign-in, so a PM
 * invited to their agency lands in the agency's, not their own empty one.
 */
export async function loadAccount(req: Request): Promise<Account | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;

  const [session] = await db
    .select({
      sessionId: userSessionsTable.id,
      lastSeenAt: userSessionsTable.lastSeenAt,
      chosen: userSessionsTable.organizationId,
      userId: usersTable.id,
      login: usersTable.login,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(userSessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, userSessionsTable.userId))
    .where(and(eq(userSessionsTable.tokenHash, hashToken(token)), gt(userSessionsTable.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;

  const memberships = await db
    .select({
      organizationId: organizationsTable.id,
      organizationName: organizationsTable.name,
      role: organizationMembersTable.role,
    })
    .from(organizationMembersTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, organizationMembersTable.organizationId))
    .where(eq(organizationMembersTable.userId, session.userId))
    .orderBy(organizationMembersTable.createdAt);
  const membership = memberships.find((m) => m.organizationId === session.chosen) ?? memberships.at(-1);
  if (!membership) return null;

  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db.update(userSessionsTable).set({ lastSeenAt: new Date() }).where(eq(userSessionsTable.id, session.sessionId));
  }

  return {
    userId: session.userId,
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    ...membership,
  };
}

/** Every workspace the person belongs to, oldest membership first. */
export async function listWorkspaces(userId: string) {
  return db
    .select({ id: organizationsTable.id, name: organizationsTable.name, role: organizationMembersTable.role })
    .from(organizationMembersTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, organizationMembersTable.organizationId))
    .where(eq(organizationMembersTable.userId, userId))
    .orderBy(organizationMembersTable.createdAt);
}

/** The app's own origin, for links that leave the browser (OAuth callbacks, invites). */
export function appOrigin(req: Request): string {
  if (process.env.APP_BASE_URL) {
    try {
      return new URL(process.env.APP_BASE_URL).origin;
    } catch {
      // fall through to the request's own host
    }
  }
  return `${req.protocol}://${req.get("host")}`;
}

/** Points the current session at a workspace the person belongs to. */
export async function chooseWorkspace(req: Request, organizationId: string): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return;
  await db
    .update(userSessionsTable)
    .set({ organizationId })
    .where(eq(userSessionsTable.tokenHash, hashToken(token)));
}

export function accountOf(res: Response): Account {
  return res.locals.account as Account;
}

export async function requireAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  const account = await loadAccount(req);
  if (!account) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  res.locals.account = account;
  next();
}

/**
 * Writes must come from our own pages. SameSite=Lax already keeps the cookie
 * off cross-site POSTs; this also refuses a browser request whose Origin
 * names another site, in case a deployment ever loosens the cookie.
 */
export function sameOriginWrites(req: Request, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (origin) {
    let allowed = false;
    try {
      const host = new URL(origin).host;
      const appHost = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).host : undefined;
      allowed = host === req.headers.host || host === appHost;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      res.status(403).json({ error: "This request has to come from the ScopeCI app." });
      return;
    }
  } else if (req.headers["sec-fetch-site"] === "cross-site") {
    res.status(403).json({ error: "This request has to come from the ScopeCI app." });
    return;
  }
  next();
}
