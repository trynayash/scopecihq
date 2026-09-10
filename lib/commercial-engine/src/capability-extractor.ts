import crypto from "node:crypto";
import type {
  ChangedFile,
  DetectedCapability,
  EvidenceSourceQuality,
  LinearIssue,
  PullRequest,
} from "./types.js";

export interface CapabilityExtractionInput {
  pullRequest: PullRequest;
  issue?: LinearIssue;
}

export interface CapabilityExtractionResult {
  capabilities: DetectedCapability[];
  technicalCategories: {
    isRefactor: boolean;
    isTestOnly: boolean;
    isDocumentationOnly: boolean;
    isDependencyUpdate: boolean;
    isBuildScriptOnly: boolean;
    hasSchemaMigration: boolean;
    hasNewApiEndpoints: boolean;
  };
  extractionHash: string;
}

/**
 * Capability Extractor for ScopeCI Phase 4.
 *
 * Architecture Invariant (Hard Requirement 4):
 * - Extracts architectural capabilities and grounded evidence ONLY.
 * - NEVER computes or assigns a commercial state.
 *
 * Hard Requirement 5: Every claim contains ID, source quality, location, excerpt, and confidence.
 * Hard Requirement 19: Operates strictly via static inspection of paths, patches, and metadata.
 *                     NEVER executes repository code.
 * Hard Requirements 21 & 22: Distinguishes pure refactors/tests from true capability additions.
 */
export class CapabilityExtractor {
  public static readonly TAXONOMY_VERSION = "cap_tax_2026_09_v1";

  extract(input: CapabilityExtractionInput): CapabilityExtractionResult {
    const { pullRequest, issue } = input;
    const capabilities: DetectedCapability[] = [];

    // Analyze technical categories (Hard Requirement 21: False Positive Protection)
    const technicalCategories = this.classifyTechnicalScope(pullRequest.changedFiles);

    // 1. Extract capabilities from file paths and structural locations
    let capIndex = 1;
    for (const file of pullRequest.changedFiles) {
      const detected = this.detectCapabilitiesFromFile(file, capIndex);
      for (const cap of detected) {
        capabilities.push(cap);
        capIndex++;
      }
    }

    // 2. Extract capabilities from explicitly detected subsystems if present in PR
    if (pullRequest.detectedSubsystems && pullRequest.detectedSubsystems.length > 0) {
      for (const sub of pullRequest.detectedSubsystems) {
        // If not already detected from files, add with GITHUB_DIFF source quality
        const exists = capabilities.some((c) => c.name.toLowerCase() === sub.toLowerCase());
        if (!exists) {
          capabilities.push({
            id: `cap_sub_${capIndex++}`,
            name: sub.toLowerCase(),
            description: `Detected subsystem "${sub}" from PR diff analysis`,
            sourceQuality: "GITHUB_DIFF",
            evidenceLocation: `PR #${pullRequest.number} diff metadata`,
            evidenceText: `Subsystem "${sub}" identified in modified files`,
            confidence: 0.90,
            extractionMethod: "DIFF_PATH",
          });
        }
      }
    }

    // 3. Extract candidate capabilities from Linear issue (Hard Requirement 18: LINEAR_ISSUE source quality)
    if (issue) {
      const issueCapabilities = this.detectCapabilitiesFromIssue(issue, capIndex);
      for (const cap of issueCapabilities) {
        // Only add if not already captured with higher certainty
        if (!capabilities.some((c) => c.name === cap.name)) {
          capabilities.push(cap);
          capIndex++;
        }
      }
    }

    // Deduplicate capabilities by name, keeping highest confidence
    const uniqueMap = new Map<string, DetectedCapability>();
    for (const cap of capabilities) {
      const existing = uniqueMap.get(cap.name);
      if (!existing || cap.confidence > existing.confidence) {
        uniqueMap.set(cap.name, cap);
      }
    }

    const finalCapabilities = Array.from(uniqueMap.values());
    const extractionHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(finalCapabilities))
      .digest("hex");

