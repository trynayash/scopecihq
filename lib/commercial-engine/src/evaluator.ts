import type {
  CheckRunConclusion,
  CommercialEvaluation,
  CommercialState,
  EvaluationEvidence,
  LinearIssue,
  PolicyMode,
  PullRequest,
  ScopeBaseline,
  ChangeOrder,
  Deliverable,
  ContractClause,
} from './types.js';

export interface EvaluationInput {
  baseline: ScopeBaseline;
  pullRequest: PullRequest;
  issue?: LinearIssue;
  approvedChangeOrders?: ChangeOrder[];
  policyMode?: PolicyMode;
  hourlyRate?: number; // default $150
}

/**
 * Deterministic Commercial Policy Engine.
 *
 * Rules:
 * 1. An unlinked PR without a Linear ticket immediately transitions to REVIEW_REQUIRED.
 * 2. Changed subsystems are checked against active ScopeBaseline deliverables and clauses.
 * 3. Subsystems exceeding baseline are checked against approved ChangeOrders.
 * 4. Uncontracted scope expansion results in CHANGE_REQUIRED with clause-level evidence and hour/cost impact.
 * 5. Scope covered by approved ChangeOrder results in APPROVED_CHANGE.
 * 6. Ambiguous/borderline changes result in REVIEW_REQUIRED.
 * 7. Compliant changes result in IN_SCOPE.
 * 8. PolicyMode (OBSERVE, REVIEW, ENFORCE) strictly governs GitHub CheckRunConclusion.
 */
