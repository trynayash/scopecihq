import crypto from "node:crypto";
import type {
  CandidateDeliverableMatch,
  ChangeOrder,
  CheckRunConclusion,
  CommercialEvaluation,
  CommercialState,
  ContractClause,
  ContractEvidence,
  DecisionExplanation,
  Deliverable,
  DetectedCapability,
  EstimateSource,
  EvaluationEvidence,
  EvaluationIdentity,
  EvaluationStatus,
  EvidenceBundle,
  LinearIssue,
  PolicyConfig,
  PolicyMode,
  PullRequest,
  ReviewReasonCode,
  ScopeBaseline,
  ScopeDeltaStatement,
  ScopeTaxonomy,
} from "./types.js";
import { DEFAULT_POLICY_CONFIG } from "./types.js";
import { CapabilityExtractor } from "./capability-extractor.js";
import {
  capabilityNames,
  type ContractPhraseMatch,
  matchContractPhrases,
  textCoversMatch,
  tokenize,
} from "./contract-matcher.js";
import { isPullRequestWorkItem } from "./work-item.js";

export interface Phase4EvaluationInput {
  baseline?: ScopeBaseline;
  pullRequest: PullRequest;
  issue?: LinearIssue;
  approvedChangeOrders?: ChangeOrder[];
  policyMode?: PolicyMode;
  policyConfig?: Partial<PolicyConfig>;
  hourlyRate?: number;
  documentVersion?: string;
  diffAnalysisVersion?: number;
  modelVersion?: string;
  promptVersion?: string;
}

export const EVALUATOR_VERSION = "scopeci-evaluator-v4.2";
export const ESTIMATION_RULES_VERSION = "est_rules_2026_10_v2";
export const SCOPE_TAXONOMY_VERSION = "scope_tax_2026_10_v2";

function normalizeKeyword(str: string): string {
  return str.toLowerCase().replace(/[\s_\-]+/g, "");
}

/**
 * Phase 4 Commercial Intelligence Evaluator.
 *
 * Implements the full 30 Hard Requirements:
 * 1. Sets commercialConfidence to a fixed value for each scope category, never from an LLM. No model runs here,
 *    so no model confidence is recorded.
 * 2. Prioritizes explicit contract exclusions over absence.
 * 3. Never treats keyword matching as semantic certainty.
 * 4. Consumes capabilities from CapabilityExtractor without coupling to commercial state.
 * 5. Backs every claim with specific evidence IDs.
 * 6. Never invents commercial value ($ amounts) without configured rates.
 * 7. Keeps estimation independent of scope classification. Hours come only from the linked
 *    issue's own estimate; without one the work is reported as not estimated.
 * 8. Rejects superseded or expired baselines with INSUFFICIENT_EVIDENCE / REVIEW_REQUIRED.
 * 9. Evaluates Change Orders strictly in relationship to contract and baseline versions.
 * 10. Computes 12-component semantic identity hash.
 * 11. Emits an immutable EvidenceBundle and DecisionExplanation.
 * 12. Fails conservatively to REVIEW_REQUIRED on model/parsing failures.
 */
