import type { CommercialEvaluation } from "@workspace/commercial-engine";

export const COMMENT_MARKER = "<!-- scopeci-commercial-review -->";

export interface CommentFormatInput {
  projectName: string;
  issueIdentifier?: string;
  prNumber: number;
  headSha: string;
  evaluation: CommercialEvaluation;
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
    .replace(/'/g, "&#039;");
}

/**
 * Generates the idempotent ScopeCI PR review comment markdown.
 */
export function formatScopeCIComment(input: CommentFormatInput): string {
  const { projectName, issueIdentifier, prNumber, headSha, evaluation } = input;

  const safeProject = sanitizeMarkdown(projectName);
  const safeIssue = issueIdentifier ? sanitizeMarkdown(issueIdentifier) : "Unlinked";
  const shortSha = headSha.substring(0, 7);

  const statusLabel = formatStatusLabel(evaluation.state);

  const evidenceRows = evaluation.evidence.map((e) => {
    const icon = e.tone === "ok" ? "✓" : e.tone === "warn" ? "⚠" : "ℹ";
    return `| **${sanitizeMarkdown(e.source)}** | \`${sanitizeMarkdown(e.value)}\` | ${icon} ${sanitizeMarkdown(e.result)} |`;
  }).join("\n");

  let deltaSection = "";
  if (evaluation.detectedDelta && evaluation.detectedDelta.length > 0) {
    deltaSection = `\n**Detected Scope Elements:**\n${evaluation.detectedDelta.map((d) => `- ${sanitizeMarkdown(d)}`).join("\n")}\n`;
  }

  let commercialImpact = "";
  if (evaluation.estimatedHours && evaluation.estimatedHours.max > 0) {
    commercialImpact = `
> **Estimated Engineering Scope**: ${evaluation.estimatedHours.min}–${evaluation.estimatedHours.max} hours  
> **Commercial Context**: $${evaluation.commercialValue.min.toLocaleString()}–$${evaluation.commercialValue.max.toLocaleString()} ${evaluation.commercialValue.currency}
`;
  }

  return `${COMMENT_MARKER}
### 🔍 ScopeCI Commercial Review — ${statusLabel}

| Attribute | Details |
|---|---|
| **Project** | ${safeProject} |
| **Work Item** | ${safeIssue} |
| **Pull Request** | #${prNumber} (\`${shortSha}\`) |
| **Policy Mode** | \`${evaluation.policyMode}\` (Non-blocking) |
| **Commercial State** | ${formatStateDescription(evaluation.state)} |

| Source | Reference | Assessment |
|---|---|---|
${evidenceRows}
${commercialImpact}${deltaSection}
---
*ScopeCI is operating in **Observe** mode. Merges are not blocked. This assessment provides commercial alignment evidence and does not constitute formal legal determination.*
`;
}

function formatStatusLabel(state: CommercialEvaluation["state"]): string {
  switch (state) {
    case "IN_SCOPE":
      return "🟢 IN SCOPE";
    case "APPROVED_CHANGE":
      return "🟢 APPROVED CHANGE";
    case "REVIEW_REQUIRED":
      return "🟡 REVIEW REQUIRED";
    case "CHANGE_REQUIRED":
      return "🟠 CHANGE ORDER REQUIRED";
    case "BLOCKED":
      return "⚪ OBSERVED EXCLUSION";
    case "OVERRIDDEN":
      return "⚪ OVERRIDDEN";
  }
}

function formatStateDescription(state: CommercialEvaluation["state"]): string {
  switch (state) {
    case "IN_SCOPE":
      return "Work items align with active statement of work deliverables";
    case "APPROVED_CHANGE":
      return "Authorized under approved change order specification";
    case "REVIEW_REQUIRED":
      return "Awaiting commercial scope confirmation by project management";
    case "CHANGE_REQUIRED":
      return "Scope boundary expansion detected — commercial agreement recommended";
    case "BLOCKED":
      return "Identified as outside contracted scope baseline";
    case "OVERRIDDEN":
      return "Authorized via project management administrative override";
  }
}