export function evaluateCommercialScope(input: EvaluationInput): CommercialEvaluation {
  const {
    baseline,
    pullRequest,
    issue,
    approvedChangeOrders = [],
    policyMode = 'REVIEW',
    hourlyRate = 150,
  } = input;

  const evaluationId = `eval_${pullRequest.id}_${Date.now()}`;
  const evidence: EvaluationEvidence[] = [];
  const detectedDelta: string[] = [];

  // Case 5: Unlinked PR (no Linear issue)
  if (!issue) {
    evidence.push({
      source: 'GITHUB',
      mark: 'github',
      label: 'Pull Request',
      value: `PR #${pullRequest.number} (${pullRequest.filesChanged} files)`,
      result: 'read',
      tone: 'ok',
    });
    evidence.push({
      source: 'LINEAR',
      mark: 'linear',
      label: 'Work Item',
      value: 'No linked issue found',
      result: 'unlinked',
      tone: 'warn',
    });
    evidence.push({
      source: 'SOW',
      mark: 'sow',
      label: 'Contract Baseline',
      value: `${baseline.version} — ${baseline.title}`,
      result: 'no match',
      tone: 'bad',
    });

    return {
      evaluationId,
      pullRequestId: pullRequest.id,
      state: 'REVIEW_REQUIRED',
      confidence: 0.95,
      evidence,
      detectedDelta: ['No tracked Linear work item associated with pull request branch or body'],
      estimatedHours: { min: 0, max: 0 },
      commercialValue: { currency: 'USD', min: 0, max: 0 },
      recommendedAction: 'MANUAL_PM_REVIEW',
      checkConclusion: resolveCheckConclusion('REVIEW_REQUIRED', policyMode),
      policyMode,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // Linked Issue Evidence
  evidence.push({
    source: 'LINEAR',
    mark: 'linear',
    label: 'Work Item',
    value: `${issue.id} · ${issue.title}`,
    result: 'linked',
    tone: 'ok',
  });

  // Pull Request Evidence
  evidence.push({
    source: 'GITHUB',
    mark: 'github',
    label: 'Pull Request',
    value: `PR #${pullRequest.number} (${pullRequest.filesChanged} files, +${pullRequest.additions}/-${pullRequest.deletions})`,
    result: 'read',
    tone: 'ok',
  });

  // Locate associated deliverable
  let matchedDeliverable: Deliverable | undefined;
  if (issue.deliverableId) {
    matchedDeliverable = baseline.deliverables.find((d) => d.id === issue.deliverableId);
  }
  if (!matchedDeliverable) {
    matchedDeliverable = baseline.deliverables.find((d) =>
      d.keywords.some((kw) =>
        issue.title.toLowerCase().includes(kw.toLowerCase()) ||
        issue.description.toLowerCase().includes(kw.toLowerCase())
      )
    );
  }

  let matchedClause: ContractClause | undefined;
  if (matchedDeliverable) {
    matchedClause = baseline.clauses.find((c) => c.id === matchedDeliverable?.clauseId);
  }

  // Analyze detected subsystems against baseline & change orders
  const uncontractedSubsystems: string[] = [];
  const changeOrderCoveredSubsystems: string[] = [];
  const ambiguousSubsystems: string[] = [];

  const activeApprovedCOs = approvedChangeOrders.filter((co) => co.status === 'APPROVED');

  for (const subsystem of pullRequest.detectedSubsystems) {
    // Check if covered by active Change Order
    const coMatch = activeApprovedCOs.find((co) =>
      co.authorizedSubsystems.map((s) => s.toLowerCase()).includes(subsystem.toLowerCase())
    );

    if (coMatch) {
      changeOrderCoveredSubsystems.push(subsystem);
      continue;
    }

    // Check against deliverable scope & clause inclusions
    const isExplicitlyIncluded =
      matchedDeliverable?.keywords.some((kw) => kw.toLowerCase() === subsystem.toLowerCase()) ||
      matchedClause?.inclusions.some((inc) => inc.toLowerCase().includes(subsystem.toLowerCase()));

    const isExplicitlyExcluded = matchedClause?.exclusions.some((exc) =>
      exc.toLowerCase().includes(subsystem.toLowerCase())
    );

    if (isExplicitlyExcluded) {
      uncontractedSubsystems.push(subsystem);
    } else if (!isExplicitlyIncluded) {
      // If not explicitly included nor excluded, check if borderline/ambiguous
      if (subsystem.toLowerCase().includes('export') || subsystem.toLowerCase().includes('utility')) {
        ambiguousSubsystems.push(subsystem);
      } else {
        uncontractedSubsystems.push(subsystem);
      }
    }
  }

  // Determine state
  let state: CommercialState = 'IN_SCOPE';
  let confidence = 0.95;
  let estimatedHours = { min: 0, max: 0 };
  let recommendedAction: CommercialEvaluation['recommendedAction'] = 'PROCEED';

  if (uncontractedSubsystems.length > 0) {
    state = 'CHANGE_REQUIRED';
    confidence = 0.94;
    detectedDelta.push(...uncontractedSubsystems.map((s) => `Uncontracted subsystem: ${s}`));
    // Impact estimation based on complexity
    estimatedHours = { min: 18, max: 24 };
    recommendedAction = 'REQUEST_CHANGE_APPROVAL';

    evidence.push({
      source: 'SOW',
      mark: 'sow',
      label: 'Contract Baseline',
      value: matchedClause ? `${matchedClause.clauseRef} ${matchedClause.title}` : 'No matching deliverable',
      result: 'no match',
      tone: 'bad',
    });
  } else if (changeOrderCoveredSubsystems.length > 0) {
    state = 'APPROVED_CHANGE';
    confidence = 0.98;
    detectedDelta.push(...changeOrderCoveredSubsystems.map((s) => `Authorized by Change Order: ${s}`));
    recommendedAction = 'PROCEED';

    evidence.push({
      source: 'CHANGE_ORDER',
      mark: 'approval',
      label: 'Approved Change Order',
      value: activeApprovedCOs[0]?.title || 'Change Order Authorized',
      result: 'authorized',
      tone: 'ok',
    });
  } else if (ambiguousSubsystems.length > 0) {
    state = 'REVIEW_REQUIRED';
    confidence = 0.75;
    detectedDelta.push(...ambiguousSubsystems.map((s) => `Ambiguous requirement: ${s}`));
    estimatedHours = { min: 4, max: 8 };
    recommendedAction = 'MANUAL_PM_REVIEW';

    evidence.push({
      source: 'SOW',
      mark: 'sow',
      label: 'Contract Baseline',
      value: matchedClause ? `${matchedClause.clauseRef} ${matchedClause.title}` : 'Borderline deliverable',
      result: 'no match',
      tone: 'warn',
    });
  } else {
    // Completely In Scope
    state = 'IN_SCOPE';
    confidence = 0.99;
    recommendedAction = 'PROCEED';

    evidence.push({
      source: 'SOW',
      mark: 'sow',
      label: 'Contract Baseline',
      value: matchedClause ? `${matchedClause.clauseRef} ${matchedClause.title}` : 'Baseline Scope',
      result: 'matched',
      tone: 'ok',
    });
  }

  const commercialValue = {
    currency: 'USD',
    min: estimatedHours.min * hourlyRate,
    max: estimatedHours.max * hourlyRate,
  };

  return {
    evaluationId,
    pullRequestId: pullRequest.id,
    issueId: issue.id,
    deliverableId: matchedDeliverable?.id,
    contractClauseId: matchedClause?.id,
    state,
    confidence,
    evidence,
    detectedDelta,
    estimatedHours,
    commercialValue,
    recommendedAction,
    checkConclusion: resolveCheckConclusion(state, policyMode),
    policyMode,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Maps CommercialState and PolicyMode to GitHub CheckRunConclusion.
 */
export function resolveCheckConclusion(state: CommercialState, mode: PolicyMode): CheckRunConclusion {
  if (state === 'IN_SCOPE' || state === 'APPROVED_CHANGE') {
    return 'success';
  }

  if (state === 'OVERRIDDEN') {
    return 'success';
  }

  switch (mode) {
    case 'OBSERVE':
      // Observe mode NEVER blocks merges
      return 'neutral';

    case 'REVIEW':
      // Review mode marks action required
      return state === 'CHANGE_REQUIRED' || state === 'REVIEW_REQUIRED'
        ? 'action_required'
        : 'neutral';

    case 'ENFORCE':
      // Enforce mode marks failure to block protected branch
      return 'failure';
  }
}
