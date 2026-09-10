import {
  commercialEventsTable,
  contractsTable,
  db,
  deliverablesTable,
  issueDeliverableLinksTable,
  issuesTable,
  linearConnectionsTable,
  projectLinksTable,
  scopeBaselinesTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { ILinearClient, LinearIssueDetail } from "./linear-client.js";
import { normalizeLinearIssueForDb } from "./normalizer.js";

export interface SyncIssueResult {
  status: "UPSERTED" | "STALE_REJECTED";
  issueId: string;
  identifier: string;
  reason?: string;
  advisoryDeliverableLinked?: boolean;
}

export interface ProjectSyncSummary {
  projectId: string;
  totalFetched: number;
  upsertedCount: number;
  staleRejectedCount: number;
  advisoryLinksCreated: number;
}

export class LinearSyncService {
  /**
   * Phase 3 Hard Requirement 3: Revision-aware Issue Ingestion.
   * A delayed or out-of-order event must never overwrite a newer local representation.
   * Prefer provider timestamps and reject stale updates.
   */
  async upsertLinearIssue(
    organizationId: string,
    detail: LinearIssueDetail
  ): Promise<SyncIssueResult> {
    const existing = await db
      .select()
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.organizationId, organizationId),
          eq(issuesTable.externalProvider, "LINEAR"),
          eq(issuesTable.externalId, detail.id)
        )
      )
      .limit(1);

    const incomingUpdatedAt = new Date(detail.updatedAt);

    if (existing.length > 0) {
      const current = existing[0];
      const currentUpdatedAt = new Date(current.updatedAt);

      // Reject stale update if provider timestamp is older than or equal to current representation
      if (incomingUpdatedAt.getTime() <= currentUpdatedAt.getTime()) {
        return {
          status: "STALE_REJECTED",
          issueId: current.id,
          identifier: current.identifier,
          reason: `Stale update rejected: incoming provider timestamp (${incomingUpdatedAt.toISOString()}) <= local representation (${currentUpdatedAt.toISOString()})`,
        };
      }

      // Newer revision received: update local representation
      const [updated] = await db
        .update(issuesTable)
        .set({
          identifier: detail.identifier.toUpperCase(),
          title: detail.title,
          description: detail.description || "",
          status: detail.state,
          estimate: detail.estimate ?? null,
          url: detail.url,
          lastSyncedAt: new Date(),
          updatedAt: incomingUpdatedAt,
        })
        .where(eq(issuesTable.id, current.id))
        .returning();

      const advisoryLinked = await this.inferAdvisoryDeliverableLinks(organizationId, updated);

      return {
        status: "UPSERTED",
        issueId: updated.id,
        identifier: updated.identifier,
        advisoryDeliverableLinked: advisoryLinked,
      };
    }

    // Insert new issue record
    const [inserted] = await db
      .insert(issuesTable)
      .values(normalizeLinearIssueForDb(detail, organizationId))
      .returning();

    const advisoryLinked = await this.inferAdvisoryDeliverableLinks(organizationId, inserted);

    return {
      status: "UPSERTED",
      issueId: inserted.id,
      identifier: inserted.identifier,
      advisoryDeliverableLinked: advisoryLinked,
    };
  }

  /**
   * Phase 3 Hard Requirement 4: Advisory Issue → Deliverable Linking.
   * Deterministic keyword matching must NEVER silently create a commercial authorization.
   * A link can support the graph, but only the commercial-engine evaluation layer can determine commercial state.
   */
  async inferAdvisoryDeliverableLinks(
    organizationId: string,
    issue: typeof issuesTable.$inferSelect
  ): Promise<boolean> {
    // 1. Fetch active deliverables for the organization
    const activeDeliverables = await db
      .select({
        id: deliverablesTable.id,
        name: deliverablesTable.name,
        description: deliverablesTable.description,
        scopeBaselineId: deliverablesTable.scopeBaselineId,
      })
      .from(deliverablesTable)
      .innerJoin(
        scopeBaselinesTable,
        eq(deliverablesTable.scopeBaselineId, scopeBaselinesTable.id)
      )
      .innerJoin(
        contractsTable,
        eq(scopeBaselinesTable.contractId, contractsTable.id)
      )
      .where(eq(contractsTable.organizationId, organizationId));

    if (activeDeliverables.length === 0) {
      return false;
    }

    const textToMatch = `${issue.identifier} ${issue.title} ${issue.description}`.toLowerCase();

    // Check keyword candidates
    let matchedDeliverableId: string | null = null;
    let matchedKeywords: string[] = [];

    for (const deliv of activeDeliverables) {
      const delivName = deliv.name.toLowerCase();
      if (delivName.includes("auth") || delivName.includes("permission") || delivName.includes("user")) {
        const authKeywords = ["auth", "login", "rbac", "role", "permissions", "password", "user"];
        const found = authKeywords.filter((kw) => textToMatch.includes(kw));
        if (found.length > 0) {
          matchedDeliverableId = deliv.id;
          matchedKeywords = found;
          break;
        }
      } else if (delivName.includes("audit") || delivName.includes("log") || delivName.includes("export")) {
        const auditKeywords = ["audit", "csv", "export", "log"];
        const found = auditKeywords.filter((kw) => textToMatch.includes(kw));
        if (found.length > 0) {
          matchedDeliverableId = deliv.id;
          matchedKeywords = found;
          break;
        }
      }
    }

    if (!matchedDeliverableId) {
      return false;
    }

    // Check if link already exists
    const existingLink = await db
      .select()
      .from(issueDeliverableLinksTable)
      .where(
        and(
          eq(issueDeliverableLinksTable.issueId, issue.id),
          eq(issueDeliverableLinksTable.deliverableId, matchedDeliverableId)
        )
      )
      .limit(1);

    if (existingLink.length > 0) {
      return false;
    }

    // Insert strictly ADVISORY link. Note: commercialAuthorization is explicitly false.
    await db.insert(issueDeliverableLinksTable).values({
      issueId: issue.id,
      deliverableId: matchedDeliverableId,
      associationType: "INFERRED",
      confidence: "0.8500",
      evidenceJson: {
        method: "KEYWORD_HEURISTIC",
        matchedKeywords,
        advisoryOnly: true,
        commercialAuthorization: false, // Phase 3 hard requirement
        note: "Advisory link generated for commercial provenance graph. Commercial authorization requires diff evaluation.",
      },
    });

    return true;
  }

  /**
   * Manual Deliverable Linking:
   * Agency PM or Lead explicitly links a Linear issue to a Deliverable.
   * Creates an immutable audit trail entry in commercial_eventsTable.
   */
  async manualLinkIssueToDeliverable(params: {
    organizationId: string;
    issueId: string;
    deliverableId: string;
    actor: { id: string; name: string; type?: "PM" | "CLIENT" | "DEVELOPER" };
  }): Promise<{ id: string; deliverableId: string }> {
    const { organizationId, issueId, deliverableId, actor } = params;

    // Verify issue belongs to organization
    const issue = await db
      .select()
      .from(issuesTable)
      .where(and(eq(issuesTable.id, issueId), eq(issuesTable.organizationId, organizationId)))
      .limit(1);

    if (issue.length === 0) {
      throw new Error(`Issue ${issueId} not found in organization ${organizationId}`);
    }

    // Verify deliverable exists
    const deliverable = await db
      .select()
      .from(deliverablesTable)
      .where(eq(deliverablesTable.id, deliverableId))
      .limit(1);

    if (deliverable.length === 0) {
      throw new Error(`Deliverable ${deliverableId} not found`);
    }

    // Upsert link
    const existing = await db
      .select()
      .from(issueDeliverableLinksTable)
      .where(
        and(
          eq(issueDeliverableLinksTable.issueId, issueId),
          eq(issueDeliverableLinksTable.deliverableId, deliverableId)
        )
      )
      .limit(1);

    let linkId: string;
    if (existing.length > 0) {
      linkId = existing[0].id;
      await db
        .update(issueDeliverableLinksTable)
        .set({
          associationType: "DIRECT",
          confidence: "1.0000",
          evidenceJson: {
            method: "MANUAL_LINK",
            actorId: actor.id,
            actorName: actor.name,
            linkedAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(issueDeliverableLinksTable.id, linkId));
    } else {
      const [inserted] = await db
        .insert(issueDeliverableLinksTable)
        .values({
          issueId,
          deliverableId,
          associationType: "DIRECT",
          confidence: "1.0000",
          evidenceJson: {
            method: "MANUAL_LINK",
            actorId: actor.id,
            actorName: actor.name,
            linkedAt: new Date().toISOString(),
          },
        })
        .returning();
      linkId = inserted.id;
    }

    // Record immutable audit event in commercial_events
    await db.insert(commercialEventsTable).values({
      organizationId,
      entityType: "ISSUE",
      entityId: issueId,
      eventType: "MANUAL_DELIVERABLE_LINK",
      actorType: actor.type || "PM",
      actorId: actor.id,
      reason: `Manually linked issue ${issue[0].identifier} to deliverable "${deliverable[0].name}"`,
      metadataJson: {
        issueId,
        identifier: issue[0].identifier,
        deliverableId,
        deliverableName: deliverable[0].name,
        actorName: actor.name,
      },
    });

    return { id: linkId, deliverableId };
  }

  /**
   * Maps a Linear Project to a GitHub repository in project_links.
   */
  async mapProjectToRepository(params: {
    organizationId: string;
    externalProjectId: string;
    externalProjectName: string;
    externalTeamId?: string;
    repositoryExternalId: string;
    repositoryFullName: string;
  }): Promise<string> {
    const {
      organizationId,
      externalProjectId,
      externalProjectName,
      externalTeamId,
      repositoryExternalId,
      repositoryFullName,
    } = params;

    const existing = await db
      .select()
      .from(projectLinksTable)
      .where(
        and(
          eq(projectLinksTable.organizationId, organizationId),
          eq(projectLinksTable.externalProjectId, externalProjectId),
          eq(projectLinksTable.repositoryFullName, repositoryFullName)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(projectLinksTable)
        .set({
          externalProjectName,
          externalTeamId,
          repositoryExternalId,
          updatedAt: new Date(),
        })
        .where(eq(projectLinksTable.id, existing[0].id));
      return existing[0].id;
    }

    const [inserted] = await db
      .insert(projectLinksTable)
      .values({
        organizationId,
        provider: "LINEAR",
        externalProjectId,
        externalProjectName,
        externalTeamId,
        repositoryProvider: "GITHUB",
        repositoryExternalId,
        repositoryFullName,
      })
      .returning();

    return inserted.id;
  }

  /**
   * Synchronizes all issues for a Linear project.
   */
  async syncProjectIssues(
    organizationId: string,
    externalProjectId: string,
    client: ILinearClient
  ): Promise<ProjectSyncSummary> {
    const issues = await client.getIssues({ projectId: externalProjectId });

    let upsertedCount = 0;
    let staleRejectedCount = 0;
    let advisoryLinksCreated = 0;

    for (const issueDetail of issues) {
      const res = await this.upsertLinearIssue(organizationId, issueDetail);
      if (res.status === "UPSERTED") {
        upsertedCount++;
        if (res.advisoryDeliverableLinked) {
          advisoryLinksCreated++;
        }
      } else {
        staleRejectedCount++;
      }
    }

    // Update connection last_sync_at
    await db
      .update(linearConnectionsTable)
      .set({
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(linearConnectionsTable.organizationId, organizationId));

    return {
      projectId: externalProjectId,
      totalFetched: issues.length,
      upsertedCount,
      staleRejectedCount,
      advisoryLinksCreated,
    };
  }
}
