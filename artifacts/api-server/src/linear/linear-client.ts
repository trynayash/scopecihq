/**
 * Typed Linear API client abstraction for ScopeCI Alpha Phase 3.
 * Supports both Real GraphQL execution and deterministic in-memory simulation (MockLinearClient).
 */

export interface LinearWorkspace {
  id: string;
  name: string;
  urlKey?: string;
}

export interface LinearUser {
  id: string;
  name: string;
  email?: string;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

export interface LinearProject {
  id: string;
  name: string;
  state?: string;
  description?: string;
}

export interface LinearIssueDetail {
  id: string; // Linear UUID (e.g. "a23b1c90-...")
  identifier: string; // Issue key (e.g. "ENG-184")
  title: string;
  description?: string;
  state: string; // e.g. "In Progress", "Done"
  estimate?: number;
  url: string;
  projectId?: string;
  teamId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinearWebhook {
  id: string;
  url: string;
  enabled: boolean;
  secret?: string;
}

/* ==================================================================
   Typed Recoverable Error Classes
   ================================================================== */

export class LinearNotFoundError extends Error {
  constructor(message: string = "Linear resource not found") {
    super(message);
    this.name = "LinearNotFoundError";
  }
}

export class LinearAuthError extends Error {
  public statusCode: number;
  constructor(message: string = "Linear authentication failed", statusCode: number = 401) {
    super(message);
    this.name = "LinearAuthError";
    this.statusCode = statusCode;
  }
}

export class LinearRateLimitError extends Error {
  public retryAfterMs: number;
  constructor(message: string = "Linear API rate limit exceeded", retryAfterMs: number = 60000) {
    super(message);
    this.name = "LinearRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class LinearApiError extends Error {
  public statusCode: number;
  constructor(message: string = "Linear API error", statusCode: number = 500) {
    super(message);
    this.name = "LinearApiError";
    this.statusCode = statusCode;
  }
}

/* ==================================================================
   ILinearClient Interface
   ================================================================== */

export interface ILinearClient {
  getViewer(): Promise<LinearUser>;
  getWorkspace(): Promise<LinearWorkspace>;
  getTeams(): Promise<LinearTeam[]>;
  getTeam(id: string): Promise<LinearTeam | null>;
  getProjects(teamId?: string): Promise<LinearProject[]>;
  getProject(id: string): Promise<LinearProject | null>;
  getIssueByIdentifier(identifier: string): Promise<LinearIssueDetail | null>;
  getIssue(id: string): Promise<LinearIssueDetail | null>;
  getIssues(params?: { projectId?: string; teamId?: string; limit?: number }): Promise<LinearIssueDetail[]>;
  getWebhook(id: string): Promise<LinearWebhook | null>;
  createWebhook(params: { url: string; teamId?: string; resourceTypes: string[] }): Promise<{ id: string; secret: string }>;
  deleteWebhook(id: string): Promise<boolean>;
}

/* ==================================================================
   MockLinearClient (Deterministic Testing Implementation)
   ================================================================== */

export class MockLinearClient implements ILinearClient {
  private workspace: LinearWorkspace = {
    id: "lin_ws_northstar",
    name: "Northstar Technologies",
    urlKey: "northstar",
  };

  private viewer: LinearUser = {
    id: "lin_usr_admin",
    name: "Lead Architect",
    email: "pm@northstar.agency",
  };

  private teams: Map<string, LinearTeam> = new Map([
    ["lin_team_eng", { id: "lin_team_eng", key: "ENG", name: "Engineering" }],
  ]);

  private projects: Map<string, LinearProject> = new Map([
    [
      "lin_proj_api",
      {
        id: "lin_proj_api",
        name: "API Platform",
        state: "started",
        description: "Northstar Core API Services and Infrastructure",
      },
    ],
  ]);

  private issues: Map<string, LinearIssueDetail> = new Map();
  private nextError: Error | null = null;
  private webhooks: Map<string, LinearWebhook> = new Map();

  constructor() {
    this.seedDefaultData();
  }