export function evaluateCommercialScope(input: Phase4EvaluationInput): CommercialEvaluation {
  const {
    baseline,
    pullRequest,
    issue,
    approvedChangeOrders = [],
    policyMode = "REVIEW",
    policyConfig: customConfig = {},
    hourlyRate,
    documentVersion = "sow_v1.0",
    diffAnalysisVersion = 1,
    modelVersion = "deterministic-v4",
    promptVersion = "sow_decomp_v1.0",
  } = input;

  const config: PolicyConfig = {
    ...DEFAULT_POLICY_CONFIG,
    ...customConfig,
    hourlyRate: hourlyRate ?? customConfig.hourlyRate ?? DEFAULT_POLICY_CONFIG.hourlyRate,
  };

  const evaluationId = `eval_${pullRequest.id}_${Date.now()}`;
  const evaluatedAt = new Date().toISOString();
  const evidence: EvaluationEvidence[] = [];
  const detectedDelta: string[] = [];
  const scopeDeltaStatements: ScopeDeltaStatement[] = [];
  const uncertainties: string[] = [];
  const missingEvidence: string[] = [];
  const evidenceIds: string[] = [];

  // ------------------------------------------------------------------
  // Hard Requirement 8: Expired / Superseded / Missing Contract Baseline
  // ------------------------------------------------------------------
  if (!baseline || baseline.status === "superseded") {
    const isSuperseded = baseline?.status === "superseded";
    const reviewReason: ReviewReasonCode = isSuperseded ? "EXPIRED_BASELINE" : "MISSING_CONTRACT_EVIDENCE";
    const reasonText = isSuperseded
      ? `Active scope baseline ${baseline.version} is superseded; review required to align with current contract revision`
      : "No active scope baseline found for repository; commercial evaluation cannot proceed without contracted SOW";

    uncertainties.push(reasonText);
    missingEvidence.push("Valid active Scope Baseline entity in database");

    const explanation: DecisionExplanation = {
      decision: "REVIEW_REQUIRED",
      reason: reasonText,
      reviewReasonCode: reviewReason,
      evidenceIds: [],
      uncertainties,
      missingEvidence,
      recommendedAction: "REQUEST_PM_REVIEW",
    };

    const identityHash = computeEvaluationIdentityHash({
      baselineVersion: baseline?.version || "none",
      documentVersion,
      issueSnapshotHash: computeIssueSnapshotHash(issue),
      headSha: pullRequest.headSha || "sha_unknown",
      diffAnalysisVersion,
      evaluatorVersion: EVALUATOR_VERSION,
      modelVersion,
      promptVersion,
      capabilityTaxonomyVersion: CapabilityExtractor.TAXONOMY_VERSION,
      scopeTaxonomyVersion: SCOPE_TAXONOMY_VERSION,
      estimationRulesVersion: ESTIMATION_RULES_VERSION,
      policyConfigVersion: config.version,
    });

    const bundle: EvidenceBundle = {
      evaluationId,
      identityHash,
      state: "REVIEW_REQUIRED",
      taxonomy: "INSUFFICIENT_EVIDENCE",
      commercialConfidence: 0.95,
      contractEvidence: [],
      candidateDeliverables: [],
      issueEvidence: issue
        ? { identifier: issue.id, title: issue.title, status: issue.status, estimateHours: issue.estimateHours }
        : null,
      engineeringEvidence: {
        prNumber: pullRequest.number,
        headSha: pullRequest.headSha || "sha_unknown",
        filesChanged: pullRequest.filesChanged,
        additions: pullRequest.additions,
        deletions: pullRequest.deletions,
        primaryModules: Array.from(new Set(pullRequest.changedFiles.map((f) => f.module))),
        changedFiles: pullRequest.changedFiles.map((f) => f.path),
      },
      detectedCapabilities: [],
      scopeDelta: [{ statement: reasonText, evidenceIdRefs: [], nature: "AMBIGUITY" }],
      impact: {
        estimatedHours: { min: 0, max: 0 },
        estimateSource: "NOT_ESTIMATED",
        commercialValue: { currency: "USD", min: 0, max: 0, status: "unavailable" },
      },
      decisionExplanation: explanation,
      evaluatedAt,
    };

    return {
      evaluationId,
      pullRequestId: pullRequest.id,
      status: "COMPLETED",
      state: "REVIEW_REQUIRED",
      taxonomy: "INSUFFICIENT_EVIDENCE",
      confidence: 0.95,
      commercialConfidence: 0.95,
      evidence: [
        {
          source: "SOW",
          mark: "sow",
          label: "Contract Baseline",
          value: baseline ? `${baseline.version} (SUPERSEDED)` : "Missing Baseline",
          result: "no match",
          tone: "bad",
        },
      ],
      evidenceBundle: bundle,
      identityHash,
      detectedDelta: [reasonText],
      estimatedHours: { min: 0, max: 0 },
      estimateSource: "NOT_ESTIMATED",
      commercialValue: { currency: "USD", min: 0, max: 0, status: "unavailable" },
      recommendedAction: "MANUAL_PM_REVIEW",
      checkConclusion: resolveCheckConclusion("REVIEW_REQUIRED", policyMode),
      policyMode,
      reviewReasonCode: reviewReason,
      evaluatorVersion: EVALUATOR_VERSION,
      evaluatedAt,
    };
  }

  // ------------------------------------------------------------------
  // Hard Requirement 12 & Case 5: Unlinked PR (No Linear Issue)
  // ------------------------------------------------------------------
  if (!issue) {
    const unlinkedEvId = "ev_unlinked_pr";
    evidenceIds.push(unlinkedEvId);

    evidence.push({
      source: "GITHUB",
      mark: "github",
      label: "Pull Request",
      value: `PR #${pullRequest.number} (${pullRequest.filesChanged} files)`,
      result: "read",
      tone: "ok",
    });
    evidence.push({
      source: "LINEAR",
      mark: "linear",
      label: "Work Item",
      value: "No linked issue found",
      result: "unlinked",
      tone: "warn",
    });
    evidence.push({
      source: "SOW",
      mark: "sow",
      label: "Contract Baseline",
      value: `${baseline.version} — ${baseline.title}`,
      result: "no match",
      tone: "bad",
    });

    const unlinkedStatement = "No tracked Linear work item associated with pull request branch or body";
    detectedDelta.push(unlinkedStatement);
    scopeDeltaStatements.push({
      statement: unlinkedStatement,
      evidenceIdRefs: [unlinkedEvId],
      nature: "AMBIGUITY",
    });
    missingEvidence.push("Linear work item link on PR branch or body");

    const explanation: DecisionExplanation = {
      decision: "REVIEW_REQUIRED",
      reason: unlinkedStatement,
      reviewReasonCode: "UNLINKED_ISSUE",
      evidenceIds,
      uncertainties,
      missingEvidence,
      recommendedAction: "REQUEST_PM_REVIEW",
    };

    const identityHash = computeEvaluationIdentityHash({
      baselineVersion: baseline.version,
      documentVersion,
      issueSnapshotHash: computeIssueSnapshotHash(issue),
      headSha: pullRequest.headSha || "sha_unknown",
      diffAnalysisVersion,
      evaluatorVersion: EVALUATOR_VERSION,
      modelVersion,
      promptVersion,
      capabilityTaxonomyVersion: CapabilityExtractor.TAXONOMY_VERSION,
      scopeTaxonomyVersion: SCOPE_TAXONOMY_VERSION,
      estimationRulesVersion: ESTIMATION_RULES_VERSION,
      policyConfigVersion: config.version,
    });

    const bundle: EvidenceBundle = {
      evaluationId,
      identityHash,
      state: "REVIEW_REQUIRED",
      taxonomy: "INSUFFICIENT_EVIDENCE",
      commercialConfidence: 0.95,
      contractEvidence: [],
      candidateDeliverables: [],
      issueEvidence: null,
      engineeringEvidence: {
        prNumber: pullRequest.number,
        headSha: pullRequest.headSha || "sha_unknown",
        filesChanged: pullRequest.filesChanged,
        additions: pullRequest.additions,
        deletions: pullRequest.deletions,
        primaryModules: Array.from(new Set(pullRequest.changedFiles.map((f) => f.module))),
        changedFiles: pullRequest.changedFiles.map((f) => f.path),
      },
      detectedCapabilities: [],
      scopeDelta: scopeDeltaStatements,
      impact: {
        estimatedHours: { min: 0, max: 0 },
        estimateSource: "NOT_ESTIMATED",
        commercialValue: { currency: "USD", min: 0, max: 0, status: "unavailable" },
      },
      decisionExplanation: explanation,
      evaluatedAt,
    };

    return {
      evaluationId,
      pullRequestId: pullRequest.id,
      status: "COMPLETED",
      state: "REVIEW_REQUIRED",
      taxonomy: "INSUFFICIENT_EVIDENCE",
      confidence: 0.95,
      commercialConfidence: 0.95,
      evidence,
      evidenceBundle: bundle,
      identityHash,
      detectedDelta,
      estimatedHours: { min: 0, max: 0 },
      estimateSource: "NOT_ESTIMATED",
      commercialValue: { currency: "USD", min: 0, max: 0, status: "unavailable" },
      recommendedAction: "MANUAL_PM_REVIEW",
      checkConclusion: resolveCheckConclusion("REVIEW_REQUIRED", policyMode),
      policyMode,
      reviewReasonCode: "UNLINKED_ISSUE",
      evaluatorVersion: EVALUATOR_VERSION,
      evaluatedAt,
    };
  }

  // ------------------------------------------------------------------
  // Hard Requirement 4: Capability Extraction (Separated from Reasoning)
  // ------------------------------------------------------------------
  const extractor = new CapabilityExtractor();
  const { capabilities: detectedCapabilities, technicalCategories } = extractor.extract({
    pullRequest,
    issue,
  });

  for (const cap of detectedCapabilities) {
    evidenceIds.push(cap.id);
  }

  // Nothing new is built when a PR only touches tests, docs, dependencies or
  // build files, or only deletes files.
  const removalOnly =
    pullRequest.changedFiles.length > 0 && pullRequest.changedFiles.every((f) => f.status === "deleted");
  const maintenanceOnly =
    technicalCategories.isTestOnly ||
    technicalCategories.isDocumentationOnly ||
    technicalCategories.isDependencyUpdate ||
    technicalCategories.isBuildScriptOnly ||
    removalOnly;

  // The SOW's own wording, matched against paths, titles and the issue. This
  // is what catches work the capability vocabulary has no name for.
  const phraseMatches = matchContractPhrases({ baseline, pullRequest, issue, maintenanceOnly });
  // Whether SOW wording names a built-in capability. A word that is only part
  // of one ("team" in "Team Dashboard", "authentication" in "two-factor
  // authentication") doesn't.
  // What the pull request builds or names in a title, so an item's exception
  // it names ("single sign-on except Google" for Google SSO) is left to the
  // phrase matcher, which asks about it rather than drafting a change order.
  const names = capabilityNames(() =>
    tokenize(
      [
        pullRequest.title,
        pullRequest.branch ?? pullRequest.headBranch ?? "",
        ...pullRequest.changedFiles.filter((f) => f.status !== "deleted").map((f) => f.path),
      ].join(" "),
    ),
  );
  // Best evidence first: it is the one named when the work is in scope.
  const inclusionMatches = phraseMatches
    .filter((m) => m.kind === "inclusion")
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.coverage - a.coverage);

  // ------------------------------------------------------------------
  // Hard Requirement 13: Multi-Deliverable Candidate Matching
  // ------------------------------------------------------------------
  const candidateDeliverables: CandidateDeliverableMatch[] = [];
  for (const deliv of baseline.deliverables) {
    const matchedKws = deliv.keywords.filter((kw) => {
      const k = kw.toLowerCase();
      const inTitle = issue?.title ? issue.title.toLowerCase().includes(k) : false;
      const inDesc = issue?.description ? issue.description.toLowerCase().includes(k) : false;
      const inCap = detectedCapabilities.some((c) => names.wholly(kw, c.name));
      return inTitle || inDesc || inCap;
    });
    // "Audit Logging" names audit_logging even though no single title word does.
    const titleNamesCapability = detectedCapabilities.some((c) => names.wholly(deliv.title, c.name));

    if (matchedKws.length > 0 || titleNamesCapability || (issue?.deliverableId && issue.deliverableId === deliv.id)) {
      const conf = issue?.deliverableId === deliv.id ? 0.98 : Math.min(0.90, 0.60 + matchedKws.length * 0.15);
      candidateDeliverables.push({
        deliverableId: deliv.id,
        clauseId: deliv.clauseId,
        title: deliv.title,
        confidence: conf,
        matchedKeywords: matchedKws,
        sourceQuality: issue?.deliverableId === deliv.id ? "LINEAR_ISSUE" : "INFERRED",
      });
    }
  }

  // Sort candidates by confidence
  candidateDeliverables.sort((a, b) => b.confidence - a.confidence);
  const primaryDeliverableMatch = candidateDeliverables[0];
  const primaryDeliverable = primaryDeliverableMatch
    ? baseline.deliverables.find((d) => d.id === primaryDeliverableMatch.deliverableId)
    : undefined;

  // Locate associated clauses
  const contractEvidenceList: ContractEvidence[] = [];
  const relevantClauses: ContractClause[] = [];
  // Clauses whose wording matched, looked up once rather than per clause: a
  // numbered SOW can have a clause per line.
  const excludedByWording = new Set(phraseMatches.filter((m) => m.kind === "exclusion").map((m) => m.clause.id));
  const includedByWording = new Set(inclusionMatches.map((m) => m.clause.id));

  for (const clause of baseline.clauses) {
    // Check if deliverable references this clause
    const isDeliverableClause = primaryDeliverable?.clauseId === clause.id;
    // Check if clause mentions any detected capability, or its wording matched the PR
    const mentionsExclusion =
      clause.exclusions.some((exc) => detectedCapabilities.some((cap) => names.item("exclusion", exc, cap.name))) ||
      excludedByWording.has(clause.id);
    const mentionsInclusion =
      clause.inclusions.some((inc) => {
        const i = normalizeKeyword(inc);
        return detectedCapabilities.some((cap) => {
          const c = normalizeKeyword(cap.name);
          return i === c || i.includes(c) || c.includes(i);
        });
      }) || includedByWording.has(clause.id);

    if (isDeliverableClause || mentionsExclusion || mentionsInclusion) {
      relevantClauses.push(clause);
      contractEvidenceList.push({
        clauseId: clause.id,
        clauseRef: clause.clauseRef,
        title: clause.title,
        page: clause.sourcePage,
        location: clause.sourceLocation,
        legalTextExcerpt: clause.legalText,
        boundarySummary: primaryDeliverable?.scopeBoundary || clause.title,
        isExplicitlyExcluded: mentionsExclusion,
        isExplicitlyIncluded: mentionsInclusion,
      });
      evidenceIds.push(clause.id);
    }
  }

  // ------------------------------------------------------------------
  // Hard Requirement 9: Versioned Change Order Evaluation
  // ------------------------------------------------------------------
  const approvedCOs = approvedChangeOrders.filter((co) => co.status === "APPROVED");
  const changeOrderCoveredCapabilities: DetectedCapability[] = [];
  const explicitlyExcludedCapabilities: Array<{ capability: DetectedCapability; clause: ContractClause }> = [];
  // Excluded work nothing new shows: only described, only in tests or docs,
  // its words only in separate places ("spread"), or matched without what
  // makes it the excluded work (`match.missingHead`, `match.missingQualifier`).
  const weaklyExcludedCapabilities: Array<{
    capability: DetectedCapability;
    clause: ContractClause;
    spread?: boolean;
    match?: ContractPhraseMatch;
  }> = [];
  const clearlyInScopeCapabilities: DetectedCapability[] = [];
  const ambiguousCapabilities: DetectedCapability[] = [];
  const uncontractedCapabilities: DetectedCapability[] = [];
  // SOW items already accounted for by a capability, so phrase matching doesn't report them twice.
  const reportedExclusions = new Set<string>();
  // SOW items the pull request matched strongly in their own words.
  const strongPhraseExclusions = new Map(
    phraseMatches.filter((m) => m.kind === "exclusion" && m.strong).map((m) => [`${m.clause.id}::${m.phrase}`, m]),
  );

  for (const cap of detectedCapabilities) {
    // Hard Requirement 2: Check Explicit Exclusion (Stronger than absence)
    let explicitExclusion: { clause: ContractClause; exclusion: string } | undefined;
    for (const cl of baseline.clauses) {
      const exclusion = cl.exclusions.find((exc) => names.item("exclusion", exc, cap.name));
      if (exclusion) {
        explicitExclusion = { clause: cl, exclusion };
        break;
      }
    }
    const exclusionKey = explicitExclusion && `${explicitExclusion.clause.id}::${explicitExclusion.exclusion}`;

    // 1. Check Change Order coverage
    const coMatch = approvedCOs.find((co) =>
      co.authorizedSubsystems.some((sub) => {
        const s = normalizeKeyword(sub);
        const c = normalizeKeyword(cap.name);
        return s === c || s.includes(c) || c.includes(s) || (s.includes("rbac") && c.includes("rbac"));
      })
    );
    if (coMatch) {
      changeOrderCoveredCapabilities.push(cap);
      if (exclusionKey) reportedExclusions.add(exclusionKey);
      continue;
    }

    // 2. Explicit exclusion. Tests, docs or build files that mention it build
    // nothing new, so they are a question for a person, not a change order.
    if (explicitExclusion && exclusionKey) {
      // When the pull request matched other words of the same item, it is
      // reported in those words below: "workspace member roles" reads better
      // to a client than organization_rbac, which only "permissions" names.
      const inOwnWords = strongPhraseExclusions.get(exclusionKey);
      if (!inOwnWords || names.item("exclusion", inOwnWords.matchedPart, cap.name)) {
        reportedExclusions.add(exclusionKey);
        (maintenanceOnly ? weaklyExcludedCapabilities : explicitlyExcludedCapabilities).push({
          capability: cap,
          clause: explicitExclusion.clause,
        });
      }
      continue;
    }

    // 3. Check Explicit Inclusion in contract clauses or deliverable keywords
    const isExplicitlyIncluded =
      (primaryDeliverable !== undefined &&
        [primaryDeliverable.title, ...primaryDeliverable.keywords].some((kw) => names.wholly(kw, cap.name))) ||
      relevantClauses.some((cl) =>
        cl.inclusions.some((inc) => {
          const i = normalizeKeyword(inc);
          const c = normalizeKeyword(cap.name);
          return i === c || i.includes(c) || c.includes(i);
        })
      ) ||
      // The SOW's wording for it, e.g. "member invitations" for team_invitations,
      // or "email and password login" for authentication.
      baseline.clauses.some((cl) =>
        cl.inclusions.some((inc) => names.partly(inc, cap.name) || names.item("inclusion", inc, cap.name)),
      );

    if (isExplicitlyIncluded) {
      clearlyInScopeCapabilities.push(cap);
      continue;
    }

    // 4. Hard Requirement 2 & 21: Distinguish Ambiguity / Internal Utilities from Scope Expansion
    // "Never equate 'not mentioned in SOW' with 'out of scope'."
    if (
      cap.name.includes("export") ||
      cap.name.includes("utility") ||
      cap.name.includes("helper") ||
      cap.name.includes("logging") ||
      maintenanceOnly
    ) {
      ambiguousCapabilities.push(cap);
    } else {
      uncontractedCapabilities.push(cap);
    }
  }

  // Exclusions found through the SOW's wording. Matched in changed files or
  // titles, they are excluded work; matched only in a description, they are a
  // question for a person.
  const phraseCapabilities: DetectedCapability[] = [];
  for (const match of phraseMatches) {
    if (match.kind !== "exclusion" || reportedExclusions.has(`${match.clause.id}::${match.phrase}`)) continue;

    const capability = capabilityFromMatch(match, phraseCapabilities.length + 1);
    phraseCapabilities.push(capability);
    evidenceIds.push(capability.id);

    const coversMatch = (co: ChangeOrder) =>
      textCoversMatch([co.title, co.reason, ...co.authorizedSubsystems].join(" "), match);
    if (approvedCOs.some(coversMatch)) {
      changeOrderCoveredCapabilities.push(capability);
    } else if (match.strong) {
      explicitlyExcludedCapabilities.push({ capability, clause: match.clause });
    } else {
      // Found in changed files or titles, but never together in one of them.
      const spread = match.evidence.some((e) => e.strength !== "text");
      weaklyExcludedCapabilities.push({ capability, clause: match.clause, spread, match });
    }
  }
  const allCapabilities = [...detectedCapabilities, ...phraseCapabilities];

  // In scope needs something in the contract to point at, not just the
  // absence of a red flag.
  const linkedDeliverable = issue.deliverableId
    ? baseline.deliverables.find((d) => d.id === issue.deliverableId)
    : undefined;
  const hasPositiveEvidence =
    clearlyInScopeCapabilities.length > 0 || inclusionMatches.length > 0 || Boolean(linkedDeliverable);

  // ------------------------------------------------------------------
  // Commercial Decision Reasoning (Conservative 6-State Taxonomy)
  // ------------------------------------------------------------------
  let state: CommercialState = "IN_SCOPE";
  let taxonomy: ScopeTaxonomy = "CLEARLY_IN_SCOPE";
  let reviewReasonCode: ReviewReasonCode | undefined = undefined;
  let recommendedAction: CommercialEvaluation["recommendedAction"] = "PROCEED";
  let primaryReason = "";

  if (explicitlyExcludedCapabilities.length > 0) {
    // Explicit Exclusion: Hardest contractual boundary (Hard Requirement 2)
    state = "CHANGE_REQUIRED";
    taxonomy = "EXPLICITLY_EXCLUDED";
    recommendedAction = "REQUEST_CHANGE_APPROVAL";

    for (const { capability, clause } of explicitlyExcludedCapabilities) {
      const where = capability.extractionMethod === "CONTRACT_PHRASE_MATCH" ? ` (${capability.evidenceText})` : "";
      const deltaMsg = `Explicitly excluded by contract ${clause.clauseRef}: ${capability.name}${where}`;
      detectedDelta.push(deltaMsg);
      scopeDeltaStatements.push({
        statement: deltaMsg,
        evidenceIdRefs: [capability.id, clause.id],
        nature: "EXCLUSION",
      });
    }

    primaryReason = `Contract ${explicitlyExcludedCapabilities[0].clause.clauseRef} explicitly excludes ${explicitlyExcludedCapabilities.map((e) => e.capability.name).join(", ")}. It needs an approved change order.`;
  } else if (
    weaklyExcludedCapabilities.length > 0 ||
    uncontractedCapabilities.length > 0 ||
    ambiguousCapabilities.length > 0
  ) {
    // Something the SOW doesn't settle. A person decides (Hard Requirement 2 & 21):
    // not being mentioned is never the same as being out of scope.
    state = "REVIEW_REQUIRED";
    taxonomy = "AMBIGUOUS";
    reviewReasonCode =
      ambiguousCapabilities.length > 0 || weaklyExcludedCapabilities.length > 0
        ? "AMBIGUOUS_SCOPE"
        : "MISSING_CONTRACT_EVIDENCE";
    recommendedAction = "MANUAL_PM_REVIEW";

    const reasons: string[] = [];
    for (const { capability, clause, spread, match } of weaklyExcludedCapabilities) {
      const where =
        capability.extractionMethod === "CONTRACT_PHRASE_MATCH" ? capability.evidenceText : capability.evidenceLocation;
      let deltaMsg: string;
      let reason: string;
      if (match?.vocabulary) {
        // "Add PayPal to checkout" against excluded "payment providers other than Stripe".
        const { named, reason: why, qualifier, exception } = match.vocabulary;
        const built = match.vocabulary.members.join(", ");
        if (why === "described") {
          deltaMsg = `Only mentioned in ${where}: ${built}, one of the ${named} that contract ${clause.clauseRef} excludes; no new code shows it`;
          reason = `${built} is one of the ${named} excluded by ${clause.clauseRef}, but no new code shows it`;
        } else if (why === "qualifier") {
          deltaMsg = `Builds ${built} (${where}); contract ${clause.clauseRef} excludes ${named}, and nothing says whether this is the "${qualifier}" kind`;
          reason = `${named} is excluded by ${clause.clauseRef}, and this builds ${built} without saying "${qualifier}"`;
        } else if (why === "additive") {
          deltaMsg = `Builds ${built} (${where}); contract ${clause.clauseRef} excludes ${qualifier} ${named}, and nothing says whether ${built} is one of those or the one the contract means`;
          reason = `${qualifier} ${named} are excluded by ${clause.clauseRef}, and nothing says whether ${built} is one of them`;
        } else if (why === "exception") {
          deltaMsg = `Builds ${built} (${where}), one of the ${named} that contract ${clause.clauseRef} excludes apart from ${exception}; the pull request also works on ${exception}, and nothing says whether this is that allowed work`;
          reason = `${built} is one of the ${named} excluded by ${clause.clauseRef} apart from ${exception}, and this also works on ${exception}`;
        } else if (why === "listedAfter") {
          deltaMsg = `Builds ${built} (${where}), one of the ${named} that contract ${clause.clauseRef} lists after its exception for ${exception ?? "other work"}; nothing says whether it is excluded or part of that exception`;
          reason = `${named} is listed after the exception for ${exception ?? "other work"} in ${clause.clauseRef}, so ${built} may be excluded or allowed`;
        } else if (why === "unnamed") {
          deltaMsg = `Builds ${built} (${where}), which falls under "${named}" that contract ${clause.clauseRef} excludes; the contract doesn't name ${built} itself, so a person confirms before a change order goes out`;
          reason = `${built} falls under "${named}", excluded by ${clause.clauseRef}, but the contract doesn't name ${built}`;
        } else {
          deltaMsg = `Builds ${built} (${where}), one of the ${named} that contract ${clause.clauseRef} excludes, but nothing next to it names ${named}`;
          reason = `${built} is one of the ${named} excluded by ${clause.clauseRef}, but nothing next to it names ${named}`;
        }
      } else if (match?.missingQualifier) {
        // "Currency switcher" against excluded "multi-currency pricing".
        const { qualifier, plain } = match.missingQualifier;
        deltaMsg = `Builds ${plain} (${where}); contract ${clause.clauseRef} excludes ${capability.name}, and nothing says whether this is the "${qualifier}" kind`;
        reason = `${capability.name} is excluded by ${clause.clauseRef}, and this builds ${plain} without saying "${qualifier}"`;
      } else if (match?.exceptionQuestion?.listedAfter) {
        // "Payment providers other than Stripe, gift cards": gift cards may be excluded or excepted.
        const { exception } = match.exceptionQuestion;
        deltaMsg = `Names ${capability.name} (${where}), which contract ${clause.clauseRef} lists after its exception for ${exception}; nothing says whether it is excluded or part of that exception`;
        reason = `${capability.name} is listed after the exception for ${exception} in ${clause.clauseRef}, so it may be excluded or allowed`;
      } else if (match?.exceptionQuestion) {
        // "Payment providers other than Stripe" with stripe.ts and providers/index.ts.
        const { exception } = match.exceptionQuestion;
        deltaMsg = `Builds ${capability.name} (${where}); contract ${clause.clauseRef} excludes it apart from ${exception}, and nothing says whether this is the ${exception} work it allows`;
        reason = `${capability.name} is excluded by ${clause.clauseRef} apart from ${exception}, and nothing says whether this is that exception`;
      } else if (match?.missingHead) {
        // "Add PayPal" against excluded "additional payment providers (PayPal, Klarna)".
        const head = match.missingHead;
        deltaMsg = `Names ${capability.name} (${where}), which contract ${clause.clauseRef} excludes as an example of ${head}; nothing names ${head} itself`;
        reason = `${capability.name} is excluded by ${clause.clauseRef} as an example of ${head}, but nothing names ${head}`;
      } else if (spread) {
        deltaMsg = `The words of ${capability.name}, which contract ${clause.clauseRef} excludes, appear only in separate places (${where}); no single changed file or title names it`;
        reason = `${capability.name} is excluded by ${clause.clauseRef} but no single changed file or title names it`;
      } else {
        deltaMsg = `Only mentioned in ${where}: ${capability.name}, which contract ${clause.clauseRef} excludes; no new code shows it`;
        reason = `${capability.name} is excluded by ${clause.clauseRef} but no new code shows it`;
      }
      detectedDelta.push(deltaMsg);
      scopeDeltaStatements.push({ statement: deltaMsg, evidenceIdRefs: [capability.id, clause.id], nature: "AMBIGUITY" });
      reasons.push(reason);
    }
    for (const cap of uncontractedCapabilities) {
      const deltaMsg = `Not mentioned in the SOW: ${cap.name}`;
      detectedDelta.push(deltaMsg);
      scopeDeltaStatements.push({ statement: deltaMsg, evidenceIdRefs: [cap.id], nature: "AMBIGUITY" });
    }
    if (uncontractedCapabilities.length > 0) {
      uncertainties.push(
        "The SOW neither includes nor excludes this capability, so a person has to decide whether it is contracted work."
      );
      reasons.push(`${uncontractedCapabilities.map((c) => c.name).join(", ")} ${uncontractedCapabilities.length === 1 ? "is" : "are"} not mentioned in the SOW`);
    }
    for (const cap of ambiguousCapabilities) {
      const deltaMsg = `Ambiguous scope requirement: ${cap.name} (utility/helper not explicitly defined in baseline)`;
      detectedDelta.push(deltaMsg);
      scopeDeltaStatements.push({ statement: deltaMsg, evidenceIdRefs: [cap.id], nature: "AMBIGUITY" });
    }
    if (ambiguousCapabilities.length > 0) {
      uncertainties.push(
        "Uncontracted utility / helper function may be an implicit engineering dependency or out-of-scope addition."
      );
      reasons.push(`${ambiguousCapabilities.map((c) => c.name).join(", ")} may be an implementation detail`);
    }

    primaryReason = `Needs a decision: ${reasons.join("; ")}.`;
  } else if (changeOrderCoveredCapabilities.length > 0) {
    // Authorized Change (Hard Requirement 9)
    state = "APPROVED_CHANGE";
    taxonomy = "AUTHORIZED_CHANGE";
    recommendedAction = "PROCEED";

    const activeCO = approvedCOs[0];
    for (const cap of changeOrderCoveredCapabilities) {
      const deltaMsg = `Covered by approved Change Order ${activeCO?.title || "CO"}: ${cap.name}`;
      detectedDelta.push(deltaMsg);
      scopeDeltaStatements.push({
        statement: deltaMsg,
        evidenceIdRefs: [cap.id],
        nature: "AUTHORIZED",
      });
    }

    primaryReason = `Work item authorized under approved Change Order: ${activeCO?.title || "Authorized Change Order"}`;
  } else if (hasPositiveEvidence || maintenanceOnly) {
    // Clearly In Scope
    state = "IN_SCOPE";
    taxonomy = "CLEARLY_IN_SCOPE";
    recommendedAction = "PROCEED";

    const inScopeStatement = describeInScope({
      inclusionMatches,
      inScopeCapabilities: clearlyInScopeCapabilities,
      deliverableTitle: (linkedDeliverable ?? primaryDeliverable)?.title,
      issueId: linkedDeliverable ? issue.id : undefined,
    });
    detectedDelta.push(inScopeStatement);
    scopeDeltaStatements.push({
      statement: inScopeStatement,
      evidenceIdRefs: [
        ...clearlyInScopeCapabilities.map((c) => c.id),
        ...new Set(inclusionMatches.map((m) => m.clause.id)),
      ],
      nature: "COMPLIANT",
    });

    primaryReason = inScopeStatement;
  } else {
    // Nothing excluded, but nothing in the contract covers it either.
    state = "REVIEW_REQUIRED";
    taxonomy = "INSUFFICIENT_EVIDENCE";
    reviewReasonCode = "MISSING_CONTRACT_EVIDENCE";
    recommendedAction = "MANUAL_PM_REVIEW";

    const statement =
      "No clause or deliverable in the SOW matches the changed files, the pull request title or the linked issue.";
    detectedDelta.push(statement);
    scopeDeltaStatements.push({ statement, evidenceIdRefs: [], nature: "AMBIGUITY" });
    missingEvidence.push("A contract clause or deliverable that covers this work");
    primaryReason = statement;
  }

  // ------------------------------------------------------------------
  // Hard Requirement 1: Commercial Confidence (Non-LLM). A fixed value per scope category, not a measured probability.
  // ------------------------------------------------------------------
  let commercialConfidence: number;
  if (taxonomy === "EXPLICITLY_EXCLUDED") {
    commercialConfidence = 0.96; // Explicit legal clause exclusion is highest certainty
  } else if (taxonomy === "AUTHORIZED_CHANGE") {
    commercialConfidence = 0.98; // Verified approved change order
  } else if (taxonomy === "CLEARLY_IN_SCOPE") {
    commercialConfidence = candidateDeliverables.length > 0 ? 0.95 : 0.88;
  } else if (taxonomy === "AMBIGUOUS") {
    commercialConfidence = 0.75; // Explicitly lower confidence for ambiguous utility
  } else {
    commercialConfidence = 0.60;
  }

  // ------------------------------------------------------------------
  // Hard Requirement 7: Effort. The linked issue's own estimate is the only
  // figure grounded in the team's data; without one the work is reported as
  // not estimated rather than given a number.
  // ------------------------------------------------------------------
  const needsDecision = state === "CHANGE_REQUIRED" || state === "REVIEW_REQUIRED";
  const issueEstimate = issue.estimateHours && issue.estimateHours > 0 ? issue.estimateHours : 0;
  const estimateSource: EstimateSource = needsDecision && issueEstimate > 0 ? "LINEAR_ISSUE_ESTIMATE" : "NOT_ESTIMATED";
  const estimatedHours =
    estimateSource === "LINEAR_ISSUE_ESTIMATE" ? { min: issueEstimate, max: issueEstimate } : { min: 0, max: 0 };

  // ------------------------------------------------------------------
  // Hard Requirement 6: Commercial Value Grounding (No Invented Rates)
  // ------------------------------------------------------------------
  let commercialValue: {
    currency: string;
    min: number;
    max: number;
    status: "available" | "unavailable";
  };

  if (config.hourlyRate && config.hourlyRate > 0 && estimatedHours.max > 0) {
    commercialValue = {
      currency: "USD",
      min: estimatedHours.min * config.hourlyRate,
      max: estimatedHours.max * config.hourlyRate,
      status: "available",
    };
  } else if (!needsDecision) {
    // In scope or already authorised: there is no unapproved work to value.
    commercialValue = {
      currency: "USD",
      min: 0,
      max: 0,
      status: "available",
    };
  } else {
    // No estimate or no configured hourly rate -> value is unavailable, never invented
    commercialValue = {
      currency: "USD",
      min: 0,
      max: 0,
      status: "unavailable",
    };
  }

  // Build legacy evidence array for backward compatibility. A pull request
  // standing in as its own work item has no issue to show.
  if (!isPullRequestWorkItem(issue.id)) {
    evidence.push({
      source: "LINEAR",
      mark: "linear",
      label: "Work Item",
      value: `${issue.id} · ${issue.title}`,
      result: "linked",
      tone: "ok",
    });
  }

  evidence.push({
    source: "GITHUB",
    mark: "github",
    label: "Pull Request",
    value: `PR #${pullRequest.number} (${pullRequest.filesChanged} files, +${pullRequest.additions}/-${pullRequest.deletions})`,
    result: "read",
    tone: "ok",
  });

  const matchedClause =
    state === "CHANGE_REQUIRED" ? explicitlyExcludedCapabilities[0].clause : relevantClauses[0];
  if (state === "CHANGE_REQUIRED") {
    evidence.push({
      source: "SOW",
      mark: "sow",
      label: "Contract Baseline",
      value: matchedClause ? `${matchedClause.clauseRef} ${matchedClause.title}` : "Baseline Scope",
      result: "no match",
      tone: "bad",
    });
  } else if (state === "APPROVED_CHANGE") {
    evidence.push({
      source: "CHANGE_ORDER",
      mark: "approval",
      label: "Approved Change Order",
      value: approvedCOs[0]?.title || "Change Order Authorized",
      result: "authorized",
      tone: "ok",
    });
  } else if (state === "REVIEW_REQUIRED") {
    evidence.push({
      source: "SOW",
      mark: "sow",
      label: "Contract Baseline",
      value: matchedClause ? `${matchedClause.clauseRef} ${matchedClause.title}` : "Baseline Scope",
      result: "no match",
      tone: "warn",
    });
  } else {
    evidence.push({
      source: "SOW",
      mark: "sow",
      label: "Contract Baseline",
      value: matchedClause ? `${matchedClause.clauseRef} ${matchedClause.title}` : "Baseline Scope",
      result: "matched",
      tone: "ok",
    });
  }

  // ------------------------------------------------------------------
  // Hard Requirement 10: 12-Component Evaluation Identity Hash
  // ------------------------------------------------------------------
  const identityHash = computeEvaluationIdentityHash({
    baselineVersion: baseline.version,
    documentVersion,
    issueSnapshotHash: computeIssueSnapshotHash(issue),
    headSha: pullRequest.headSha || "sha_unknown",
    diffAnalysisVersion,
    evaluatorVersion: EVALUATOR_VERSION,
    modelVersion,
    promptVersion,
    capabilityTaxonomyVersion: CapabilityExtractor.TAXONOMY_VERSION,
    scopeTaxonomyVersion: SCOPE_TAXONOMY_VERSION,
    estimationRulesVersion: ESTIMATION_RULES_VERSION,
    policyConfigVersion: config.version,
  });

  // ------------------------------------------------------------------
  // Hard Requirement 14: Machine-Readable Decision Explanation
  // ------------------------------------------------------------------
  const explanation: DecisionExplanation = {
    decision: state,
    reason: primaryReason,
    reviewReasonCode,
    evidenceIds,
    uncertainties,
    missingEvidence,
    recommendedAction,
  };

  // ------------------------------------------------------------------
  // Hard Requirement 11: Immutable Evidence Bundle
  // ------------------------------------------------------------------
  const bundle: EvidenceBundle = {
    evaluationId,
    identityHash,
    state,
    taxonomy,
    commercialConfidence,
    contractEvidence: contractEvidenceList,
    candidateDeliverables,
    issueEvidence: {
      identifier: issue.id,
      title: issue.title,
      status: issue.status,
      estimateHours: issue.estimateHours,
    },
    engineeringEvidence: {
      prNumber: pullRequest.number,
      headSha: pullRequest.headSha || "sha_unknown",
      filesChanged: pullRequest.filesChanged,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      primaryModules: Array.from(new Set(pullRequest.changedFiles.map((f) => f.module))),
      changedFiles: pullRequest.changedFiles.map((f) => f.path),
    },
    detectedCapabilities: allCapabilities,
    scopeDelta: scopeDeltaStatements,
    impact: {
      estimatedHours,
      estimateSource,
      commercialValue,
    },
    decisionExplanation: explanation,
    evaluatedAt,
  };

  return {
    evaluationId,
    pullRequestId: pullRequest.id,
    status: "COMPLETED",
    issueId: issue.id,
    deliverableId: primaryDeliverable?.id,
    contractClauseId: matchedClause?.id,
    state,
    taxonomy,
    confidence: commercialConfidence,
    commercialConfidence,
    evidence,
    evidenceBundle: bundle,
    identityHash,
    detectedDelta,
    estimatedHours,
    estimateSource,
    commercialValue,
    recommendedAction,
    checkConclusion: resolveCheckConclusion(state, policyMode),
    policyMode,
    reviewReasonCode,
    evaluatorVersion: EVALUATOR_VERSION,
    evaluatedAt,
  };
}

