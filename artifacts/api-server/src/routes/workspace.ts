import crypto from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  organizationInvitesTable,
  organizationMembersTable,
  organizationsTable,
  usersTable,
} from "@workspace/db/schema";
import {
  AcceptInviteResponse,
  CreateInviteResponse,
  GetInviteResponse,
  GetWorkspaceResponse,
  SwitchWorkspaceBody,
  SwitchWorkspaceResponse,
  UpdateWorkspaceBody,
  UpdateWorkspaceResponse,
} from "@workspace/api-zod";
import { rateLimiter } from "../middlewares/rate-limit.js";
import {
  accountOf,
  appOrigin,
  chooseWorkspace,
  listWorkspaces,
  requireAccount,
  sameOriginWrites,
  type Account,
} from "../lib/session.js";

/**
 * Workspaces: who is in one, inviting more people with a single-use link,
 * and switching between workspaces. Only owners manage members and invites.
 */
const router: IRouter = Router();

router.use(["/workspace", "/invites", "/session/workspace"], sameOriginWrites, requireAccount);

const inviteLimiter = rateLimiter({ windowMs: 60_000, max: 20, message: "Too many invite attempts. Wait a minute." });

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OPEN_INVITES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const asRole = (role: string) => (role === "OWNER" ? "OWNER" : "MEMBER") as "OWNER" | "MEMBER";

function ownersOnly(account: Account, res: Response): boolean {
  if (account.role === "OWNER") return true;
  res.status(403).json({ error: "Only the workspace's owners can do this." });
  return false;
}

const openInvite = (organizationId?: string) =>
  and(
    ...(organizationId ? [eq(organizationInvitesTable.organizationId, organizationId)] : []),
    isNull(organizationInvitesTable.acceptedAt),
    isNull(organizationInvitesTable.revokedAt),
    gt(organizationInvitesTable.expiresAt, new Date()),
  );

async function workspaceInfo(account: Account) {
  const members = await db
    .select({
      userId: usersTable.id,
      login: usersTable.login,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
      role: organizationMembersTable.role,
      joinedAt: organizationMembersTable.createdAt,
    })
    .from(organizationMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, organizationMembersTable.userId))
    .where(eq(organizationMembersTable.organizationId, account.organizationId))
    .orderBy(organizationMembersTable.createdAt);

  const invites =
    account.role === "OWNER"
      ? await db
          .select({
            id: organizationInvitesTable.id,
            createdBy: usersTable.login,
            createdAt: organizationInvitesTable.createdAt,
            expiresAt: organizationInvitesTable.expiresAt,
          })
          .from(organizationInvitesTable)
          .leftJoin(usersTable, eq(usersTable.id, organizationInvitesTable.createdByUserId))
          .where(openInvite(account.organizationId))
          .orderBy(organizationInvitesTable.createdAt)
      : [];

  return {
    id: account.organizationId,
    name: account.organizationName,
    role: asRole(account.role),
    members: members.map((m) => ({ ...m, role: asRole(m.role), you: m.userId === account.userId })),
    invites,
  };
}

router.get("/workspace", async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.json(GetWorkspaceResponse.parse(await workspaceInfo(accountOf(res))));
});

router.patch("/workspace", async (req, res): Promise<void> => {
  const account = accountOf(res);
  if (!ownersOnly(account, res)) return;
  const parsed = UpdateWorkspaceBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) {
    res.status(400).json({ error: "Give the workspace a name of up to 120 characters." });
    return;
  }
  const name = parsed.data.name.trim();
  await db
    .update(organizationsTable)
    .set({ name, updatedAt: new Date() })
    .where(eq(organizationsTable.id, account.organizationId));
  res.json(UpdateWorkspaceResponse.parse(await workspaceInfo({ ...account, organizationName: name })));
});