  private seedDefaultData(): void {
    const defaultIssues: LinearIssueDetail[] = [
      {
        id: "lin_iss_1842_rbac",
        identifier: "ENG-184",
        title: "ENG-184 · Add organization-level permissions and roles",
        description: "Add organization-level permissions, role-based access control (RBAC), and team invites.",
        state: "In Progress",
        estimate: 8,
        url: "https://linear.app/northstar/issue/ENG-184/rbac",
        projectId: "lin_proj_api",
        teamId: "lin_team_eng",
        createdAt: new Date("2026-09-01T10:00:00Z"),
        updatedAt: new Date("2026-09-08T09:00:00Z"),
      },
      {
        id: "lin_iss_101_pwd",
        identifier: "ENG-101",
        title: "ENG-101 · Implement password reset workflow",
        description: "User password reset via email token",
        state: "Done",
        estimate: 3,
        url: "https://linear.app/northstar/issue/ENG-101/pwd",
        projectId: "lin_proj_api",
        teamId: "lin_team_eng",
        createdAt: new Date("2026-09-02T10:00:00Z"),
        updatedAt: new Date("2026-09-05T15:00:00Z"),
      },
      {
        id: "lin_iss_202_csv",
        identifier: "ENG-202",
        title: "ENG-202 · Add CSV export to audit log table",
        description: "Allow exporting audit events to CSV format",
        state: "In Review",
        estimate: 5,
        url: "https://linear.app/northstar/issue/ENG-202/csv",
        projectId: "lin_proj_api",
        teamId: "lin_team_eng",
        createdAt: new Date("2026-09-03T10:00:00Z"),
        updatedAt: new Date("2026-09-07T12:00:00Z"),
      },
    ];

    for (const issue of defaultIssues) {
      this.issues.set(issue.id, issue);
      this.issues.set(issue.identifier, issue);
    }
  }

  public setNextError(err: Error | null): void {
    this.nextError = err;
  }

  private checkError(): void {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }
  }

  public addIssue(issue: LinearIssueDetail): void {
    this.issues.set(issue.id, issue);
    this.issues.set(issue.identifier, issue);
  }

  public addProject(project: LinearProject): void {
    this.projects.set(project.id, project);
  }

  public addTeam(team: LinearTeam): void {
    this.teams.set(team.id, team);
  }

  async getViewer(): Promise<LinearUser> {
    this.checkError();
    return { ...this.viewer };
  }

  async getWorkspace(): Promise<LinearWorkspace> {
    this.checkError();
    return { ...this.workspace };
  }

  async getTeams(): Promise<LinearTeam[]> {
    this.checkError();
    return Array.from(this.teams.values());
  }

  async getTeam(id: string): Promise<LinearTeam | null> {
    this.checkError();
    return this.teams.get(id) || null;
  }

  async getProjects(_teamId?: string): Promise<LinearProject[]> {
    this.checkError();
    return Array.from(this.projects.values());
  }

  async getProject(id: string): Promise<LinearProject | null> {
    this.checkError();
    return this.projects.get(id) || null;
  }

  async getIssueByIdentifier(identifier: string): Promise<LinearIssueDetail | null> {
    this.checkError();
    const issue = this.issues.get(identifier.toUpperCase().trim());
    return issue ? { ...issue } : null;
  }

  async getIssue(id: string): Promise<LinearIssueDetail | null> {
    this.checkError();
    const issue = this.issues.get(id);
    return issue ? { ...issue } : null;
  }

  async getIssues(params?: { projectId?: string; teamId?: string; limit?: number }): Promise<LinearIssueDetail[]> {
    this.checkError();
    const uniqueMap = new Map<string, LinearIssueDetail>();
    for (const issue of this.issues.values()) {
      if (params?.projectId && issue.projectId !== params.projectId) continue;
      if (params?.teamId && issue.teamId !== params.teamId) continue;
      uniqueMap.set(issue.id, issue);
    }
    let list = Array.from(uniqueMap.values());
    if (params?.limit) {
      list = list.slice(0, params.limit);
    }
    return list;
  }

  async getWebhook(id: string): Promise<LinearWebhook | null> {
    this.checkError();
    return this.webhooks.get(id) || null;
  }

  async createWebhook(params: { url: string; teamId?: string; resourceTypes: string[] }): Promise<{ id: string; secret: string }> {
    this.checkError();
    const id = `lin_wh_${Date.now()}`;
    const secret = `whsec_${Math.random().toString(36).substring(2)}`;
    this.webhooks.set(id, { id, url: params.url, enabled: true, secret });
    return { id, secret };
  }

