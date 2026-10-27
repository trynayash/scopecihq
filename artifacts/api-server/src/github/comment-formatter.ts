import { type CommercialEvaluation, describeEstimate } from "@workspace/commercial-engine";

export const COMMENT_MARKER = "<!-- scopeci-commercial-review -->";

export interface CommentFormatInput {
  projectName: string;
  issueIdentifier?: string;
  prNumber: number;
  /** Omitted when there is no real commit, as in the public demo. */
  headSha?: string;
  evaluation: CommercialEvaluation;
  /** The project page in ScopeCI, where the change order draft is. */
  detailsUrl?: string;
}

/**
 * Escapes characters that could be abused for Markdown or HTML injection.
 */
export function sanitizeMarkdown(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\|/g, "&#124;")
    .replace(/`/g, "&#96;");
}

/** The same words the ScopeCI app uses for each answer. */
export const VERDICT_LABELS: Record<CommercialEvaluation["state"], string> = {
  IN_SCOPE: "In scope",
  APPROVED_CHANGE: "Covered by an approved change",
  REVIEW_REQUIRED: "Needs a decision",
  CHANGE_REQUIRED: "Change order needed",
  BLOCKED: "Excluded work",
  OVERRIDDEN: "Overridden",
};

const MERGE_NOTE: Record<CommercialEvaluation["checkConclusion"], string> = {
  neutral: "ScopeCI only reports on this project. It doesn't affect merging.",
  success: "Nothing to do.",
  action_required: "The ScopeCI check asks for a decision before this merges.",
  failure: "The ScopeCI check fails until this work is approved as a change.",
};

/**
 * The comment ScopeCI keeps on each pull request, rewritten in place on
 * every push. Written for the developers and project managers who read it.
 */
export function formatScopeCIComment(input: CommentFormatInput): string {
  const { projectName, issueIdentifier, prNumber, headSha, evaluation, detailsUrl } = input;
  const reason = evaluation.evidenceBundle?.decisionExplanation?.reason;
  const estimate = describeEstimate(evaluation);

  const facts = [
    `| Project | ${sanitizeMarkdown(projectName)} |`,
    `| Pull request | #${prNumber}${headSha ? ` (\`${sanitizeMarkdown(headSha.substring(0, 7))}\`)` : ""} |`,
    ...(issueIdentifier ? [`| Linked issue | ${sanitizeMarkdown(issueIdentifier)} |`] : []),
    ...(estimate ? [`| Estimated impact | ${sanitizeMarkdown(estimate)} |`] : []),
  ];

  const found =
    evaluation.detectedDelta.length > 0
      ? `\n**What ScopeCI found**\n${evaluation.detectedDelta.map((d) => `- ${sanitizeMarkdown(d)}`).join("\n")}\n`
      : "";

  const evidence =
    evaluation.evidence.length > 0
      ? `\n<details>\n<summary>Evidence</summary>\n\n| Source | Reference | Result |\n|---|---|---|\n${evaluation.evidence
          .map((e) => `| ${sanitizeMarkdown(e.source)} | \`${sanitizeMarkdown(e.value)}\` | ${sanitizeMarkdown(e.result)} |`)
          .join("\n")}\n\n</details>\n`
      : "";

  const link = detailsUrl
    ? `\n[${evaluation.state === "CHANGE_REQUIRED" ? "Open the change order draft" : "Open this project"} in ScopeCI](${detailsUrl})\n`
    : "";

  return `${COMMENT_MARKER}
### ScopeCI: ${VERDICT_LABELS[evaluation.state] ?? evaluation.state}

${reason ? `${sanitizeMarkdown(reason)}\n` : ""}
| | |
|---|---|
${facts.join("\n")}
${found}${evidence}${link}
<sub>${MERGE_NOTE[evaluation.checkConclusion] ?? ""}</sub>
`;
}
