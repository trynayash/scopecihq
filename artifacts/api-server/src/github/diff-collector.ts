export interface RawGitHubFile {
  filename: string;
  status: string; // added, modified, removed, deleted, renamed
  additions: number;
  deletions: number;
  changes?: number;
  patch?: string;
  previous_filename?: string;
  is_binary?: boolean;
}

/**
 * What ScopeCI keeps about one changed file: its name, status and line
 * counts. The diff text itself is never kept; the check reads file names
 * only, as the site says.
 */
export interface NormalizedFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  isBinary?: boolean;
  previousFilename?: string;
}

export interface NormalizedDiffAnalysis {
  headSha: string;
  files: NormalizedFileChange[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
  };
  detectedSubsystems: string[];
  limitations: string[];
}

// Everything GitHub lists (it lists at most 3,000 files). Only names and
// counts are kept, so there's no reason to stop sooner.
const MAX_FILES_PROCESSED = 3000;

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "ico", "svg", "webp", "pdf", "zip", "tar", "gz", "wasm", "exe", "dll", "so", "dylib", "mp4", "mp3"
]);

/**
 * Safely normalizes GitHub PR files into a bounded, well-typed diff analysis representation.
 * Prevents memory exhaustion, recognizes binary files, renamed files, and infers affected subsystems.
 */
export function normalizePullRequestDiff(
  headSha: string,
  rawFiles: RawGitHubFile[]
): NormalizedDiffAnalysis {
  const limitations: string[] = [];
  const normalizedFiles: NormalizedFileChange[] = [];
  const detectedSubsystems = new Set<string>();

  let totalAdditions = 0;
  let totalDeletions = 0;

  const filesToProcess = rawFiles.slice(0, MAX_FILES_PROCESSED);
  if (rawFiles.length > MAX_FILES_PROCESSED) {
    limitations.push(`GitHub PR diff truncated: processed ${MAX_FILES_PROCESSED} of ${rawFiles.length} files.`);
  }

  for (const raw of filesToProcess) {
    const ext = raw.filename.split(".").pop()?.toLowerCase() || "";
    const isBinary = Boolean(raw.is_binary || BINARY_EXTENSIONS.has(ext));

    let status: NormalizedFileChange["status"] = "modified";
    if (raw.status === "added") status = "added";
    else if (raw.status === "removed" || raw.status === "deleted") status = "deleted";
    else if (raw.status === "renamed") status = "renamed";

    const additions = Number(raw.additions) || 0;
    const deletions = Number(raw.deletions) || 0;
    totalAdditions += additions;
    totalDeletions += deletions;

    normalizedFiles.push({
      path: raw.filename,
      status,
      additions,
      deletions,
      isBinary,
      previousFilename: raw.previous_filename,
    });

    // Subsystem inference from path semantics
    inferSubsystems(raw.filename, detectedSubsystems);
  }

  return {
    headSha,
    files: normalizedFiles,
    totals: {
      files: rawFiles.length,
      additions: totalAdditions,
      deletions: totalDeletions,
    },
    detectedSubsystems: Array.from(detectedSubsystems),
    limitations,
  };
}

/**
 * Deterministic subsystem mapping from repository paths.
 */
function inferSubsystems(filePath: string, subsystems: Set<string>): void {
  const lower = filePath.toLowerCase();

  if (lower.includes("org") || lower.includes("tenant") || lower.includes("member") || lower.includes("invite") || lower.includes("permission") || lower.includes("rbac")) {
    subsystems.add("organization_rbac");
    if (lower.includes("invite") || lower.includes("team")) {
      subsystems.add("team_invitations");
    }
  }

  if (lower.includes("auth") || lower.includes("login") || lower.includes("password") || lower.includes("token") || lower.includes("session")) {
    subsystems.add("user_authentication");
  }

  if (lower.includes("audit") || lower.includes("csv") || lower.includes("export")) {
    subsystems.add("audit_log_export");
  }
}
