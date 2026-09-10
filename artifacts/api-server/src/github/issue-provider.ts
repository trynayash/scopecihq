import type { LinearIssue } from "@workspace/commercial-engine";

export interface IssueProject {
  id: string;
  name: string;
}

export interface IssueTeam {
  id: string;
  name: string;
}

/**
 * Clean provider interface isolating ScopeCI from direct Linear API logic.
 * Real Linear OAuth and Webhook handlers will plug in during Phase 3.
 */
export interface IssueProvider {
  resolveIssue(identifier: string): Promise<LinearIssue | null>;
  fetchIssue(id: string): Promise<LinearIssue | null>;
  fetchProject(id: string): Promise<IssueProject | null>;
  fetchTeam(id: string): Promise<IssueTeam | null>;
}

/**
 * Deterministic MockIssueProvider used for tests and Phase 2 Alpha verification.
 */
export class MockIssueProvider implements IssueProvider {
  private issues: Map<string, LinearIssue> = new Map();
  private projects: Map<string, IssueProject> = new Map();
  private teams: Map<string, IssueTeam> = new Map();
  private shouldFailWith: Error | null = null;

  constructor() {
    this.seedDefaultFixtures();
  }

  private seedDefaultFixtures(): void {
    // Canonical Golden Fixtures matching Phase 0 & Phase 1
    const defaultIssues: LinearIssue[] = [
      {
        id: "ENG-101",
        title: "Implement password reset token and flow",
        description: "Allow users to request a password reset email and enter a new password.",
        status: "In Progress",
        estimateHours: 8,
        deliverableId: "deliv_auth",
      },
      {
        id: "ENG-184",
        title: "Add organization-level permissions and roles",
        description: "Introduce multi-member organizations, team invite endpoints, and RBAC middleware.",
        status: "In Review",
        estimateHours: 20,
        deliverableId: "deliv_auth",
      },
      {
        id: "ENG-204",
        title: "Export audit logs as CSV",
        description: "Add a button to download historical audit events as a formatted CSV file.",
        status: "In Progress",
        estimateHours: 6,
        deliverableId: "deliv_audit",
      },
    ];

    for (const issue of defaultIssues) {
      this.issues.set(issue.id.toUpperCase(), issue);
    }

    this.projects.set("lin_proj_northstar_api", {
      id: "lin_proj_northstar_api",
      name: "Northstar API Core Platform",
    });

    this.teams.set("team_core_eng", {
      id: "team_core_eng",
      name: "Core Engineering",
    });
  }

  public setFailure(error: Error | null): void {
    this.shouldFailWith = error;
  }

  public registerIssue(issue: LinearIssue): void {
    this.issues.set(issue.id.toUpperCase(), issue);
  }

  async resolveIssue(identifier: string): Promise<LinearIssue | null> {
    if (this.shouldFailWith) {
      throw this.shouldFailWith;
    }
    const normalized = identifier.trim().toUpperCase();
    return this.issues.get(normalized) || null;
  }

  async fetchIssue(id: string): Promise<LinearIssue | null> {
    return this.resolveIssue(id);
  }

  async fetchProject(id: string): Promise<IssueProject | null> {
    if (this.shouldFailWith) {
      throw this.shouldFailWith;
    }
    return this.projects.get(id) || null;
  }

  async fetchTeam(id: string): Promise<IssueTeam | null> {
    if (this.shouldFailWith) {
      throw this.shouldFailWith;
    }
    return this.teams.get(id) || null;
  }
}