/** Turns an exclusion matched through SOW wording into grounded capability evidence. */
function capabilityFromMatch(match: ContractPhraseMatch, index: number): DetectedCapability {
  const [strongest] = match.evidence;
  const locations = match.evidence.slice(0, 4).map((e) => e.location);
  const more = match.evidence.length - locations.length;
  return {
    id: `cap_sow_${index}`,
    name: match.matchedPart,
    description: `Matches "${match.phrase}", excluded by ${match.clause.clauseRef} ${match.clause.title}`,
    sourceQuality: strongest?.sourceQuality ?? "INFERRED",
    evidenceLocation: strongest?.location ?? `PR evidence`,
    evidenceText: more > 0 ? `${locations.join(", ")} and ${more} more` : locations.join(", "),
    confidence: Number(match.coverage.toFixed(2)),
    extractionMethod: "CONTRACT_PHRASE_MATCH",
  };
}

/** One sentence naming what in the contract the work was matched to. */
function describeInScope(input: {
  inclusionMatches: ContractPhraseMatch[];
  inScopeCapabilities: DetectedCapability[];
  deliverableTitle?: string;
  issueId?: string;
}): string {
  const [first, ...rest] = input.inclusionMatches;
  if (first) {
    const more = rest.length > 0 ? `, and ${rest.length} more included item${rest.length === 1 ? "" : "s"}` : "";
    return `Matches "${first.matchedPart}", included in ${first.clause.clauseRef} ${first.clause.title}${more}.`;
  }
  if (input.inScopeCapabilities.length > 0) {
    const names = input.inScopeCapabilities.map((c) => c.name).join(", ");
    return `${names} ${input.inScopeCapabilities.length === 1 ? "falls" : "fall"} within ${input.deliverableTitle || "the contracted deliverables"}.`;
  }
  if (input.issueId && input.deliverableTitle) {
    return `${input.issueId} is linked to the contracted deliverable ${input.deliverableTitle}.`;
  }
  return "Only removes code or changes tests, documentation, dependencies or build files; no new scope.";
}

