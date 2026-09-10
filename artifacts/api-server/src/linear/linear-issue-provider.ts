import type { LinearIssue } from "@workspace/commercial-engine";
import type { IssueProject, IssueProvider, IssueTeam } from "../github/issue-provider.js";
import {
  type ILinearClient,
  LinearNotFoundError,
} from "./linear-client.js";
import { normalizeLinearIssueForEngine } from "./normalizer.js";

/**
 * Production Linear issue provider implementing the Phase 2 IssueProvider interface.
 * Connects the GitHub Webhook pipeline to the real Linear API client (or MockLinearClient in tests).
 */
export class LinearIssueProvider implements IssueProvider {
  private client: ILinearClient;
  private deliverableResolver?: (issueIdentifier: string) => Promise<string | undefined>;

  constructor(
    client: ILinearClient,
    deliverableResolver?: (issueIdentifier: string) => Promise<string | undefined>
  ) {
    this.client = client;
    this.deliverableResolver = deliverableResolver;
  }

  async resolveIssue(identifier: string): Promise<LinearIssue | null> {
    const trimmed = identifier.trim().toUpperCase();
    try {
      const issueDetail = await this.client.getIssueByIdentifier(trimmed);
      if (!issueDetail) {
        return null;
      }

      let deliverableId: string | undefined;
      if (this.deliverableResolver) {
        deliverableId = await this.deliverableResolver(issueDetail.identifier);
      }

      return normalizeLinearIssueForEngine(issueDetail, deliverableId);
    } catch (err: unknown) {
      if (err instanceof LinearNotFoundError) {
        return null;
      }
      // Re-throw typed errors (LinearAuthError, LinearRateLimitError, LinearApiError)
      throw err;
    }
  }

  async fetchIssue(id: string): Promise<LinearIssue | null> {
    try {
      const issueDetail = await this.client.getIssue(id);
      if (!issueDetail) {
        return null;
      }

      let deliverableId: string | undefined;
      if (this.deliverableResolver) {
        deliverableId = await this.deliverableResolver(issueDetail.identifier);
      }

      return normalizeLinearIssueForEngine(issueDetail, deliverableId);
    } catch (err: unknown) {
      if (err instanceof LinearNotFoundError) {
        return null;
      }
      throw err;
    }
  }

  async fetchProject(id: string): Promise<IssueProject | null> {
    try {
      const project = await this.client.getProject(id);
      if (!project) {
        return null;
      }
      return {
        id: project.id,
        name: project.name,
      };
    } catch (err: unknown) {
      if (err instanceof LinearNotFoundError) {
        return null;
      }
      throw err;
    }
  }

  async fetchTeam(id: string): Promise<IssueTeam | null> {
    try {
      const team = await this.client.getTeam(id);
      if (!team) {
        return null;
      }
      return {
        id: team.id,
        name: team.name,
      };
    } catch (err: unknown) {
      if (err instanceof LinearNotFoundError) {
        return null;
      }
      throw err;
    }
  }
}
