import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { changeOrdersTable, commercialEventsTable, projectsTable, pullRequestsTable } from "@workspace/db/schema";
import { logger } from "./logger.js";
import { ACCEPTED, WITHDRAWN } from "./acceptance.js";

/**
 * The workspace's activity log: who did what to the team, the projects and
 * their change orders. Kept in commercial_events next to the change-order
 * and acceptance events already recorded there, and shown to owners on the
 * Team page. Names are stored as they were at the time, so the log still
 * reads right after a project or a person is renamed or removed.
 */
export type Activity =
  | { kind: "WORKSPACE_RENAMED"; name: string }
  | { kind: "INVITE_CREATED" }
  | { kind: "INVITE_REVOKED" }
  | { kind: "MEMBER_JOINED" }
  | { kind: "MEMBER_ROLE_CHANGED"; member: string; role: "OWNER" | "MEMBER" }
  | { kind: "MEMBER_REMOVED"; member: string }
  | { kind: "MEMBER_LEFT" }
  | { kind: "PROJECT_CREATED"; project: string }
  | { kind: "PROJECT_ARCHIVED"; project: string }
  | { kind: "PROJECT_RESTORED"; project: string }
  | { kind: "REPOSITORY_CONNECTED"; project: string; repository: string }
  | { kind: "REPOSITORY_DISCONNECTED"; project: string; repository: string }
  | { kind: "SCOPE_SAVED"; project: string; version: string }
  | { kind: "POLICY_CHANGED"; project: string; policy: string };

const KINDS = [
  "WORKSPACE_RENAMED",
  "INVITE_CREATED",
  "INVITE_REVOKED",
  "MEMBER_JOINED",
  "MEMBER_ROLE_CHANGED",
  "MEMBER_REMOVED",
  "MEMBER_LEFT",
  "PROJECT_CREATED",
  "PROJECT_ARCHIVED",
  "PROJECT_RESTORED",
  "REPOSITORY_CONNECTED",
  "REPOSITORY_DISCONNECTED",
  "SCOPE_SAVED",
  "POLICY_CHANGED",
] as const satisfies readonly Activity["kind"][];

const CHANGE_ORDER_EVENTS = ["CHANGE_ORDER_SENT", "CHANGE_ORDER_APPROVED", "CHANGE_ORDER_DECLINED"];

/**
 * Records one action, after it has happened. A failure to record is logged
 * but never undoes or fails the action the person took.
 */
export async function recordActivity(entry: { organizationId: string; actor: string; entityId: string; activity: Activity }): Promise<void> {
  try {
    await db.insert(commercialEventsTable).values({
      organizationId: entry.organizationId,
      entityType: "WORKSPACE",
      entityId: entry.entityId,
      eventType: entry.activity.kind,
      actorType: "PM",
      actorId: entry.actor,
      metadataJson: entry.activity,
    });
  } catch (err) {
    logger.warn({ err, kind: entry.activity.kind }, "Couldn't record workspace activity");
  }
}

const POLICY_NAMES: Record<string, string> = {
  OBSERVE: "report only",
  REVIEW: "ask for a decision",
  ENFORCE: "fail the check",
};

function describe(activity: Activity): string {
  switch (activity.kind) {
    case "WORKSPACE_RENAMED":
      return `renamed the workspace to "${activity.name}"`;
    case "INVITE_CREATED":
      return "made an invite link";
    case "INVITE_REVOKED":
      return "cancelled an invite link";
    case "MEMBER_JOINED":
      return "joined the workspace";
    case "MEMBER_ROLE_CHANGED":
      return `made @${activity.member} ${activity.role === "OWNER" ? "an owner" : "a member"}`;
    case "MEMBER_REMOVED":
      return `removed @${activity.member}`;
    case "MEMBER_LEFT":
      return "left the workspace";
    case "PROJECT_CREATED":
      return `created the project "${activity.project}"`;
    case "PROJECT_ARCHIVED":
      return `archived "${activity.project}"`;
    case "PROJECT_RESTORED":
      return `restored "${activity.project}"`;
    case "REPOSITORY_CONNECTED":
      return `connected ${activity.repository} to "${activity.project}"`;
    case "REPOSITORY_DISCONNECTED":
      return `disconnected ${activity.repository} from "${activity.project}"`;
    case "SCOPE_SAVED":
      return `saved scope ${activity.version} of "${activity.project}"`;
    case "POLICY_CHANGED":
      return `set "${activity.project}" to ${POLICY_NAMES[activity.policy] ?? activity.policy}`;
  }
}