  async deleteWebhook(id: string): Promise<boolean> {
    this.checkError();
    return this.webhooks.delete(id);
  }
}

/* ==================================================================
   RealLinearClient (Production GraphQL Implementation)
   ================================================================== */

export class RealLinearClient implements ILinearClient {
  private accessToken: string;
  private endpoint: string;

  constructor(accessToken: string, endpoint: string = "https://api.linear.app/graphql") {
    this.accessToken = accessToken;

    // SSRF Guard: Validate endpoint protocol and hostname
    try {
      const parsed = new URL(endpoint);
      if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
        throw new Error("Linear GraphQL endpoint must use HTTPS in production.");
      }

      const host = parsed.hostname.toLowerCase();
      const isPrivateOrLoopback =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.startsWith("169.254.") ||
        host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);

      if (process.env.NODE_ENV === "production" && isPrivateOrLoopback) {
        throw new Error(`SSRF Blocked: Linear endpoint cannot target private/internal host: ${host}`);
      }

      this.endpoint = endpoint;
    } catch (err: any) {
      throw new Error(`Invalid Linear API endpoint: ${err.message}`);
    }
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>, retries: number = 2): Promise<T> {
    let attempt = 0;
    while (attempt <= retries) {
      attempt++;
      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify({ query, variables }),
        });

        if (response.status === 401 || response.status === 403) {
          throw new LinearAuthError(`Linear authentication failed (${response.status})`, response.status);
        }