    return {
      capabilities: finalCapabilities,
      technicalCategories,
      extractionHash,
    };
  }

  /**
   * Classifies technical categories to support false-positive resistance (Hard Requirement 21).
   */
  private classifyTechnicalScope(files: ChangedFile[]) {
    if (files.length === 0) {
      return {
        isRefactor: false,
        isTestOnly: false,
        isDocumentationOnly: false,
        isDependencyUpdate: false,
        isBuildScriptOnly: false,
        hasSchemaMigration: false,
        hasNewApiEndpoints: false,
      };
    }

    const isTestOnly = files.every((f) =>
      f.path.includes(".test.") ||
      f.path.includes(".spec.") ||
      f.path.includes("/tests/") ||
      f.path.includes("/__tests__/")
    );

    const isDocumentationOnly = files.every((f) =>
      f.path.endsWith(".md") ||
      f.path.endsWith(".txt") ||
      f.path.startsWith("docs/")
    );

    const isDependencyUpdate = files.every((f) =>
      f.path === "package.json" ||
      f.path === "pnpm-lock.yaml" ||
      f.path === "yarn.lock" ||
      f.path === "package-lock.json"
    );

    const isBuildScriptOnly = files.every((f) =>
      f.path.startsWith(".github/") ||
      f.path.startsWith("scripts/") ||
      f.path.endsWith(".config.ts") ||
      f.path.endsWith(".config.js")
    );

    const hasSchemaMigration = files.some((f) =>
      f.path.includes("/schema/") ||
      f.path.includes("/migrations/") ||
      f.path.includes("migration")
    );

    const hasNewApiEndpoints = files.some((f) =>
      (f.path.includes("/routes/") || f.path.includes("/api/")) &&
      f.status === "added"
    );

    return {
      isRefactor: false, // Determined in conjunction with diff metrics
      isTestOnly,
      isDocumentationOnly,
      isDependencyUpdate,
      isBuildScriptOnly,
      hasSchemaMigration,
      hasNewApiEndpoints,
    };
  }

  /**
   * Static path & symbol inspection (Hard Requirement 19: Pure static, no execution).
   */
  private detectCapabilitiesFromFile(file: ChangedFile, index: number): DetectedCapability[] {
    const p = file.path.toLowerCase();
    const results: DetectedCapability[] = [];

    // Organization & Multi-Tenancy / RBAC
    if (
      p.includes("organization") ||
      p.includes("rbac") ||
      p.includes("membership") ||
      p.includes("permissions") ||
      p.includes("tenant")
    ) {
      results.push({
        id: `cap_rbac_${index}`,
        name: "organization_rbac",
        description: "Multi-tenant organization role-based access control and memberships",
        sourceQuality: "GITHUB_DIFF",
        evidenceLocation: file.path,
        evidenceText: `Modified ${file.path} (+${file.linesAdded}/-${file.linesDeleted}) containing organization authorization logic`,
        confidence: 0.95,
        extractionMethod: "DIFF_PATH",
      });
    }

    // Team Invitations
    if (p.includes("invitation") || p.includes("invite") || p.includes("team-member")) {
      results.push({
        id: `cap_invite_${index}`,
        name: "team_invitations",
        description: "User and team member invitation workflows",
        sourceQuality: "GITHUB_DIFF",
        evidenceLocation: file.path,
        evidenceText: `Modified ${file.path} (+${file.linesAdded}/-${file.linesDeleted}) containing invitation endpoints/views`,
        confidence: 0.94,
        extractionMethod: "DIFF_PATH",
      });
    }

    // Password Reset
    if (p.includes("reset") || p.includes("password-reset") || p.includes("forgot-password")) {
      results.push({
        id: `cap_pwreset_${index}`,
        name: "password_reset",
        description: "Password reset token generation, verification, and update flow",
        sourceQuality: "GITHUB_DIFF",
        evidenceLocation: file.path,
        evidenceText: `Modified ${file.path} (+${file.linesAdded}/-${file.linesDeleted}) containing password reset endpoints/views`,
        confidence: 0.96,
        extractionMethod: "DIFF_PATH",
      });
    }

    // Enterprise SSO / SAML / Okta / SCIM
    if (
      p.includes("saml") ||
      p.includes("sso") ||
      p.includes("okta") ||
      p.includes("federation") ||
      p.includes("scim")
    ) {
      results.push({
        id: `cap_sso_${index}`,
        name: "enterprise_sso_saml",
        description: "Enterprise Single Sign-On (SAML 2.0 / SSO / SCIM / Okta)",
        sourceQuality: "GITHUB_DIFF",
        evidenceLocation: file.path,
        evidenceText: `Modified ${file.path} (+${file.linesAdded}/-${file.linesDeleted}) containing enterprise federation / SAML logic`,
        confidence: 0.96,
        extractionMethod: "DIFF_PATH",
      });
    }

    // User Authentication
    if (
      (p.includes("/auth/") || p.includes("login") || p.includes("session")) &&
      !results.some((r) => r.name === "organization_rbac" || r.name === "enterprise_sso_saml")
    ) {
      results.push({
        id: `cap_auth_${index}`,
        name: "authentication",
        description: "User authentication, login session handling, and credentials",
        sourceQuality: "GITHUB_DIFF",
        evidenceLocation: file.path,
        evidenceText: `Modified ${file.path} (+${file.linesAdded}/-${file.linesDeleted}) in auth module`,
        confidence: 0.92,
        extractionMethod: "DIFF_PATH",
      });
    }

    // Audit Logging
    if (p.includes("audit") || p.includes("activity-log")) {
      results.push({
        id: `cap_audit_${index}`,
        name: "audit_logging",
        description: "Security and activity audit logging",
        sourceQuality: "GITHUB_DIFF",
        evidenceLocation: file.path,
        evidenceText: `Modified ${file.path} in audit subsystem`,
        confidence: 0.93,
        extractionMethod: "DIFF_PATH",
      });
    }

    // Export Utility (Hard Requirement 21 & Canonical Case 3: Ambiguous helper/utility)
    if (p.includes("export") || p.includes("csv") || p.includes("download")) {
      results.push({
        id: `cap_export_${index}`,
        name: "export_utility",
        description: "Data export and CSV utility formatting",
        sourceQuality: "GITHUB_DIFF",
        evidenceLocation: file.path,
        evidenceText: `Modified ${file.path} implementing export/download function`,
        confidence: 0.88,
        extractionMethod: "DIFF_PATH",
      });
    }

    return results;
  }

  /**
   * Extracts candidate capabilities from Linear issue title & description.
   */
  private detectCapabilitiesFromIssue(issue: LinearIssue, startIndex: number): DetectedCapability[] {
    const text = `${issue.title || ""} ${issue.description || ""}`.toLowerCase();
    const results: DetectedCapability[] = [];
    let idx = startIndex;

    if (
      text.includes("saml") ||
      text.includes("sso") ||
      text.includes("okta") ||
      text.includes("federation") ||
      text.includes("scim")
    ) {
      results.push({
        id: `cap_iss_sso_${idx++}`,
        name: "enterprise_sso_saml",
        description: "Enterprise SSO / SAML federation requested in Linear work item",
        sourceQuality: "LINEAR_ISSUE",
        evidenceLocation: `${issue.id} title/description`,
        evidenceText: `Issue ${issue.id} specifies enterprise federation / SSO: "${issue.title}"`,
        confidence: 0.92,
        extractionMethod: "SEMANTIC_INTERPRETATION",
      });
    }

    if (text.includes("organization") || text.includes("rbac") || text.includes("roles") || text.includes("permissions")) {
      results.push({
        id: `cap_iss_rbac_${idx++}`,
        name: "organization_rbac",
        description: "Organization-level permissions requested in Linear work item",
        sourceQuality: "LINEAR_ISSUE",
        evidenceLocation: `${issue.id} title/description`,
        evidenceText: `Issue ${issue.id} specifies: "${issue.title}"`,
        confidence: 0.88,
        extractionMethod: "SEMANTIC_INTERPRETATION",
      });
    }

    if (text.includes("password reset") || text.includes("reset password")) {
      results.push({
        id: `cap_iss_reset_${idx++}`,
        name: "password_reset",
        description: "Password reset capability described in work item",
        sourceQuality: "LINEAR_ISSUE",
        evidenceLocation: `${issue.id} title/description`,
        evidenceText: `Issue ${issue.id} specifies: "${issue.title}"`,
        confidence: 0.90,
        extractionMethod: "SEMANTIC_INTERPRETATION",
      });
    }

    if (text.includes("csv") || text.includes("export audit")) {
      results.push({
        id: `cap_iss_export_${idx++}`,
        name: "export_utility",
        description: "Export utility requested in work item",
        sourceQuality: "LINEAR_ISSUE",
        evidenceLocation: `${issue.id} title/description`,
        evidenceText: `Issue ${issue.id} specifies: "${issue.title}"`,
        confidence: 0.85,
        extractionMethod: "SEMANTIC_INTERPRETATION",
      });
    }

    return results;
  }
}
