import type { CommercialEvaluation, PullRequest, LinearIssue, ScopeBaseline } from './types.js';

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

  if (evaluation.estimatedHours.max > 0) {
    lines.push(`Estimated impact:`);
    lines.push(`  ${evaluation.estimatedHours.min}–${evaluation.estimatedHours.max} hours`);
    lines.push('');
    lines.push(`Commercial impact:`);
    lines.push(`  $${evaluation.commercialValue.min.toLocaleString()}–$${evaluation.commercialValue.max.toLocaleString()} ${evaluation.commercialValue.currency}`);
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

  let impactSection = '';
  if (evaluation.estimatedHours.max > 0) {
    impactSection = `
> **Estimated impact**: ${evaluation.estimatedHours.min}–${evaluation.estimatedHours.max} engineer hours  
> **Commercial exposure**: $${evaluation.commercialValue.min.toLocaleString()}–$${evaluation.commercialValue.max.toLocaleString()} ${evaluation.commercialValue.currency}
`;
  }

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
    case 'REQUEST_CHANGE_APPROVAL':
      return 'Request commercial approval / Draft Change Order';
    case 'MANUAL_PM_REVIEW':
      return 'Requires agency PM commercial review';
    case 'RESOLVE_CHANGE_ORDER':
      return 'Pending client signature on change order';
  }
}