router.post("/workspace/invites", inviteLimiter, async (req, res): Promise<void> => {
  const account = accountOf(res);
  if (!ownersOnly(account, res)) return;

  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(organizationInvitesTable)
    .where(openInvite(account.organizationId));
  if (open >= MAX_OPEN_INVITES) {
    res.status(409).json({ error: "This workspace has too many open invites. Cancel some first." });
    return;
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const [invite] = await db
    .insert(organizationInvitesTable)
    .values({
      organizationId: account.organizationId,
      tokenHash: hashToken(token),
      createdByUserId: account.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning({ id: organizationInvitesTable.id, expiresAt: organizationInvitesTable.expiresAt });

  res.status(201).json(
    CreateInviteResponse.parse({ id: invite.id, url: `${appOrigin(req)}/app/invite/${token}`, expiresAt: invite.expiresAt }),
  );
});

router.delete("/workspace/invites/:inviteId", async (req, res): Promise<void> => {
  const account = accountOf(res);
  if (!ownersOnly(account, res)) return;
  const inviteId = String(req.params.inviteId);
  const revoked = UUID.test(inviteId)
    ? await db
        .update(organizationInvitesTable)
        .set({ revokedAt: new Date() })
        .where(and(eq(organizationInvitesTable.id, inviteId), openInvite(account.organizationId)))
        .returning({ id: organizationInvitesTable.id })
    : [];
  if (revoked.length === 0) {
    res.status(404).json({ error: "No such open invite." });
    return;
  }
  res.status(204).end();
});

router.delete("/workspace/members/:userId", async (req, res): Promise<void> => {
  const account = accountOf(res);
  if (!ownersOnly(account, res)) return;
  const userId = String(req.params.userId);
  const target = UUID.test(userId)
    ? await db.query.organizationMembersTable.findFirst({
        where: and(
          eq(organizationMembersTable.organizationId, account.organizationId),
          eq(organizationMembersTable.userId, userId),
        ),
      })
    : undefined;
  if (!target) {
    res.status(404).json({ error: "That person isn't in this workspace." });
    return;
  }
  if (target.role === "OWNER") {
    const [{ owners }] = await db
      .select({ owners: sql<number>`count(*)::int` })
      .from(organizationMembersTable)
      .where(
        and(eq(organizationMembersTable.organizationId, account.organizationId), eq(organizationMembersTable.role, "OWNER")),
      );
    if (owners <= 1) {
      res.status(409).json({ error: "A workspace needs at least one owner." });
      return;
    }
  }
  await db.delete(organizationMembersTable).where(eq(organizationMembersTable.id, target.id));
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* Joining and switching                                               */
/* ------------------------------------------------------------------ */

const INVALID_INVITE = "This invite link is wrong, already used, cancelled or expired. Ask for a new one.";

async function findInvite(token: string) {
  if (!token || token.length > 100) return undefined;
  const [invite] = await db
    .select({
      id: organizationInvitesTable.id,
      organizationId: organizationInvitesTable.organizationId,
      role: organizationInvitesTable.role,
      expiresAt: organizationInvitesTable.expiresAt,
      workspaceName: organizationsTable.name,
      invitedBy: usersTable.login,
    })
    .from(organizationInvitesTable)
    .innerJoin(organizationsTable, eq(organizationsTable.id, organizationInvitesTable.organizationId))
    .leftJoin(usersTable, eq(usersTable.id, organizationInvitesTable.createdByUserId))
    .where(and(eq(organizationInvitesTable.tokenHash, hashToken(token)), openInvite()))
    .limit(1);
  return invite;
}

async function isMember(userId: string, organizationId: string): Promise<boolean> {
  const row = await db.query.organizationMembersTable.findFirst({
    where: and(eq(organizationMembersTable.userId, userId), eq(organizationMembersTable.organizationId, organizationId)),
  });
  return Boolean(row);
}

router.get("/invites/:token", inviteLimiter, async (req, res): Promise<void> => {
  const invite = await findInvite(String(req.params.token));
  if (!invite) {
    res.status(404).json({ error: INVALID_INVITE });
    return;
  }
  res.json(
    GetInviteResponse.parse({
      workspaceName: invite.workspaceName,
      invitedBy: invite.invitedBy,
      expiresAt: invite.expiresAt,
      alreadyMember: await isMember(accountOf(res).userId, invite.organizationId),
    }),
  );
});

router.post("/invites/:token/accept", inviteLimiter, async (req, res): Promise<void> => {
  const account = accountOf(res);
  const invite = await findInvite(String(req.params.token));
  if (!invite) {
    res.status(404).json({ error: INVALID_INVITE });
    return;
  }

  let role = invite.role;
  if (await isMember(account.userId, invite.organizationId)) {
    // Already in: switch to it, and leave the link for whoever it was meant for.
    const existing = (await listWorkspaces(account.userId)).find((w) => w.id === invite.organizationId);
    role = existing?.role ?? role;
  } else {
    const joined = await db.transaction(async (tx) => {
      // Claim the invite first, so two people racing on one link can't both join.
      const claimed = await tx
        .update(organizationInvitesTable)
        .set({ acceptedAt: new Date(), acceptedByUserId: account.userId })
        .where(and(eq(organizationInvitesTable.id, invite.id), openInvite()))
        .returning({ id: organizationInvitesTable.id });
      if (claimed.length === 0) return false;
      await tx
        .insert(organizationMembersTable)
        .values({ organizationId: invite.organizationId, userId: account.userId, role: invite.role })
        .onConflictDoNothing();
      return true;
    });
    if (!joined) {
      res.status(404).json({ error: INVALID_INVITE });
      return;
    }
  }

  await chooseWorkspace(req, invite.organizationId);
  res.json(AcceptInviteResponse.parse({ id: invite.organizationId, name: invite.workspaceName, role: asRole(role) }));
});

router.put("/session/workspace", async (req, res): Promise<void> => {
  const parsed = SwitchWorkspaceBody.safeParse(req.body);
  const account = accountOf(res);
  const target = parsed.success
    ? (await listWorkspaces(account.userId)).find((w) => w.id === parsed.data.organizationId)
    : undefined;
  if (!target) {
    res.status(404).json({ error: "You're not in that workspace." });
    return;
  }
  await chooseWorkspace(req, target.id);
  res.json(SwitchWorkspaceResponse.parse({ ...target, role: asRole(target.role) }));
});

export default router;