/**
 * Computes 12-component semantic identity hash (Hard Requirement 10).
 */
export function computeEvaluationIdentityHash(params: EvaluationIdentity): string {
  const parts = [
    params.baselineVersion,
    params.documentVersion,
    params.issueSnapshotHash,
    params.headSha,
    String(params.diffAnalysisVersion),
    params.evaluatorVersion,
    params.modelVersion,
    params.promptVersion,
    params.capabilityTaxonomyVersion,
    params.scopeTaxonomyVersion,
    params.estimationRulesVersion,
    params.policyConfigVersion,
  ];

  return crypto
    .createHash("sha256")
    .update(parts.join(":"))
    .digest("hex");
}

function computeIssueSnapshotHash(issue?: LinearIssue): string {
  if (!issue) return "no_issue";
  const str = `${issue.id}:${issue.title}:${issue.status}:${issue.estimateHours || 0}:${issue.updatedAt || ""}`;
  return crypto.createHash("sha256").update(str).digest("hex").substring(0, 16);
}

export function resolveCheckConclusion(state: CommercialState, policyMode: PolicyMode): CheckRunConclusion {
  if (policyMode === "OBSERVE") {
    return "neutral";
  }

  if (policyMode === "REVIEW") {
    switch (state) {
      case "IN_SCOPE":
      case "APPROVED_CHANGE":
      case "OVERRIDDEN":
        return "success";
      case "CHANGE_REQUIRED":
      case "REVIEW_REQUIRED":
      case "BLOCKED":
        return "action_required";
    }
  }

  // ENFORCE mode
  switch (state) {
    case "IN_SCOPE":
    case "APPROVED_CHANGE":
    case "OVERRIDDEN":
      return "success";
    case "CHANGE_REQUIRED":
    case "BLOCKED":
      return "failure";
    case "REVIEW_REQUIRED":
      return "action_required";
  }
}
