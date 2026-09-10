import type { LinearIssue, PullRequest } from '../types.js';

export interface FalseNegativeTestCase {
  id: string;
  category: 'indirect-capability' | 'schema-migration' | 'innocent-names' | 'permission-subsystem';
  description: string;
  issue: LinearIssue;
  pullRequest: PullRequest;
  expectedState: 'CHANGE_REQUIRED';
  expectedTaxonomy: 'SCOPE_EXPANSION' | 'EXPLICITLY_EXCLUDED';
  rationale: string;
}

export const FALSE_NEGATIVE_CASES: FalseNegativeTestCase[] = [
  {
    id: 'fn-01-innocent-names',
    category: 'innocent-names',
    description: 'Sneaking in multi-tenant team management under generic handler names',
    issue: {
      id: 'ENG-215',
      identifier: 'ENG-215',
      title: 'Update entity association handling',
      description: 'Add generic membership mapping and permission checks between user entities.',
      status: 'Done',
      estimateHours: 16,
    },
    pullRequest: {
      id: 'pr_fn_01',
      number: 1215,
      title: 'chore: update internal entity links and access decorators',
      body: 'Addresses ENG-215. Adds role hierarchies across entity types.',
      baseBranch: 'main',
      headBranch: 'feat/entity-links',
      headSha: '123456789abcdef0123456789abcdef012345678',
      filesChanged: 4,
      additions: 210,
      deletions: 12,
      changedFiles: [
        { path: 'src/services/entity-registry.ts', module: 'services', additions: 75, deletions: 4 },
        { path: 'src/common/access-checker.ts', module: 'common', additions: 65, deletions: 2 },
        { path: 'src/routes/registry.ts', module: 'routes', additions: 45, deletions: 4 },
        { path: 'src/db/migrations/20260905_memberships.sql', module: 'db', additions: 25, deletions: 2 },
      ],
    },
    expectedState: 'CHANGE_REQUIRED',
    expectedTaxonomy: 'EXPLICITLY_EXCLUDED',
    rationale: 'Capabilities must be extracted by inspecting AST/tokens and metadata, not merely trusting naive filenames.',
  },
  {
    id: 'fn-02-schema-migration',
    category: 'schema-migration',
    description: 'Schema migration quietly introducing multi-tenant organization columns and roles',
    issue: {
      id: 'ENG-216',
      identifier: 'ENG-216',
      title: 'Database table alterations for user metadata',
      description: 'Add organization_id, tenant_tier, and role_mask to users table.',
      status: 'In Progress',
      estimateHours: 12,
    },
    pullRequest: {
      id: 'pr_fn_02',
      number: 1216,
      title: 'feat(db): add tenant mapping columns and role indices',
      body: 'Closes ENG-216. Extends user schema with tenant foreign keys.',
      baseBranch: 'main',
      headBranch: 'db/tenant-schema',
      headSha: '23456789abcdef0123456789abcdef0123456789',
      filesChanged: 3,
      additions: 140,
      deletions: 6,
      changedFiles: [
        { path: 'src/db/migrations/004_tenant_tables.sql', module: 'db', additions: 85, deletions: 0 },
        { path: 'src/db/schema.ts', module: 'db', additions: 40, deletions: 4 },
        { path: 'src/models/tenant.ts', module: 'models', additions: 15, deletions: 2 },
      ],
    },
    expectedState: 'CHANGE_REQUIRED',
    expectedTaxonomy: 'EXPLICITLY_EXCLUDED',
    rationale: 'Database migrations introducing multi-tenant structures violate single-tenant §4.2 baseline.',
  },
  {
    id: 'fn-03-permission-subsystem',
    category: 'permission-subsystem',
    description: 'Adding enterprise SSO / SAML assertions disguised as auth utility',
    issue: {
      id: 'ENG-217',
      identifier: 'ENG-217',
      title: 'Add enterprise federation parser',
      description: 'Support parsing SAML 2.0 XML responses and Okta tokens.',
      status: 'In Progress',
      estimateHours: 24,
    },
    pullRequest: {
      id: 'pr_fn_03',
      number: 1217,
      title: 'feat(auth): add xml assertion parser for enterprise tokens',
      body: 'Fixes ENG-217. Parses SAML 2.0 XML auth assertions.',
      baseBranch: 'main',
      headBranch: 'feat/enterprise-saml',
      headSha: '3456789abcdef0123456789abcdef0123456789a',
      filesChanged: 5,
      additions: 290,
      deletions: 8,
      changedFiles: [
        { path: 'src/auth/saml.ts', module: 'auth', additions: 130, deletions: 2 },
        { path: 'src/auth/saml-parser.ts', module: 'auth', additions: 95, deletions: 0 },
        { path: 'src/routes/sso.ts', module: 'routes', additions: 45, deletions: 4 },
        { path: 'src/config/idp.ts', module: 'config', additions: 20, deletions: 2 },
      ],
    },
    expectedState: 'CHANGE_REQUIRED',
    expectedTaxonomy: 'EXPLICITLY_EXCLUDED',
    rationale: 'SSO and SAML 2.0 are explicitly excluded by contract §4.2.',
  },
];