        if (response.status === 429) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
          if (attempt <= retries) {
            await new Promise((res) => setTimeout(res, retryAfterSec * 1000));
            continue;
          }
          throw new LinearRateLimitError("Linear rate limit exceeded", retryAfterSec * 1000);
        }

        if (!response.ok) {
          throw new LinearApiError(`Linear API responded with status ${response.status}`, response.status);
        }

        const json = (await response.json()) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };

        if (json.errors && json.errors.length > 0) {
          const first = json.errors[0];
          if (first.message.toLowerCase().includes("not found") || first.extensions?.code === "NOT_FOUND") {
            throw new LinearNotFoundError(first.message);
          }
          if (first.message.toLowerCase().includes("authentication") || first.extensions?.code === "UNAUTHENTICATED") {
            throw new LinearAuthError(first.message, 401);
          }
          throw new LinearApiError(first.message, 400);
        }

        if (!json.data) {
          throw new LinearApiError("Linear API returned empty data payload", 500);
        }

        return json.data;
      } catch (err: unknown) {
        if (
          err instanceof LinearAuthError ||
          err instanceof LinearNotFoundError ||
          err instanceof LinearRateLimitError
        ) {
          throw err;
        }

        if (attempt <= retries) {
          // Exponential backoff
          await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt)));
          continue;
        }
        if (err instanceof Error) {
          throw new LinearApiError(`Linear network failure: ${err.message}`, 500);
        }
        throw new LinearApiError("Unknown Linear GraphQL error", 500);
      }
    }

    throw new LinearApiError("Exceeded max retries for Linear GraphQL request", 500);
  }

  async getViewer(): Promise<LinearUser> {
    const data = await this.graphql<{ viewer: { id: string; name: string; email?: string } }>(
      `query Viewer { viewer { id name email } }`
    );
    return data.viewer;
  }

  async getWorkspace(): Promise<LinearWorkspace> {
    const data = await this.graphql<{ organization: { id: string; name: string; urlKey?: string } }>(
      `query Organization { organization { id name urlKey } }`
    );
    return data.organization;
  }

  async getTeams(): Promise<LinearTeam[]> {
    const data = await this.graphql<{ teams: { nodes: Array<{ id: string; key: string; name: string }> } }>(
      `query Teams { teams { nodes { id key name } } }`
    );
    return data.teams.nodes;
  }

  async getTeam(id: string): Promise<LinearTeam | null> {
    try {
      const data = await this.graphql<{ team: { id: string; key: string; name: string } }>(
        `query Team($id: String!) { team(id: $id) { id key name } }`,
        { id }
      );
      return data.team;
    } catch (err) {
      if (err instanceof LinearNotFoundError) return null;
      throw err;
    }
  }

  async getProjects(teamId?: string): Promise<LinearProject[]> {
    const query = teamId
      ? `query TeamProjects($teamId: String!) { team(id: $teamId) { projects { nodes { id name state description } } } }`
      : `query Projects { projects { nodes { id name state description } } }`;
    const data = await this.graphql<any>(query, { teamId });
    const nodes = teamId ? data.team?.projects?.nodes : data.projects?.nodes;
    return nodes || [];
  }

  async getProject(id: string): Promise<LinearProject | null> {
    try {
      const data = await this.graphql<{ project: { id: string; name: string; state?: string; description?: string } }>(
        `query Project($id: String!) { project(id: $id) { id name state description } }`,
        { id }
      );
      return data.project;
    } catch (err) {
      if (err instanceof LinearNotFoundError) return null;
      throw err;
    }
  }

  async getIssueByIdentifier(identifier: string): Promise<LinearIssueDetail | null> {
    try {
      const data = await this.graphql<{
        issue: {
          id: string;
          identifier: string;
          title: string;
          description?: string;
          state: { name: string };
          estimate?: number;
          url: string;
          project?: { id: string };
          team?: { id: string };
          createdAt: string;
          updatedAt: string;
        };
      }>(
        `query IssueByIdentifier($id: String!) {
          issue(id: $id) {
            id identifier title description estimate url
            state { name }
            project { id }
            team { id }
            createdAt updatedAt
          }
        }`,
        { id: identifier }
      );

      if (!data.issue) return null;
      return {
        id: data.issue.id,
        identifier: data.issue.identifier,
        title: data.issue.title,
        description: data.issue.description,
        state: data.issue.state?.name || "Unknown",
        estimate: data.issue.estimate,
        url: data.issue.url,
        projectId: data.issue.project?.id,
        teamId: data.issue.team?.id,
        createdAt: new Date(data.issue.createdAt),
        updatedAt: new Date(data.issue.updatedAt),
      };
    } catch (err) {
      if (err instanceof LinearNotFoundError) return null;
      throw err;
    }
  }

  async getIssue(id: string): Promise<LinearIssueDetail | null> {
    return this.getIssueByIdentifier(id);
  }

  async getIssues(params?: { projectId?: string; teamId?: string; limit?: number }): Promise<LinearIssueDetail[]> {
    const data = await this.graphql<{
      issues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          description?: string;
          state: { name: string };
          estimate?: number;
          url: string;
          project?: { id: string };
          team?: { id: string };
          createdAt: string;
          updatedAt: string;
        }>;
      };
    }>(
      `query Issues($first: Int, $projectId: ID, $teamId: ID) {
        issues(first: $first, filter: { project: { id: { eq: $projectId } }, team: { id: { eq: $teamId } } }) {
          nodes {
            id identifier title description estimate url
            state { name }
            project { id }
            team { id }
            createdAt updatedAt
          }
        }
      }`,
      {
        first: params?.limit || 50,
        projectId: params?.projectId,
        teamId: params?.teamId,
      }
    );

    return (data.issues?.nodes || []).map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state?.name || "Unknown",
      estimate: issue.estimate,
      url: issue.url,
      projectId: issue.project?.id,
      teamId: issue.team?.id,
      createdAt: new Date(issue.createdAt),
      updatedAt: new Date(issue.updatedAt),
    }));
  }

  async getWebhook(id: string): Promise<LinearWebhook | null> {
    try {
      const data = await this.graphql<{ webhook: { id: string; url: string; enabled: boolean } }>(
        `query Webhook($id: String!) { webhook(id: $id) { id url enabled } }`,
        { id }
      );
      return data.webhook;
    } catch (err) {
      if (err instanceof LinearNotFoundError) return null;
      throw err;
    }
  }

  async createWebhook(params: { url: string; teamId?: string; resourceTypes: string[] }): Promise<{ id: string; secret: string }> {
    const data = await this.graphql<{ webhookCreate: { success: boolean; webhook: { id: string; secret: string } } }>(
      `mutation CreateWebhook($input: WebhookCreateInput!) {
        webhookCreate(input: $input) {
          success
          webhook { id secret }
        }
      }`,
      {
        input: {
          url: params.url,
          teamId: params.teamId,
          resourceTypes: params.resourceTypes,
          allPublicTeams: !params.teamId,
        },
      }
    );
    return data.webhookCreate.webhook;
  }

  async deleteWebhook(id: string): Promise<boolean> {
    const data = await this.graphql<{ webhookDelete: { success: boolean } }>(
      `mutation DeleteWebhook($id: String!) { webhookDelete(id: $id) { success } }`,
      { id }
    );
    return data.webhookDelete.success;
  }
}
