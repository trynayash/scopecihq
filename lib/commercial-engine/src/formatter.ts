import type { CommercialEvaluation, PullRequest, LinearIssue, ScopeBaseline } from './types.js';
import { isPullRequestWorkItem } from './work-item.js';

/**
 * Money as a client reads it: whole units when there are no cents
 * ("$1,440"), otherwise rounded to the cent ("$103.13"), never a fraction of
 * a cent.
 */
export function formatMoney(amount: number): string {
  const cents = Math.round(amount * 100) / 100;
  const fraction = Number.isInteger(cents) ? 0 : 2;
  return `$${cents.toLocaleString('en-US', { minimumFractionDigits: fraction, maximumFractionDigits: fraction })}`;
}

/** "1 hour", "1.5 hours", "12 hours". */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded.toLocaleString('en-US')} ${rounded === 1 ? 'hour' : 'hours'}`;
}

/**
 * Formats a CommercialEvaluation for terminal / CLI output.
 */
export function formatEvaluationSummary(
  evaluation: CommercialEvaluation,
  context?: { pr?: PullRequest; issue?: LinearIssue; baseline?: ScopeBaseline },
): string {
  const prNum = context?.pr ? `#${context.pr.number}` : evaluation.pullRequestId;
  const issueRef = evaluation.issueId || 'Unlinked';

  const lines: string[] = [];
  lines.push('Commercial Evaluation');
  lines.push('────────────────────────────');
  lines.push('');
  lines.push(`PR:`);
  lines.push(`  ${prNum}`);
  lines.push('');
  lines.push(`Issue:`);
  lines.push(`  ${issueRef}`);
  lines.push('');
  lines.push(`State:`);
  lines.push(`  ${evaluation.state}`);
  lines.push('');
  lines.push(`Check Conclusion (${evaluation.policyMode}):`);
  lines.push(`  ${evaluation.checkConclusion.toUpperCase()}`);
  lines.push('');
  lines.push(`Confidence:`);
  lines.push(`  ${evaluation.confidence.toFixed(2)}`);
  lines.push('');

  const sowEvidence = evaluation.evidence.find((e) => e.source === 'SOW');
  if (sowEvidence) {
    lines.push(`Contract evidence:`);
    lines.push(`  ${sowEvidence.value}`);
    lines.push('');
  }

  if (evaluation.deliverableId) {
    const deliv = context?.baseline?.deliverables.find((d) => d.id === evaluation.deliverableId);
    lines.push(`Deliverable:`);
    lines.push(`  ${deliv?.title || evaluation.deliverableId}`);
    lines.push('');
  }

  if (evaluation.detectedDelta.length > 0) {
    lines.push(`Detected delta:`);
    evaluation.detectedDelta.forEach((d) => lines.push(`  • ${d}`));
    lines.push('');
  }

  const estimate = describeEstimate(evaluation);
  if (estimate) {
    lines.push(`Estimated impact:`);
    lines.push(`  ${estimate}`);
    lines.push('');
  }

  lines.push(`Recommended action:`);
  lines.push(`  ${formatActionLabel(evaluation.recommendedAction)}`);

  return lines.join('\n');
}

/**
 * Formats a GitHub PR Markdown comment matching ScopeCI's design specification.
 */
export function formatGitHubPRComment(
  evaluation: CommercialEvaluation,
  context?: { pr?: PullRequest; issue?: LinearIssue; baseline?: ScopeBaseline },
): string {
  const stateBadge = getStateBadge(evaluation.state);

  const rows = evaluation.evidence.map((e) => {
    const icon = e.tone === 'ok' ? '✓' : e.tone === 'warn' ? '⚠' : '✗';
    return `| **${e.source}** | \`${e.value}\` | ${icon} ${e.result} |`;
  }).join('\n');

  const estimate = describeEstimate(evaluation);
  const impactSection = estimate ? `\n> **Estimated impact**: ${estimate}\n` : '';

  return `### 🔍 ScopeCI Commercial Review — ${stateBadge}

| Source | Reference | Evaluation |
|---|---|---|
${rows}

${impactSection}
${evaluation.detectedDelta.length > 0 ? `**Detected Delta:**\n${evaluation.detectedDelta.map((d) => `- ${d}`).join('\n')}\n` : ''}
**Policy Mode**: \`${evaluation.policyMode}\`  
**Required Action**: **${formatActionLabel(evaluation.recommendedAction)}**
`;
}

/**
 * One line on effort and value, saying where the number comes from. Returns
 * undefined when there is nothing to estimate (in scope, approved).
 */
export function describeEstimate(evaluation: CommercialEvaluation): string | undefined {
  const needsDecision = evaluation.state === 'CHANGE_REQUIRED' || evaluation.state === 'REVIEW_REQUIRED';
  const ownWorkItem = isPullRequestWorkItem(evaluation.issueId);
  if (evaluation.estimateSource !== 'LINEAR_ISSUE_ESTIMATE' || evaluation.estimatedHours.max <= 0) {
    if (!needsDecision) return undefined;
    return ownWorkItem ? 'not estimated (no linked issue with an estimate)' : 'not estimated (the linked issue has no estimate)';
  }

  const { min, max } = evaluation.estimatedHours;
  const hours = min === max ? formatHours(max) : `${min}–${max} hours`;
  const source = ownWorkItem
    ? 'from the hours given for this pull request'
    : `from the estimate on ${evaluation.issueId ?? 'the linked issue'}`;
  const { commercialValue: value } = evaluation;
  const money =
    value.status === 'available' && value.max > 0
      ? `${formatMoney(value.min)}${value.max !== value.min ? `–${formatMoney(value.max)}` : ''} ${value.currency} at the configured hourly rate`
      : 'no value shown because no hourly rate is configured';
  return `${hours}, ${source}; ${money}`;
}

function getStateBadge(state: CommercialEvaluation['state']): string {
  switch (state) {
    case 'IN_SCOPE':
      return '🟢 **IN SCOPE**';
    case 'APPROVED_CHANGE':
      return '🟢 **APPROVED CHANGE**';
    case 'REVIEW_REQUIRED':
      return '🟡 **REVIEW REQUIRED**';
    case 'CHANGE_REQUIRED':
      return '🔴 **CHANGE REQUIRED**';
    case 'BLOCKED':
      return '⛔ **BLOCKED**';
    case 'OVERRIDDEN':
      return '⚪ **OVERRIDDEN**';
  }
}

function formatActionLabel(action: CommercialEvaluation['recommendedAction']): string {
  switch (action) {
    case 'PROCEED':
      return 'Authorized to merge';
    case 'REQUEST_CHANGE_ORDER':
    case 'REQUEST_CHANGE_APPROVAL':
      return 'Request commercial approval / Draft Change Order';
    case 'MANUAL_PM_REVIEW':
    case 'REQUEST_PM_REVIEW':
      return 'Requires agency PM commercial review';
    case 'RESOLVE_CHANGE_ORDER':
    case 'AWAIT_APPROVAL':
      return 'Pending client signature on change order';
    default:
      return 'Review Required';
  }
}

