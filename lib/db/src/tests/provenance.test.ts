import { eq, desc } from 'drizzle-orm';
import { db } from '../index.js';
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
  prIssueLinksTable,
  pullRequestsTable,
  scopeBaselinesTable,
} from '../schema/index.js';

interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
}

export async function runDatabaseProvenanceTests(): Promise<void> {
  const results: TestResult[] = [];

  console.log('================================================================');
  console.log('       SCOPECI ALPHA — DATABASE PROVENANCE INTEGRITY TESTS      ');
  console.log('================================================================\n');

  // Test 1: Organization & Contract Hierarchy
  console.log('▶ Test 1: Organization & Contract Hierarchy Query');
  const org = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.slug, 'northstar-agency'),
    with: {
      contracts: true,
    },
  });
  const t1Passed = Boolean(org && org.contracts.length > 0);
  results.push({
    name: 'Organization & Contract Hierarchy',
    passed: t1Passed,
    details: `Org: ${org?.name}, Contracts: ${org?.contracts.length}`,
  });
  console.log(`  ${t1Passed ? '✓ PASS' : '✗ FAIL'} (${org?.contracts[0]?.name})\n`);

  // Test 2: Immutable Scope Baseline Versions
  console.log('▶ Test 2: Immutable Scope Baseline Versions (v1 vs v2)');
  const baselines = await db
    .select()
    .from(scopeBaselinesTable)
    .where(eq(scopeBaselinesTable.contractId, org!.contracts[0].id))
    .orderBy(scopeBaselinesTable.versionNumber);

  const v1 = baselines.find((b) => b.versionNumber === 'v1');
  const v2 = baselines.find((b) => b.versionNumber === 'v2');
  const t2Passed = Boolean(
    v1 && v2 && v1.status === 'SUPERSEDED' && v2.status === 'ACTIVE' && v2.supersedesBaselineId === v1.id
  );
  results.push({
    name: 'Immutable Scope Baseline Versions',
    passed: t2Passed,
    details: `v1 (${v1?.status}) -> v2 (${v2?.status}), Supersedes: ${v2?.supersedesBaselineId === v1?.id}`,
  });
  console.log(`  ${t2Passed ? '✓ PASS' : '✗ FAIL'} (v1: ${v1?.status}, v2: ${v2?.status})\n`);

  // Test 3: Backward Traceability: PR #1842 -> Issue -> Deliverable -> Clause -> Baseline -> Contract
  console.log('▶ Test 3: Complete Backward Traceability (PR #1842 -> SOW Contract)');
  const pr = await db.query.pullRequestsTable.findFirst({
    where: eq(pullRequestsTable.number, 1842),
  });

  const prIssueLink = await db.query.prIssueLinksTable.findFirst({
    where: eq(prIssueLinksTable.pullRequestId, pr!.id),
    with: { issue: true },
  });

  const issueDeliverableLink = await db.query.issueDeliverableLinksTable.findFirst({
    where: eq(issueDeliverableLinksTable.issueId, prIssueLink!.issue.id),
    with: { deliverable: true },
  });

  const clause = await db.query.contractClausesTable.findFirst({
    where: eq(contractClausesTable.id, issueDeliverableLink!.deliverable.clauseId!),
  });

  const baseline = await db.query.scopeBaselinesTable.findFirst({
    where: eq(scopeBaselinesTable.id, issueDeliverableLink!.deliverable.scopeBaselineId),
    with: { contract: true },
  });

  const t3Passed = Boolean(
    pr &&
    prIssueLink?.issue.identifier === 'ENG-184' &&
    issueDeliverableLink?.deliverable.name === 'User Authentication Subsystem' &&
    clause?.clauseNumber === '§4.2' &&
    baseline?.contract
  );

  results.push({
    name: 'Backward Traceability (PR -> Issue -> Deliverable -> Clause -> SOW)',
    passed: t3Passed,
    details: `PR #${pr?.number} -> Issue ${prIssueLink?.issue.identifier} -> Deliv "${issueDeliverableLink?.deliverable.name}" -> Clause ${clause?.clauseNumber} -> Contract "${baseline?.contract.name}"`,
  });
  console.log(`  ${t3Passed ? '✓ PASS' : '✗ FAIL'}`);
  console.log(
    `    Chain: PR #${pr?.number} ➜ ${prIssueLink?.issue.identifier} ➜ "${issueDeliverableLink?.deliverable.name}" ➜ Clause ${clause?.clauseNumber} ➜ "${baseline?.contract.name}"\n`
  );

  // Test 4: Forward Traceability Query: Evaluation -> Approval -> Change Order -> Commercial State
  console.log('▶ Test 4: Forward Traceability (Evaluation -> Approval -> Change Order)');
  const evalRecord = await db.query.commercialEvaluationsTable.findFirst({
    where: eq(commercialEvaluationsTable.pullRequestId, pr!.id),
    with: {
      approvals: true,
    },
  });

  const approval = evalRecord?.approvals[0];
  const changeOrder = await db.query.changeOrdersTable.findFirst({
    where: eq(changeOrdersTable.reference, approval?.changeOrderRef || ''),
  });

  const t4Passed = Boolean(
    evalRecord &&
    evalRecord.state === 'APPROVED_CHANGE' &&
    approval?.approvalType === 'change_order' &&
    changeOrder?.status === 'APPROVED' &&
    changeOrder?.reference === 'CO-12'
  );

  results.push({
    name: 'Forward Traceability (Evaluation -> Approval -> Change Order)',
    passed: t4Passed,
    details: `State: ${evalRecord?.state}, Approval: ${approval?.approvalType}, CO: ${changeOrder?.reference} ($${changeOrder?.estimatedValueMax})`,
  });
  console.log(`  ${t4Passed ? '✓ PASS' : '✗ FAIL'}`);
  console.log(
    `    Chain: State: ${evalRecord?.state} ➜ Approval: ${approval?.approvalType} (${approval?.changeOrderRef}) ➜ CO Status: ${changeOrder?.status}\n`
  );

  // Test 5: Append-Only Immutable Event Log Verification
  console.log('▶ Test 5: Immutable Commercial Event Log Verification');
  const events = await db
    .select()
    .from(commercialEventsTable)
    .where(eq(commercialEventsTable.organizationId, org!.id))
    .orderBy(desc(commercialEventsTable.occurredAt));

  const t5Passed = events.length >= 5;
  results.push({
    name: 'Append-Only Audit Log Integrity',
    passed: t5Passed,
    details: `Recorded events: ${events.length}`,
  });
  console.log(`  ${t5Passed ? '✓ PASS' : '✗ FAIL'} (${events.length} immutable events recorded)`);
  events.forEach((e) => {
    console.log(
      `    • [${e.occurredAt.toISOString()}] [${e.actorType}] ${e.eventType} (${e.entityType}:${e.entityId}) — ${e.reason}`
    );
  });
  console.log('');

  // Test 6: Non-Destructive Integrity (Historical Baseline preservation)
  console.log('▶ Test 6: Historical Baseline Integrity (v1 Clauses Intact after v2)');
  const v1Clauses = await db
    .select()
    .from(contractClausesTable)
    .where(eq(contractClausesTable.scopeBaselineId, v1!.id));

  const v2Clauses = await db
    .select()
    .from(contractClausesTable)
    .where(eq(contractClausesTable.scopeBaselineId, v2!.id));

  const t6Passed = v1Clauses.length === 3 && v2Clauses.length === 1;
  results.push({
    name: 'Historical Baseline Integrity Preservation',
    passed: t6Passed,
    details: `v1 clauses: ${v1Clauses.length}, v2 clauses: ${v2Clauses.length}`,
  });
  console.log(`  ${t6Passed ? '✓ PASS' : '✗ FAIL'} (v1 clauses: ${v1Clauses.length}, v2 clauses: ${v2Clauses.length})\n`);

  // Summary
  console.log('================================================================');
  console.log('                 PROVENANCE TEST SUITE SUMMARY                  ');
  console.log('================================================================');
  results.forEach((r, idx) => {
    console.log(` ${idx + 1}. [${r.passed ? '✓ PASS' : '✗ FAIL'}] ${r.name}`);
    if (r.details) console.log(`    Detail: ${r.details}`);
  });

  const allPassed = results.every((r) => r.passed);
  console.log('================================================================');
  console.log(` OVERALL DATABASE INTEGRITY: ${allPassed ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗'}`);
  console.log('================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

// Auto-run when executed directly
runDatabaseProvenanceTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
  });
