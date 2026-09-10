import { eq } from 'drizzle-orm';
import { db } from './index.js';
import {
  changeOrdersTable,
  commercialApprovalsTable,
  commercialEvaluationsTable,
  commercialEventsTable,
  contractClausesTable,
  contractsTable,
  deliverablesTable,
  issueDeliverableLinksTable,
  issuesTable,
  organizationsTable,
  prDiffAnalysesTable,
  prIssueLinksTable,
  projectLinksTable,
  pullRequestsTable,
  scopeBaselinesTable,
} from './schema/index.js';

export async function seedProvenanceGraph(): Promise<void> {
  console.log('================================================================');
  console.log('       SCOPECI ALPHA — SEEDING COMMERCIAL PROVENANCE GRAPH       ');
  console.log('================================================================\n');

  const existingOrg = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.slug, 'northstar-agency'),
  });

  if (existingOrg) {
    console.log('▶ Resetting previous test organization seed data...');
    await db.delete(commercialEventsTable).where(eq(commercialEventsTable.organizationId, existingOrg.id));
    
    const prs = await db.select().from(pullRequestsTable).where(eq(pullRequestsTable.organizationId, existingOrg.id));
    for (const pr of prs) {
      const evals = await db.select().from(commercialEvaluationsTable).where(eq(commercialEvaluationsTable.pullRequestId, pr.id));
      for (const ev of evals) {
        await db.delete(commercialApprovalsTable).where(eq(commercialApprovalsTable.commercialEvaluationId, ev.id));
      }
      await db.delete(commercialEvaluationsTable).where(eq(commercialEvaluationsTable.pullRequestId, pr.id));
      await db.delete(prDiffAnalysesTable).where(eq(prDiffAnalysesTable.pullRequestId, pr.id));
      await db.delete(prIssueLinksTable).where(eq(prIssueLinksTable.pullRequestId, pr.id));
    }
    await db.delete(pullRequestsTable).where(eq(pullRequestsTable.organizationId, existingOrg.id));

    const issues = await db.select().from(issuesTable).where(eq(issuesTable.organizationId, existingOrg.id));
    for (const issue of issues) {
      await db.delete(issueDeliverableLinksTable).where(eq(issueDeliverableLinksTable.issueId, issue.id));
    }
    await db.delete(issuesTable).where(eq(issuesTable.organizationId, existingOrg.id));
    await db.delete(projectLinksTable).where(eq(projectLinksTable.organizationId, existingOrg.id));

    const contracts = await db.select().from(contractsTable).where(eq(contractsTable.organizationId, existingOrg.id));
    for (const c of contracts) {
      await db.delete(changeOrdersTable).where(eq(changeOrdersTable.contractId, c.id));
      const baselines = await db.select().from(scopeBaselinesTable).where(eq(scopeBaselinesTable.contractId, c.id));
      for (const b of baselines) {
        await db.delete(deliverablesTable).where(eq(deliverablesTable.scopeBaselineId, b.id));
        await db.delete(contractClausesTable).where(eq(contractClausesTable.scopeBaselineId, b.id));
      }
      await db.delete(scopeBaselinesTable).where(eq(scopeBaselinesTable.contractId, c.id));
    }
    await db.delete(contractsTable).where(eq(contractsTable.organizationId, existingOrg.id));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, existingOrg.id));
    console.log('  ✓ Clean reset completed.\n');
  }

  // 1. Organization
  console.log('▶ 1. Seeding Organization...');
  const [org] = await db
    .insert(organizationsTable)
    .values({
      name: 'Northstar Digital Agency',
      slug: 'northstar-agency',
    })
    .onConflictDoUpdate({
      target: organizationsTable.slug,
      set: { name: 'Northstar Digital Agency', updatedAt: new Date() },
    })
    .returning();
  console.log(`  ✓ Organization: ${org.name} (${org.id})`);

  // 2. Contract
  console.log('▶ 2. Seeding Contract...');
  const [contract] = await db
    .insert(contractsTable)
    .values({
      organizationId: org.id,
      name: 'Northstar API Platform — Fixed Scope Agreement',
      sourceFilename: 'northstar-api-sow-signed.pdf',
      sourceType: 'PDF',
      effectiveAt: new Date('2026-08-01T00:00:00Z'),
      currency: 'USD',
      status: 'ACTIVE',
    })
    .returning();
  console.log(`  ✓ Contract: ${contract.name} (${contract.id})`);

  // 3. Scope Baseline v1 (Original SOW)
  console.log('▶ 3. Seeding Scope Baseline v1...');
  const [baselineV1] = await db
    .insert(scopeBaselinesTable)
    .values({
      contractId: contract.id,
      versionNumber: 'v1',
      status: 'SUPERSEDED',
      createdBy: 'legal@northstar.agency',
    })
    .returning();
  console.log(`  ✓ Scope Baseline v1 (${baselineV1.id})`);

  // 4. Contract Clauses under Baseline v1
  console.log('▶ 4. Seeding Clauses for v1...');
  const [clause42] = await db
    .insert(contractClausesTable)
    .values({
      scopeBaselineId: baselineV1.id,
      clauseNumber: '§4.2',
      title: 'User Authentication & Account Management',
      legalText:
        'The agency shall deliver single-tenant user authentication utilizing email/password and magic link tokens. Includes password reset, email verification, profile picture upload, and account deletion. Explicitly excludes multi-tenant organization hierarchies, team invitations, and role-based access control (RBAC), which shall require a separate Change Order.',
      boundaryType: 'INCLUSION',
      sourcePage: 4,
      sourceLocation: 'Section 4, Paragraph 2',
    })
    .returning();

  const [clause42Exclusion] = await db
    .insert(contractClausesTable)
    .values({
      scopeBaselineId: baselineV1.id,
      clauseNumber: '§4.2-EXC',
      title: 'Exclusion of Enterprise RBAC & Multi-Tenancy',
      legalText:
        'Multi-tenant team invitations, enterprise RBAC roles, and organization-level billing are explicitly out of scope for Milestone 1.',
      boundaryType: 'EXCLUSION',
      sourcePage: 4,
      sourceLocation: 'Section 4, Exclusions List',
    })
    .returning();

  const [clause43] = await db
    .insert(contractClausesTable)
    .values({
      scopeBaselineId: baselineV1.id,
      clauseNumber: '§4.3',
      title: 'Activity Logging & Auditing',
      legalText:
        'Standard audit logging of sign-in events and user profile changes stored in PostgreSQL and rendered in the user settings view.',
      boundaryType: 'INCLUSION',
      sourcePage: 5,
    })
    .returning();
  console.log(`  ✓ Clauses: ${clause42.clauseNumber}, ${clause42Exclusion.clauseNumber}, ${clause43.clauseNumber}`);

  // 5. Deliverables under Baseline v1
  console.log('▶ 5. Seeding Deliverables for v1...');
  const [delivAuth] = await db
    .insert(deliverablesTable)
    .values({
      scopeBaselineId: baselineV1.id,
      clauseId: clause42.id,
      name: 'User Authentication Subsystem',
      description: 'Single-user login, password reset flow, session tokens, and profile management.',
      acceptanceCriteria:
        '1. User can sign in with email/password\n2. User can request password reset token\n3. User profile view renders correctly',
      boundarySummary: 'Single-tenant auth only. No org permissions or roles.',
      allocatedHours: 50,
      allocatedBudget: 7500,
      currency: 'USD',
    })
    .returning();

  const [delivAudit] = await db
    .insert(deliverablesTable)
    .values({
      scopeBaselineId: baselineV1.id,
      clauseId: clause43.id,
      name: 'Audit Logging Subsystem',
      description: 'Activity logs viewable in account settings.',
      acceptanceCriteria: 'Sign in and profile update events logged to postgres.',
      boundarySummary: 'Standard in-app logging only.',
      allocatedHours: 20,
      allocatedBudget: 3000,
      currency: 'USD',
    })
    .returning();
  console.log(`  ✓ Deliverables: ${delivAuth.name}, ${delivAudit.name}`);

  // 6. Project Link
  console.log('▶ 6. Seeding Project Link (Linear <-> GitHub)...');
  const [projLink] = await db
    .insert(projectLinksTable)
    .values({
      organizationId: org.id,
      provider: 'LINEAR',
      externalProjectId: 'lin_proj_northstar',
      externalProjectName: 'Northstar API Platform',
      externalTeamId: 'lin_team_eng',
      repositoryProvider: 'GITHUB',
      repositoryExternalId: 'gh_repo_184200',
      repositoryFullName: 'northstar/api',
    })
    .returning();
  console.log(`  ✓ Project Link: ${projLink.externalProjectName} <-> ${projLink.repositoryFullName}`);

  // 7. Linear Issues
  console.log('▶ 7. Seeding Linear Issues...');
  const [issue101] = await db
    .insert(issuesTable)
    .values({
      organizationId: org.id,
      externalProvider: 'LINEAR',
      externalId: 'lin_issue_101',
      identifier: 'ENG-101',
      title: 'Implement password reset token and flow',
      description: 'Allow users to request a password reset email and enter a new password.',
      status: 'In Progress',
      estimate: 8,
      url: 'https://linear.app/northstar/issue/ENG-101',
    })
    .returning();

  const [issue184] = await db
    .insert(issuesTable)
    .values({
      organizationId: org.id,
      externalProvider: 'LINEAR',
      externalId: 'lin_issue_184',
      identifier: 'ENG-184',
      title: 'Add organization-level permissions and roles',
      description: 'Introduce multi-member organizations, team invite endpoints, and RBAC middleware.',
      status: 'In Review',
      estimate: 20,
      url: 'https://linear.app/northstar/issue/ENG-184',
    })
    .returning();

  const [issue204] = await db
    .insert(issuesTable)
    .values({
      organizationId: org.id,
      externalProvider: 'LINEAR',
      externalId: 'lin_issue_204',
      identifier: 'ENG-204',
      title: 'Export audit logs as CSV',
      description: 'Add a button to download historical audit events as a formatted CSV file.',
      status: 'In Progress',
      estimate: 6,
      url: 'https://linear.app/northstar/issue/ENG-204',
    })
    .returning();
  console.log(`  ✓ Issues: ${issue101.identifier}, ${issue184.identifier}, ${issue204.identifier}`);

  // 8. Issue -> Deliverable Links
  console.log('▶ 8. Linking Issues to Deliverables...');
  await db.insert(issueDeliverableLinksTable).values([
    {
      issueId: issue101.id,
      deliverableId: delivAuth.id,
      associationType: 'DIRECT',
      confidence: '0.9800',
      evidenceJson: { matchedKeywords: ['password_reset', 'auth'] },
    },
    {
      issueId: issue184.id,
      deliverableId: delivAuth.id,
      associationType: 'PARTIAL',
      confidence: '0.9400',
      evidenceJson: {
        matchedKeywords: ['auth'],
        exceededBoundary: ['organization_rbac', 'team_invitations'],
      },
    },
    {
      issueId: issue204.id,
      deliverableId: delivAudit.id,
      associationType: 'DIRECT',
      confidence: '0.8500',
      evidenceJson: { matchedKeywords: ['audit', 'export'] },
    },
  ]);
  console.log('  ✓ Issue-Deliverable relationships established.');

  // 9. Pull Requests
  console.log('▶ 9. Seeding Pull Requests...');
  const [pr1042] = await db
    .insert(pullRequestsTable)
    .values({
      organizationId: org.id,
      projectLinkId: projLink.id,
      externalProvider: 'GITHUB',
      externalId: 'gh_pr_1042',
      number: 1042,
      title: 'feat(auth): add password reset endpoints and UI',
      headBranch: 'feat/eng-101-password-reset',
      baseBranch: 'main',
      authorExternalId: 'alex-dev',
      url: 'https://github.com/northstar/api/pull/1042',
      state: 'OPEN',
      changedFiles: 4,
      additions: 120,
      deletions: 12,
      openedAt: new Date('2026-09-02T10:00:00Z'),
    })
    .returning();

  const [pr1842] = await db
    .insert(pullRequestsTable)
    .values({
      organizationId: org.id,
      projectLinkId: projLink.id,
      externalProvider: 'GITHUB',
      externalId: 'gh_pr_1842',
      number: 1842,
      title: 'Add organization-level permissions',
      headBranch: 'feature/org-permissions',
      baseBranch: 'main',
      authorExternalId: 'dev-lead',
      url: 'https://github.com/northstar/api/pull/1842',
      state: 'OPEN',
      changedFiles: 14,
      additions: 386,
      deletions: 22,
      openedAt: new Date('2026-09-08T09:15:00Z'),
    })
    .returning();

  const [pr2042] = await db
    .insert(pullRequestsTable)
    .values({
      organizationId: org.id,
      projectLinkId: projLink.id,
      externalProvider: 'GITHUB',
      externalId: 'gh_pr_2042',
      number: 2042,
      title: 'feat(audit): export audit events as CSV',
      headBranch: 'eng-204-audit-csv-export',
      baseBranch: 'main',
      authorExternalId: 'sam-engineer',
      url: 'https://github.com/northstar/api/pull/2042',
      state: 'OPEN',
      changedFiles: 3,
      additions: 85,
      deletions: 5,
      openedAt: new Date('2026-09-09T11:00:00Z'),
    })
    .returning();

  const [pr9999] = await db
    .insert(pullRequestsTable)
    .values({
      organizationId: org.id,
      projectLinkId: projLink.id,
      externalProvider: 'GITHUB',
      externalId: 'gh_pr_9999',
      number: 9999,
      title: 'fix: patch database session pool leak',
      headBranch: 'patch/db-pool',
      baseBranch: 'main',
      authorExternalId: 'ops-dev',
      url: 'https://github.com/northstar/api/pull/9999',
      state: 'OPEN',
      changedFiles: 2,
      additions: 15,
      deletions: 8,
      openedAt: new Date('2026-09-09T16:00:00Z'),
    })
    .returning();
  console.log(`  ✓ Pull Requests: #${pr1042.number}, #${pr1842.number}, #${pr2042.number}, #${pr9999.number}`);

  // 10. PR -> Issue Links
  console.log('▶ 10. Linking PRs to Issues...');
  await db.insert(prIssueLinksTable).values([
    {
      pullRequestId: pr1042.id,
      issueId: issue101.id,
      linkMethod: 'BRANCH_NAME',
      confidence: '1.0000',
      evidence: 'Branch feat/eng-101-password-reset contains issue key ENG-101',
    },
    {
      pullRequestId: pr1842.id,
      issueId: issue184.id,
      linkMethod: 'PR_TITLE',
      confidence: '0.9800',
      evidence: 'Matched Linear ticket ENG-184 via commit message and title',
    },
    {
      pullRequestId: pr2042.id,
      issueId: issue204.id,
      linkMethod: 'BRANCH_NAME',
      confidence: '1.0000',
      evidence: 'Branch eng-204-audit-csv-export contains issue key ENG-204',
    },
  ]);
  console.log('  ✓ PR-Issue links recorded.');

  // 11. PR Diff Analysis for PR #1842
  console.log('▶ 11. Recording PR Diff Analysis for PR #1842...');
  const [diffAnalysis1842] = await db
    .insert(prDiffAnalysesTable)
    .values({
      pullRequestId: pr1842.id,
      analysisVersion: 1,
      status: 'COMPLETED',
      filesChangedJson: [
        'src/db/schema/organizations.ts',
        'src/db/schema/memberships.ts',
        'src/middleware/rbac.ts',
        'src/routes/invitations.ts',
        'src/views/settings/roles.tsx',
      ],
      subsystemsJson: ['authentication', 'organization_rbac', 'team_invitations'],
      scopeDeltaJson: [
        'Uncontracted subsystem: organization_rbac',
        'Uncontracted subsystem: team_invitations',
      ],
      summary:
        'PR introduces multi-tenant organization models, membership roles, and RBAC middleware not specified in SOW §4.2.',
      modelProvider: 'anthropic',
      modelVersion: 'claude-3-7-sonnet',
      completedAt: new Date(),
    })
    .returning();
  console.log(`  ✓ PR Diff Analysis recorded (${diffAnalysis1842.id})`);

  // 12. Initial Commercial Evaluation for PR #1842 (CHANGE_REQUIRED)
  console.log('▶ 12. Persisting Commercial Evaluation for PR #1842...');
  const [eval1842] = await db
    .insert(commercialEvaluationsTable)
    .values({
      pullRequestId: pr1842.id,
      scopeBaselineId: baselineV1.id,
      prDiffAnalysisId: diffAnalysis1842.id,
      state: 'CHANGE_REQUIRED',
      policyMode: 'REVIEW',
      confidence: '0.9400',
      contractClauseIdsJson: [clause42.id, clause42Exclusion.id],
      deliverableIdsJson: [delivAuth.id],
      issueIdsJson: [issue184.id],
      evidenceJson: [
        { source: 'SOW', ref: '§4.2', status: 'no match', tone: 'bad' },
        { source: 'LINEAR', ref: 'ENG-184', status: 'linked', tone: 'ok' },
        { source: 'GITHUB', ref: 'PR #1842', status: 'read', tone: 'ok' },
      ],
      estimatedHoursMin: 18,
      estimatedHoursMax: 24,
      estimatedValueMin: 2700,
      estimatedValueMax: 3600,
      currency: 'USD',
      reason: 'Detected 14 files introducing uncontracted RBAC subsystem without approved change order.',
      evaluatorVersion: '0.1.0-alpha',
    })
    .returning();
  console.log(`  ✓ Commercial Evaluation: ${eval1842.state} (${eval1842.id})`);

  // 13. Change Order #12
  console.log('▶ 13. Seeding Change Order #12...');
  const [co12] = await db
    .insert(changeOrdersTable)
    .values({
      organizationId: org.id,
      contractId: contract.id,
      sourceBaselineId: baselineV1.id,
      reference: 'CO-12',
      title: 'Change Order #12: Organization Roles & Invitations',
      description: 'Client requested team multi-tenancy and RBAC controls for enterprise tier pilot.',
      estimatedHoursMin: 18,
      estimatedHoursMax: 24,
      estimatedValueMin: 2700,
      estimatedValueMax: 3600,
      currency: 'USD',
      status: 'APPROVED',
      approvedAt: new Date('2026-09-08T14:30:00Z'),
    })
    .returning();
  console.log(`  ✓ Change Order: ${co12.reference} (${co12.id})`);

  // 14. Scope Baseline v2 (Created as result of Change Order #12)
  console.log('▶ 14. Creating Resulting Scope Baseline v2...');
  const [baselineV2] = await db
    .insert(scopeBaselinesTable)
    .values({
      contractId: contract.id,
      versionNumber: 'v2',
      status: 'ACTIVE',
      createdBy: 'client.vp@customer.com',
      sourceChangeOrderId: co12.id,
      supersedesBaselineId: baselineV1.id,
    })
    .returning();

  // Update change order to link to resulting baseline v2
  await db
    .update(changeOrdersTable)
    .set({ resultingBaselineId: baselineV2.id })
    .where(eq(changeOrdersTable.id, co12.id));

  // Add clause to baseline v2 authorizing RBAC
  const [clauseCO12] = await db
    .insert(contractClausesTable)
    .values({
      scopeBaselineId: baselineV2.id,
      clauseNumber: '§4.2-CO12',
      title: 'Authorized Organization RBAC & Team Invitations',
      legalText:
        'Pursuant to signed Change Order #12, the contractor is authorized to deliver organization models, member invitations, and role-based access control.',
      boundaryType: 'INCLUSION',
    })
    .returning();
  console.log(`  ✓ Scope Baseline v2 created (${baselineV2.id}) with Clause ${clauseCO12.clauseNumber}`);

  // 15. Commercial Approval Record (Flipping Evaluation to APPROVED_CHANGE)
  console.log('▶ 15. Recording Commercial Approval for PR #1842...');
  const [approval1842] = await db
    .insert(commercialApprovalsTable)
    .values({
      commercialEvaluationId: eval1842.id,
      approvalType: 'change_order',
      approverType: 'CLIENT',
      approverName: 'Jane Doe (Client VP of Eng)',
      changeOrderRef: co12.reference,
      notes: 'Approved via signed Change Order #12',
      previousState: 'CHANGE_REQUIRED',
      newState: 'APPROVED_CHANGE',
      approvedAt: new Date(),
    })
    .returning();

  // Update evaluation state to APPROVED_CHANGE under baseline v2
  await db
    .update(commercialEvaluationsTable)
    .set({
      state: 'APPROVED_CHANGE',
      scopeBaselineId: baselineV2.id,
      updatedAt: new Date(),
    })
    .where(eq(commercialEvaluationsTable.id, eval1842.id));
  console.log(`  ✓ Commercial Approval recorded: ${approval1842.newState} (${approval1842.id})`);

  // 16. Commercial Events Audit Log
  console.log('▶ 16. Writing Immutable Commercial Audit Log...');
  await db.insert(commercialEventsTable).values([
    {
      organizationId: org.id,
      entityType: 'PULL_REQUEST',
      entityId: pr1842.id,
      eventType: 'PR_RECEIVED',
      actorType: 'DEVELOPER',
      actorId: 'dev-lead',
      reason: 'Pull Request #1842 opened against main',
      metadataJson: { branch: pr1842.headBranch, files: pr1842.changedFiles },
      occurredAt: new Date('2026-09-08T09:15:00Z'),
    },
    {
      organizationId: org.id,
      entityType: 'EVALUATION',
      entityId: eval1842.id,
      eventType: 'EVALUATION_CREATED',
      actorType: 'SYSTEM',
      previousState: 'OPEN',
      newState: 'CHANGE_REQUIRED',
      reason: 'Uncontracted RBAC subsystem detected against Scope Baseline v1',
      metadataJson: { clause: '§4.2', estimatedHours: '18-24' },
      occurredAt: new Date('2026-09-08T09:16:00Z'),
    },
    {
      organizationId: org.id,
      entityType: 'CHANGE_ORDER',
      entityId: co12.id,
      eventType: 'CHANGE_ORDER_CREATED',
      actorType: 'PM',
      actorId: 'sarah.pm@agency.com',
      reason: 'Drafted CO-12 for client approval',
      metadataJson: { amount: 3150 },
      occurredAt: new Date('2026-09-08T11:00:00Z'),
    },
    {
      organizationId: org.id,
      entityType: 'APPROVAL',
      entityId: approval1842.id,
      eventType: 'COMMERCIAL_APPROVED',
      actorType: 'CLIENT',
      actorId: 'jane.doe@customer.com',
      previousState: 'CHANGE_REQUIRED',
      newState: 'APPROVED_CHANGE',
      reason: 'Client signed Change Order #12; Baseline v2 created',
      metadataJson: { changeOrderRef: 'CO-12', newBaselineId: baselineV2.id },
      occurredAt: new Date('2026-09-08T14:30:00Z'),
    },
    {
      organizationId: org.id,
      entityType: 'PULL_REQUEST',
      entityId: pr1842.id,
      eventType: 'GITHUB_CHECK_UPDATED',
      actorType: 'SYSTEM',
      previousState: 'action_required',
      newState: 'success',
      reason: 'Commercial authorization confirmed; merge authorized',
      metadataJson: { checkName: 'scopeci/commercial', conclusion: 'success' },
      occurredAt: new Date('2026-09-08T14:31:00Z'),
    },
  ]);
  console.log('  ✓ Immutable audit trail recorded with 5 events.');

  console.log('\n================================================================');
  console.log('         COMMERCIAL PROVENANCE GRAPH SEEDED SUCCESSFULLY ✓       ');
  console.log('================================================================\n');
}

// Auto-run when executed directly
seedProvenanceGraph()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
