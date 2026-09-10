import type {
  ChangeOrder,
  LinearIssue,
  PullRequest,
  ScopeBaseline,
} from '../types.js';

/* ------------------------------------------------------------------ */
/* Scope Baseline v1 — Initial SOW Contract                            */
/* ------------------------------------------------------------------ */

export const SAMPLE_BASELINE_V1: ScopeBaseline = {
  id: 'baseline_v1',
  version: 'v1',
  contractId: 'contract_northstar_api',
  title: 'Northstar API Platform — Fixed Scope Milestone 1',
  description: 'Fixed-price engineering milestone covering user authentication and profile management.',
  status: 'active',
  createdAt: '2026-08-01T00:00:00Z',
  clauses: [
    {
      id: 'clause_4_2',
      clauseRef: '§4.2',
      title: 'User Authentication & Account Management',
      legalText:
        'The agency shall deliver single-tenant user authentication utilizing email/password and magic link tokens. Includes password reset, email verification, profile picture upload, and account deletion. Explicitly excludes multi-tenant organization hierarchies, team invitations, and role-based access control (RBAC), which shall require a separate Change Order.',
      inclusions: ['authentication', 'password_reset', 'email_verification', 'profile_management', 'account_settings'],
      exclusions: ['organization_rbac', 'team_invitations', 'multi_tenancy', 'custom_roles'],
    },
    {
      id: 'clause_4_3',
      clauseRef: '§4.3',
      title: 'Activity Logging & Auditing',
      legalText:
        'Standard audit logging of sign-in events and user profile changes stored in PostgreSQL and rendered in the user settings view.',
      inclusions: ['audit_logging', 'session_history'],
      exclusions: ['scheduled_reports', 'advanced_bi', 'third_party_siem'],
    },
  ],
  deliverables: [
    {
      id: 'deliv_auth',
      clauseId: 'clause_4_2',
      title: 'User Authentication Subsystem',
      scopeBoundary: 'Single-user login, password reset flow, session cookies, and profile management.',
      keywords: ['auth', 'login', 'password_reset', 'session', 'user', 'profile'],
      estimatedHours: { min: 40, max: 60 },
      budgetAllocated: 7500,
    },
    {
      id: 'deliv_audit',
      clauseId: 'clause_4_3',
      title: 'Audit Logging',
      scopeBoundary: 'Activity logs viewable in account settings.',
      keywords: ['audit', 'logs', 'activity'],
      estimatedHours: { min: 15, max: 25 },
      budgetAllocated: 3000,
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Linear Issues                                                      */
/* ------------------------------------------------------------------ */

export const SAMPLE_ISSUES: Record<string, LinearIssue> = {
  // Case 1: Clearly In Scope
  'ENG-101': {
    id: 'ENG-101',
    title: 'Implement password reset token and flow',
    description: 'Allow users to request a password reset email and enter a new password.',
    status: 'In Progress',
    estimateHours: 8,
    deliverableId: 'deliv_auth',
  },

  // Case 2: Scope Expansion (Uncontracted Org RBAC)
  'ENG-184': {
    id: 'ENG-184',
    title: 'Add organization-level permissions and roles',
    description: 'Introduce multi-member organizations, team invite endpoints, and RBAC middleware.',
    status: 'In Review',
    estimateHours: 20,
    deliverableId: 'deliv_auth',
  },

  // Case 3: Ambiguous Scope
  'ENG-204': {
    id: 'ENG-204',
    title: 'Export audit logs as CSV',
    description: 'Add a button to download historical audit events as a formatted CSV file.',
    status: 'In Progress',
    estimateHours: 6,
    deliverableId: 'deliv_audit',
  },
};

/* ------------------------------------------------------------------ */
/* Pull Requests                                                      */
/* ------------------------------------------------------------------ */

// Case 1: Clearly In Scope PR
export const SAMPLE_PR_IN_SCOPE: PullRequest = {
  id: 'pr_1042',
  number: 1042,
  title: 'feat(auth): add password reset endpoints and UI',
  branch: 'feat/eng-101-password-reset',
  base: 'main',
  author: 'alex-dev',
  issueId: 'ENG-101',
  filesChanged: 4,
  additions: 120,
  deletions: 12,
  detectedSubsystems: ['authentication', 'password_reset'],
  changedFiles: [
    { path: 'src/routes/auth/reset.ts', status: 'added', module: 'auth', linesAdded: 60, linesDeleted: 0 },
    { path: 'src/views/reset-password.tsx', status: 'added', module: 'ui', linesAdded: 50, linesDeleted: 0 },
    { path: 'src/lib/tokens.ts', status: 'modified', module: 'auth', linesAdded: 10, linesDeleted: 12 },
  ],
};

// Case 2: Scope Expansion PR (#1842 matching landing page!)
export const SAMPLE_PR_OUT_OF_SCOPE: PullRequest = {
  id: 'pr_1842',
  number: 1842,
  title: 'Add organization-level permissions',
  branch: 'feature/org-permissions',
  base: 'main',
  author: 'dev-lead',
  issueId: 'ENG-184',
  filesChanged: 14,
  additions: 386,
  deletions: 22,
  detectedSubsystems: ['authentication', 'organization_rbac', 'team_invitations'],
  changedFiles: [
    { path: 'src/db/schema/organizations.ts', status: 'added', module: 'database', linesAdded: 45, linesDeleted: 0 },
    { path: 'src/db/schema/memberships.ts', status: 'added', module: 'database', linesAdded: 38, linesDeleted: 0 },
    { path: 'src/middleware/rbac.ts', status: 'added', module: 'security', linesAdded: 72, linesDeleted: 0 },
    { path: 'src/routes/invitations.ts', status: 'added', module: 'api', linesAdded: 80, linesDeleted: 0 },
    { path: 'src/views/settings/roles.tsx', status: 'added', module: 'frontend', linesAdded: 151, linesDeleted: 22 },
  ],
};

// Case 3: Ambiguous PR
export const SAMPLE_PR_AMBIGUOUS: PullRequest = {
  id: 'pr_2042',
  number: 2042,
  title: 'feat(audit): export audit events as CSV',
  branch: 'eng-204-audit-csv-export',
  base: 'main',
  author: 'sam-engineer',
  issueId: 'ENG-204',
  filesChanged: 3,
  additions: 85,
  deletions: 5,
  detectedSubsystems: ['audit_logging', 'export_utility'],
  changedFiles: [
    { path: 'src/routes/audit/export.ts', status: 'added', module: 'api', linesAdded: 50, linesDeleted: 0 },
    { path: 'src/utils/csv-generator.ts', status: 'added', module: 'utility', linesAdded: 35, linesDeleted: 5 },
  ],
};

// Case 5: Unlinked PR
export const SAMPLE_PR_UNLINKED: PullRequest = {
  id: 'pr_9999',
  number: 9999,
  title: 'fix: patch database session pool leak',
  branch: 'patch/db-pool',
  base: 'main',
  author: 'ops-dev',
  filesChanged: 2,
  additions: 15,
  deletions: 8,
  detectedSubsystems: ['database_pool'],
  changedFiles: [
    { path: 'src/db/pool.ts', status: 'modified', module: 'db', linesAdded: 15, linesDeleted: 8 },
  ],
};

/* ------------------------------------------------------------------ */
/* Change Order #12                                                   */
/* ------------------------------------------------------------------ */

export const SAMPLE_CHANGE_ORDER_12: ChangeOrder = {
  id: 'CO-12',
  contractId: 'contract_northstar_api',
  baselineVersion: 'v2',
  title: 'Change Order #12: Organization Roles & Invitations',
  reason: 'Client requested team multi-tenancy and RBAC controls for enterprise tier pilot.',
  authorizedSubsystems: ['organization_rbac', 'team_invitations'],
  hours: { min: 18, max: 24 },
  amount: 3150,
  status: 'APPROVED',
  approvedBy: 'Client VP of Eng (signed 2026-09-08)',
  approvedAt: '2026-09-08T14:30:00Z',
};
