export interface ExtractedIssueRef {
  identifier: string; // e.g. "ENG-184"
  linkMethod: "BRANCH_NAME" | "PR_TITLE" | "PR_BODY" | "COMMIT_MESSAGE";
  confidence: number; // 0.0 - 1.0
  evidence: string;
}

export interface ExtractionInput {
  branchName?: string;
  prTitle?: string;
  prBody?: string | null;
  commitMessages?: string[];
}

// Deterministic pattern matching Linear / Jira ticket identifiers like ENG-184, PROJ-101, etc.
const ISSUE_REGEX = /\b([a-z]{2,10}-\d+)\b/gi;

/**
 * Deterministically extracts issue references across branch, title, body, and commits.
 * Returns all unique issue references paired with the highest-confidence source.
 */
export function extractIssueReferences(input: ExtractionInput): ExtractedIssueRef[] {
  const map = new Map<string, ExtractedIssueRef>();

  const addMatch = (
    match: string,
    method: ExtractedIssueRef["linkMethod"],
    confidence: number,
    evidenceText: string
  ) => {
    const normalized = match.trim().toUpperCase();
    const existing = map.get(normalized);
    // Keep the highest confidence match if already found
    if (!existing || confidence > existing.confidence) {
      map.set(normalized, {
        identifier: normalized,
        linkMethod: method,
        confidence,
        evidence: evidenceText.trim().substring(0, 255),
      });
    }
  };

  // 1. Branch name (High confidence: 0.98)
  if (input.branchName) {
    const matches = input.branchName.match(ISSUE_REGEX);
    if (matches) {
      for (const m of matches) {
        addMatch(m, "BRANCH_NAME", 0.98, `Extracted from branch name: "${input.branchName}"`);
      }
    }
  }

  // 2. PR Title (High confidence: 0.96)
  if (input.prTitle) {
    const matches = input.prTitle.match(ISSUE_REGEX);
    if (matches) {
      for (const m of matches) {
        addMatch(m, "PR_TITLE", 0.96, `Extracted from PR title: "${input.prTitle}"`);
      }
    }
  }

  // 3. PR Body (Confidence: 0.92)
  if (input.prBody) {
    const matches = input.prBody.match(ISSUE_REGEX);
    if (matches) {
      for (const m of matches) {
        // Extract surrounding line for clear context evidence
        const line = input.prBody.split("\n").find((l) => l.toLowerCase().includes(m.toLowerCase())) || input.prBody;
        addMatch(m, "PR_BODY", 0.92, `Extracted from PR body: "${line.substring(0, 100)}"`);
      }
    }
  }

  // 4. Commit messages (Confidence: 0.90)
  if (input.commitMessages && input.commitMessages.length > 0) {
    for (const msg of input.commitMessages) {
      const matches = msg.match(ISSUE_REGEX);
      if (matches) {
        for (const m of matches) {
          addMatch(m, "COMMIT_MESSAGE", 0.9, `Extracted from commit: "${msg.substring(0, 100)}"`);
        }
      }
    }
  }

  return Array.from(map.values());
}