export type ActivityEntry = { id: string; occurredAt: Date; actor: string | null; summary: string };

/** The workspace's latest activity, newest first, each said as one sentence. */
export async function workspaceActivity(organizationId: string, limit = 100): Promise<ActivityEntry[]> {
  const rows = await db
    .select()
    .from(commercialEventsTable)
    .where(
      and(
        eq(commercialEventsTable.organizationId, organizationId),
        or(
          and(eq(commercialEventsTable.entityType, "WORKSPACE"), inArray(commercialEventsTable.eventType, [...KINDS])),
          and(eq(commercialEventsTable.entityType, "CHANGE_ORDER"), inArray(commercialEventsTable.eventType, CHANGE_ORDER_EVENTS)),
          and(eq(commercialEventsTable.entityType, "PULL_REQUEST"), inArray(commercialEventsTable.eventType, [ACCEPTED, WITHDRAWN])),
        ),
      ),
    )
    .orderBy(desc(commercialEventsTable.occurredAt))
    .limit(limit);

  // Change orders and pull requests are named by their project and number.
  const orderIds = rows.filter((r) => r.entityType === "CHANGE_ORDER").map((r) => r.entityId);
  const orders = orderIds.length
    ? await db
        .select({ id: changeOrdersTable.id, reference: changeOrdersTable.reference, project: projectsTable.name, number: pullRequestsTable.number })
        .from(changeOrdersTable)
        .leftJoin(projectsTable, eq(projectsTable.id, changeOrdersTable.projectId))
        .leftJoin(pullRequestsTable, eq(pullRequestsTable.id, changeOrdersTable.pullRequestId))
        .where(inArray(changeOrdersTable.id, orderIds))
    : [];
  const orderOf = new Map(orders.map((o) => [o.id, o]));
  const prIds = rows.filter((r) => r.entityType === "PULL_REQUEST").map((r) => r.entityId);
  const prs = prIds.length
    ? await db
        .select({ id: pullRequestsTable.id, number: pullRequestsTable.number, project: projectsTable.name })
        .from(pullRequestsTable)
        .leftJoin(projectsTable, eq(projectsTable.id, pullRequestsTable.projectId))
        .where(inArray(pullRequestsTable.id, prIds))
    : [];
  const prOf = new Map(prs.map((p) => [p.id, p]));
  const inProject = (project: string | null | undefined) => (project ? ` in "${project}"` : "");

  return rows.flatMap((row) => {
    let summary: string | null = null;
    if (row.entityType === "WORKSPACE") {
      summary = describe(row.metadataJson as Activity);
    } else if (row.entityType === "CHANGE_ORDER") {
      const order = orderOf.get(row.entityId);
      const name = order?.reference ?? "a change order";
      const where = order?.number ? ` (#${order.number}${inProject(order.project)})` : inProject(order?.project);
      summary =
        row.eventType === "CHANGE_ORDER_SENT"
          ? `marked ${name} as sent${where}`
          : row.eventType === "CHANGE_ORDER_APPROVED"
            ? `recorded that the client approved ${name}${where}`
            : `recorded that the client declined ${name}${where}`;
    } else {
      const pr = prOf.get(row.entityId);
      const name = `${pr ? `#${pr.number}` : "a pull request"}${inProject(pr?.project)}`;
      summary = row.eventType === ACCEPTED ? `accepted ${name} as in scope` : `withdrew the acceptance of ${name}`;
    }
    return summary ? [{ id: row.id, occurredAt: row.occurredAt, actor: row.actorId, summary }] : [];
  });
}
