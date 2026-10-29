import { type CommercialEvaluation, describeEstimate } from "@workspace/commercial-engine";

export const COMMENT_MARKER = "<!-- scopeci-commercial-review -->";

/**
 * The estimate line for a project's pull request, or nothing. Without a
 * linked issue there is nothing to estimate from: the PM prices the work on
 * the change order, so "not estimated" would only be noise.
 */
export function projectEstimate(evaluation: CommercialEvaluation): string | undefined {
  const line = describeEstimate(evaluation);
  return line?.startsWith("not estimated (no linked issue") ? undefined : line;
}

export interface CommentFormatInput {
  projectName: string;
  issueIdentifier?: string;
  prNumber: number;
  /** Omitted when there is no real commit, as in the public demo. */
  headSha?: string;
  evaluation: CommercialEvaluation;
  /** The project page in ScopeCI, where the change order draft is. */
  detailsUrl?: string;
  /** The scope version the pull request was checked against, like "v3". */
  scopeVersion?: string;
  /** Something the reader should know about how complete the check was. */
  note?: string;
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

/**
 * Text as GitHub should show it in the comment: escaped as above, on one
 * line (a line break would end a table row or start a new list item), with
 * backslashes, asterisks and word-edge underscores escaped so a file name
 * like src/gift/__init__.py isn't turned into bold text. Kept out of code
 * spans, where GitHub would show the escapes themselves.
 */
function inline(input: string): string {
  return sanitizeMarkdown(input.replace(/\s*[\r\n]+\s*/g, " ").replace(/\\/g, "\\\\"))
    .replace(/\*/g, "\\*")
    .replace(/(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, "\\_");
}

/** The same words the ScopeCI app uses for each answer. */
export const VERDICT_LABELS: Record<CommercialEvaluation["state"], string> = {
  IN_SCOPE: "In scope",
  APPROVED_CHANGE: "Covered by an approved change",
  REVIEW_REQUIRED: "Needs a decision",
  CHANGE_REQUIRED: "Change order needed",
  BLOCKED: "Excluded work",
  OVERRIDDEN: "Accepted without a change order",
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
  const { projectName, issueIdentifier, prNumber, headSha, evaluation, detailsUrl, scopeVersion, note } = input;
  const reason = evaluation.evidenceBundle?.decisionExplanation?.reason;
  const estimate = projectEstimate(evaluation);

  const facts = [
    `| Project | ${inline(projectName)} |`,
    `| Pull request | #${prNumber}${headSha ? ` (\`${sanitizeMarkdown(headSha.substring(0, 7))}\`)` : ""} |`,
    ...(issueIdentifier ? [`| Linked issue | ${inline(issueIdentifier)} |`] : []),
    ...(scopeVersion ? [`| Scope version | ${inline(scopeVersion)} |`] : []),
    ...(estimate ? [`| Estimated impact | ${inline(estimate)} |`] : []),
  ];

  const found =
    evaluation.detectedDelta.length > 0
      ? `\n**What ScopeCI found**\n${evaluation.detectedDelta.map((d) => `- ${inline(d)}`).join("\n")}\n`
      : "";

  const evidence =
    evaluation.evidence.length > 0
      ? `\n<details>\n<summary>Evidence</summary>\n\n| Source | Reference | Result |\n|---|---|---|\n${evaluation.evidence
          .map((e) => `| ${inline(e.source)} | ${inline(e.value)} | ${inline(e.result)} |`)
          .join("\n")}\n\n</details>\n`
      : "";

  const link = detailsUrl
    ? `\n[${evaluation.state === "CHANGE_REQUIRED" ? "Open the change order draft" : "Open this project"} in ScopeCI](${detailsUrl})\n`
    : "";

  return `${COMMENT_MARKER}
### ScopeCI: ${VERDICT_LABELS[evaluation.state] ?? evaluation.state}

${reason ? `${inline(reason)}\n` : ""}${note ? `\n_${inline(note)}_\n` : ""}
| | |
|---|---|
${facts.join("\n")}
${found}${evidence}${link}
<sub>${MERGE_NOTE[evaluation.checkConclusion] ?? ""}</sub>
`;
}
