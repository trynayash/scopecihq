import type { LinearIssue } from "@workspace/commercial-engine";
import type { LinearIssueDetail, LinearProject, LinearTeam, LinearWorkspace } from "./linear-client.js";

export interface NormalizedProject {
  id: string;
  name: string;
  state?: string;
  description?: string;
}

export interface NormalizedTeam {
  id: string;
  key: string;
  name: string;
}

export interface NormalizedWorkspace {
  id: string;
  name: string;
  urlKey?: string;
}

/**
 * Normalizes a Linear issue detail into the @workspace/commercial-engine LinearIssue type.
 */
export function normalizeLinearIssueForEngine(
  detail: LinearIssueDetail,
  deliverableId?: string
): LinearIssue {
  return {
    id: detail.identifier.toUpperCase(),
    title: detail.title,
    description: detail.description || "",
    status: detail.state,
    estimateHours: detail.estimate,
    deliverableId,
  };
}

/**
 * Normalizes a Linear issue detail into the database `issuesTable` record format.
 */
export function normalizeLinearIssueForDb(
  detail: LinearIssueDetail,
  organizationId: string
) {
  return {
    organizationId,
    externalProvider: "LINEAR" as const,
    externalId: detail.id, // Stable Linear UUID
    identifier: detail.identifier.toUpperCase(), // e.g. "ENG-184"
    title: detail.title,
    description: detail.description || "",
    status: detail.state,
    estimate: detail.estimate ?? null,
    url: detail.url,
    lastSyncedAt: new Date(),
    updatedAt: detail.updatedAt,
  };
}

export function normalizeLinearProject(project: LinearProject): NormalizedProject {
  return {
    id: project.id,
    name: project.name,
    state: project.state,
    description: project.description,
  };
}

export function normalizeLinearTeam(team: LinearTeam): NormalizedTeam {
  return {
    id: team.id,
    key: team.key.toUpperCase(),
    name: team.name,
  };
}

export function normalizeLinearWorkspace(ws: LinearWorkspace): NormalizedWorkspace {
  return {
    id: ws.id,
    name: ws.name,
    urlKey: ws.urlKey,
  };
}
