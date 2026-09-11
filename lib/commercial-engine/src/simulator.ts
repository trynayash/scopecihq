import path from 'path';
import { evaluateCommercialScope } from './evaluator.js';
import { applyChangeOrderApproval, applyHumanOverride } from './transitions.js';
import { formatEvaluationSummary, formatGitHubPRComment } from './formatter.js';
import {
  SAMPLE_BASELINE_V1,
  SAMPLE_CHANGE_ORDER_12,
  SAMPLE_ISSUES,
  SAMPLE_PR_AMBIGUOUS,
  SAMPLE_PR_IN_SCOPE,
  SAMPLE_PR_OUT_OF_SCOPE,
  SAMPLE_PR_UNLINKED,
} from './fixtures/index.js';
import type { CommercialEvent } from './types.js';

interface TestResult {
  scenario: string;
  expectedState: string;
  actualState: string;
  passed: boolean;
  notes?: string;
}

export function runSimulator(): { results: TestResult[]; allPassed: boolean } {
  const results: TestResult[] = [];
  const eventLog: CommercialEvent[] = [];

  console.log('================================================================');
  console.log('            SCOPECI ALPHA — DETERMINISTIC SIMULATOR             ');
  console.log('================================================================\n');

  /* ------------------------------------------------------------------ */
  /* Case 1 — Clearly in scope                                          */
  /* ------------------------------------------------------------------ */
  console.log('▶ Running Scenario 1: Clearly In Scope');
  const eval1 = evaluateCommercialScope({
    baseline: SAMPLE_BASELINE_V1,
    pullRequest: SAMPLE_PR_IN_SCOPE,
    issue: SAMPLE_ISSUES['ENG-101'],
    policyMode: 'REVIEW',
  });

  const passed1 = eval1.state === 'IN_SCOPE' && eval1.checkConclusion === 'success';
  results.push({
    scenario: 'Case 1: Clearly in scope (Password reset)',
    expectedState: 'IN_SCOPE',
    actualState: eval1.state,
    passed: passed1,
  });
  console.log(`  Result: ${eval1.state} (Check: ${eval1.checkConclusion}) — ${passed1 ? 'PASS ✓' : 'FAIL ✗'}\n`);

  /* ------------------------------------------------------------------ */
  /* Case 2 — Clearly outside scope (PR #1842)                          */
  /* ------------------------------------------------------------------ */
  console.log('▶ Running Scenario 2: Scope Expansion (Uncontracted Org RBAC)');
  const eval2 = evaluateCommercialScope({
    baseline: SAMPLE_BASELINE_V1,
    pullRequest: SAMPLE_PR_OUT_OF_SCOPE,
    issue: SAMPLE_ISSUES['ENG-184'],
    policyMode: 'REVIEW',
  });

  const passed2 =
    eval2.state === 'CHANGE_REQUIRED' &&
    eval2.checkConclusion === 'action_required' &&
    eval2.estimatedHours.min === 18 &&
    eval2.estimatedHours.max === 24;

  results.push({
    scenario: 'Case 2: Outside scope (PR #1842 Org Permissions)',
    expectedState: 'CHANGE_REQUIRED',
    actualState: eval2.state,
    passed: passed2,
    notes: `Hours: ${eval2.estimatedHours.min}-${eval2.estimatedHours.max}h, Value: $${eval2.commercialValue.min}-$${eval2.commercialValue.max}`,
  });
  console.log(`  Result: ${eval2.state} (Check: ${eval2.checkConclusion}) — ${passed2 ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log('  Human-readable Terminal Summary:\n');
  console.log(
    formatEvaluationSummary(eval2, {
      pr: SAMPLE_PR_OUT_OF_SCOPE,
      issue: SAMPLE_ISSUES['ENG-184'],
      baseline: SAMPLE_BASELINE_V1,
    })
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n'),
  );
  console.log('\n  Machine-readable Golden Contract Output:');
  console.log(
    JSON.stringify(
      {
        state: eval2.state,
        confidence: eval2.confidence,
        contractClauseId: eval2.contractClauseId,
        deliverableId: eval2.deliverableId,
        issueId: eval2.issueId,
        pullRequestId: eval2.pullRequestId,
        evidence: eval2.evidence,
        estimatedHours: eval2.estimatedHours,
        commercialValue: eval2.commercialValue,
        recommendedAction: eval2.recommendedAction,
      },
      null,
      2,
    )
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n'),
  );
  console.log('\n');

  /* ------------------------------------------------------------------ */
  /* Case 3 — Ambiguous / Borderline                                    */
  /* ------------------------------------------------------------------ */
  console.log('▶ Running Scenario 3: Ambiguous Scope (CSV Export Utility)');
  const eval3 = evaluateCommercialScope({
    baseline: SAMPLE_BASELINE_V1,
    pullRequest: SAMPLE_PR_AMBIGUOUS,
    issue: SAMPLE_ISSUES['ENG-204'],
    policyMode: 'REVIEW',
  });

  const passed3 = eval3.state === 'REVIEW_REQUIRED';
  results.push({
    scenario: 'Case 3: Ambiguous scope (CSV export)',
    expectedState: 'REVIEW_REQUIRED',
    actualState: eval3.state,
    passed: passed3,
  });
  console.log(`  Result: ${eval3.state} (Check: ${eval3.checkConclusion}) — ${passed3 ? 'PASS ✓' : 'FAIL ✗'}\n`);

  /* ------------------------------------------------------------------ */
  /* Case 4 — Approved Change (Change Order #12)                        */
  /* ------------------------------------------------------------------ */
  console.log('▶ Running Scenario 4: Approved Change (Change Order #12 Authorized)');
  const eval4 = evaluateCommercialScope({
    baseline: SAMPLE_BASELINE_V1,
    pullRequest: SAMPLE_PR_OUT_OF_SCOPE,
    issue: SAMPLE_ISSUES['ENG-184'],
    approvedChangeOrders: [SAMPLE_CHANGE_ORDER_12],
    policyMode: 'REVIEW',
  });

  const passed4 = eval4.state === 'APPROVED_CHANGE' && eval4.checkConclusion === 'success';
  results.push({
    scenario: 'Case 4: Approved Change Order (CO #12 adds RBAC)',
    expectedState: 'APPROVED_CHANGE',
    actualState: eval4.state,
    passed: passed4,
  });
  console.log(`  Result: ${eval4.state} (Check: ${eval4.checkConclusion}) — ${passed4 ? 'PASS ✓' : 'FAIL ✗'}\n`);

  /* ------------------------------------------------------------------ */
  /* Case 5 — Unlinked PR                                               */
  /* ------------------------------------------------------------------ */
  console.log('▶ Running Scenario 5: Unlinked PR (No Linear Issue)');
  const eval5 = evaluateCommercialScope({
    baseline: SAMPLE_BASELINE_V1,
    pullRequest: SAMPLE_PR_UNLINKED,
    policyMode: 'REVIEW',
  });

  const passed5 = eval5.state === 'REVIEW_REQUIRED' && eval5.recommendedAction === 'MANUAL_PM_REVIEW';
  results.push({
    scenario: 'Case 5: Unlinked PR without Linear ticket',
    expectedState: 'REVIEW_REQUIRED',
    actualState: eval5.state,
    passed: passed5,
  });
  console.log(`  Result: ${eval5.state} (Check: ${eval5.checkConclusion}) — ${passed5 ? 'PASS ✓' : 'FAIL ✗'}\n`);

  /* ------------------------------------------------------------------ */
  /* Case 6 — Human Override                                            */
  /* ------------------------------------------------------------------ */
  console.log('▶ Running Scenario 6: Human Override by Agency PM');
  // Starts with CHANGE_REQUIRED from Scenario 2
  const initialContext = {
    evaluation: eval2,
    events: eventLog,
  };

  const { updatedEvaluation: eval6, newEvents } = applyHumanOverride(initialContext, {
    actor: 'sarah.pm@agency.com',
    reason: 'Client requested as courtesy under Milestone 1 budget cushion; approved by Partner.',
  });
  eventLog.push(...newEvents);

  const passed6 = eval6.state === 'OVERRIDDEN' && eval6.checkConclusion === 'success';
  results.push({
    scenario: 'Case 6: Human override of CHANGE_REQUIRED',
    expectedState: 'OVERRIDDEN',
    actualState: eval6.state,
    passed: passed6,
  });
  console.log(`  Result: ${eval6.state} (Check: ${eval6.checkConclusion}) — ${passed6 ? 'PASS ✓' : 'FAIL ✗'}\n`);

  /* ------------------------------------------------------------------ */
  /* Verification of Policy Modes                                       */
  /* ------------------------------------------------------------------ */
  console.log('▶ Checking Policy Mode Graduated Trust:');
  const observeEval = evaluateCommercialScope({
    baseline: SAMPLE_BASELINE_V1,
    pullRequest: SAMPLE_PR_OUT_OF_SCOPE,
    issue: SAMPLE_ISSUES['ENG-184'],
    policyMode: 'OBSERVE',
  });
  const enforceEval = evaluateCommercialScope({
    baseline: SAMPLE_BASELINE_V1,
    pullRequest: SAMPLE_PR_OUT_OF_SCOPE,
    issue: SAMPLE_ISSUES['ENG-184'],
    policyMode: 'ENFORCE',
  });

  console.log(`  • OBSERVE Mode Check Conclusion: ${observeEval.checkConclusion} (Never blocks merge)`);
  console.log(`  • REVIEW Mode Check Conclusion:  ${eval2.checkConclusion} (Action required)`);
  console.log(`  • ENFORCE Mode Check Conclusion: ${enforceEval.checkConclusion} (Hard failure / merge blocked)\n`);

  /* ------------------------------------------------------------------ */
  /* Summary Table                                                      */
  /* ------------------------------------------------------------------ */
  console.log('================================================================');
  console.log('                       REGRESSION SUMMARY                       ');
  console.log('================================================================');
  results.forEach((r, idx) => {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(` ${idx + 1}. [${status}] ${r.scenario}`);
    console.log(`    Expected: ${r.expectedState} | Actual: ${r.actualState}`);
    if (r.notes) console.log(`    Detail: ${r.notes}`);
  });

  const allPassed = results.every((r) => r.passed);
  console.log('================================================================');
  console.log(` OVERALL STATUS: ${allPassed ? 'ALL 6 GOLDEN CASES PASSED ✓' : 'SOME CASES FAILED ✗'}`);
  console.log(` IMMUTABLE EVENTS RECORDED: ${eventLog.length} events`);
  console.log('================================================================\n');

  return { results, allPassed };
}

// CLI Execution — only run when executed directly as the simulator CLI script (not when imported)
const isDirectSimulatorRun =
  typeof process !== 'undefined' &&
  Boolean(process.argv?.[1]) &&
  (path.basename(process.argv[1]).startsWith('simulator.') ||
    process.argv[1].endsWith('simulator.ts') ||
    process.argv[1].endsWith('simulator.js'));

if (isDirectSimulatorRun) {
  runSimulator();
}
