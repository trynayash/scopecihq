import type { LinearIssue } from './types.js';

/**
 * A pull request with no linked issue is still judged on its own title,
 * branch, body and files. It stands in as its own work item, so the
 * evaluator compares it with the scope instead of stopping at "unlinked".
 * Its hours are only ever what someone typed in; nothing is guessed.
 */
export const PULL_REQUEST_WORK_ITEM = 'the pull request';

export function pullRequestAsWorkItem(estimateHours?: number): LinearIssue {
  return {
    id: PULL_REQUEST_WORK_ITEM,
    title: '',
    status: 'Open',
    estimateHours: estimateHours && estimateHours > 0 ? estimateHours : undefined,
  };
}

export function isPullRequestWorkItem(issueId: string | undefined): boolean {
  return issueId === PULL_REQUEST_WORK_ITEM;
}
