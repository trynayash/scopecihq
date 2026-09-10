import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* 1. Core Enums & States                                             */
/* ------------------------------------------------------------------ */

export const CommercialStateEnum = z.enum([
  'IN_SCOPE',
  'REVIEW_REQUIRED',
  'CHANGE_REQUIRED',
  'APPROVED_CHANGE',
  'BLOCKED',
  'OVERRIDDEN',
]);
export type CommercialState = z.infer<typeof CommercialStateEnum>;

export const EvaluationStatusEnum = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'STALE',
]);
export type EvaluationStatus = z.infer<typeof EvaluationStatusEnum>;

export const PolicyModeEnum = z.enum(['OBSERVE', 'REVIEW', 'ENFORCE']);
export type PolicyMode = z.infer<typeof PolicyModeEnum>;

export const CheckRunConclusionEnum = z.enum([
  'success',
  'neutral',
  'action_required',
  'failure',
]);
export type CheckRunConclusion = z.infer<typeof CheckRunConclusionEnum>;

/**
 * Conservative Scope Taxonomy (Phase 4 Hard Requirement 2 & 23)
 * Never equate "not mentioned in SOW" with "out of scope".
 */
export const ScopeTaxonomyEnum = z.enum([
  'CLEARLY_IN_SCOPE',
  'CLEARLY_OUT_OF_SCOPE',
  'EXPLICITLY_EXCLUDED',
  'AMBIGUOUS',
  'AUTHORIZED_CHANGE',
  'INSUFFICIENT_EVIDENCE',
]);
export type ScopeTaxonomy = z.infer<typeof ScopeTaxonomyEnum>;

/**
 * Standardized Human Review Reason Codes (Phase 4 Hard Requirement 17)
 */
export const ReviewReasonCodeEnum = z.enum([
  'MISSING_CONTRACT_EVIDENCE',
  'AMBIGUOUS_SCOPE',
  'MULTIPLE_DELIVERABLES',
  'LOW_CONFIDENCE',
  'UNLINKED_ISSUE',
  'UNPARSEABLE_DIFF',
  'CONFLICTING_CLAUSES',
  'EXPIRED_BASELINE',
  'MODEL_FAILURE',
]);
export type ReviewReasonCode = z.infer<typeof ReviewReasonCodeEnum>;

/**
 * Source Quality Hierarchy (Phase 4 Hard Requirement 18)
 * PRIMARY_CONTRACT > CHANGE_ORDER > LINEAR_ISSUE > GITHUB_DIFF > GITHUB_PR > INFERRED > MODEL_SUMMARY
 */
export const EvidenceSourceQualityEnum = z.enum([
  'PRIMARY_CONTRACT',
  'CHANGE_ORDER',
  'LINEAR_ISSUE',
  'GITHUB_DIFF',
  'GITHUB_PR',
  'INFERRED',
  'MODEL_SUMMARY',
]);
export type EvidenceSourceQuality = z.infer<typeof EvidenceSourceQualityEnum>;

/* ------------------------------------------------------------------ */
/* 2. Scope Baseline & Provenance Entities                            */
/* ------------------------------------------------------------------ */

export interface ContractClause {
  id: string;
  clauseRef: string; // e.g. "§4.2"
  title: string;
  legalText: string;
  inclusions: string[];
  exclusions: string[];
  sourcePage?: number | string;
  sourceLocation?: string;
}

export interface Deliverable {
  id: string;
  clauseId: string;
  title: string;
  scopeBoundary: string;
  keywords: string[];
  estimatedHours: { min: number; max: number };
  budgetAllocated: number;
}

export interface ScopeBaseline {
  id: string;
  version: string; // e.g. "v1", "v2"
  contractId: string;
  title: string;
  description: string;
  status: 'active' | 'superseded';
  documentVersion?: string;
  clauses: ContractClause[];
  deliverables: Deliverable[];
  createdAt: string;
}

export interface LinearIssue {
  id: string; // e.g. "ENG-184"
  identifier?: string;
  title: string;
  description?: string;
  status: string;
  estimateHours?: number;
  deliverableId?: string;
  labels?: string[];
  updatedAt?: string;
}

export interface ChangedFile {
  path: string;
  status?: 'added' | 'modified' | 'deleted' | 'renamed';
  module: string;
  linesAdded?: number;
  linesDeleted?: number;
  additions?: number;
  deletions?: number;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  body?: string;
  branch?: string;
  base?: string;
  baseBranch?: string;
  headBranch?: string;
  author?: string;
  headSha?: string;
  issueId?: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  changedFiles: ChangedFile[];
  detectedSubsystems?: string[];
}

export interface ChangeOrder {
  id: string; // e.g. "CO-12"
  contractId: string;
  baselineVersion: string;
  title: string;
  reason: string;
  authorizedSubsystems: string[];
  hours: { min: number; max: number };
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: string;
  approvedAt?: string;
}

/* ------------------------------------------------------------------ */
/* 3. Capability Extraction & Grounded Evidence                        */
/* ------------------------------------------------------------------ */

export interface DetectedCapability {
  id: string; // e.g. "cap_org_rbac_1"
  name: string; // e.g. "organization_rbac"
  description?: string;
  sourceQuality: EvidenceSourceQuality;
  evidenceLocation: string; // file path or identifier
  evidenceText: string;
  confidence: number;
  extractionMethod: 'STATIC_AST' | 'DIFF_PATH' | 'SYMBOL_DETECTION' | 'SEMANTIC_INTERPRETATION';
}

export interface ContractEvidence {
  clauseId: string;
  clauseRef: string; // e.g. "§4.2"
  title: string;
  page?: number | string;
  location?: string;
  legalTextExcerpt: string;
  boundarySummary: string;
  isExplicitlyExcluded?: boolean;
  isExplicitlyIncluded?: boolean;
}

export interface CandidateDeliverableMatch {
  deliverableId: string;
  clauseId: string;
  title: string;
  confidence: number;
  matchedKeywords: string[];
  sourceQuality: EvidenceSourceQuality;
}

export interface ScopeDeltaStatement {
  statement: string;
  evidenceIdRefs: string[];
  nature: 'EXPANSION' | 'EXCLUSION' | 'AMBIGUITY' | 'COMPLIANT' | 'AUTHORIZED';
}

export type RecommendedAction =
  | 'PROCEED'
  | 'REQUEST_CHANGE_ORDER'
  | 'REQUEST_CHANGE_APPROVAL'
  | 'MANUAL_PM_REVIEW'
  | 'REQUEST_PM_REVIEW'
  | 'AWAIT_APPROVAL'
  | 'RESOLVE_CHANGE_ORDER';

export interface DecisionExplanation {
  decision: CommercialState;
  reason: string;
  reviewReasonCode?: ReviewReasonCode;
  evidenceIds: string[];
  uncertainties: string[];
  missingEvidence: string[];
  recommendedAction: RecommendedAction;
}

/* ------------------------------------------------------------------ */
/* 4. Immutable Evaluation Identity & Evidence Bundle                 */
/* ------------------------------------------------------------------ */

export interface EvaluationIdentity {
  baselineVersion: string;
  documentVersion: string;
  issueSnapshotHash: string;
  headSha: string;
  diffAnalysisVersion: number;
  evaluatorVersion: string;
  modelVersion: string;
  promptVersion: string;
  capabilityTaxonomyVersion: string;
  scopeTaxonomyVersion: string;
  estimationRulesVersion: string;
  policyConfigVersion: string;
}

export interface EvidenceBundle {
  evaluationId: string;
  identityHash: string;
  state: CommercialState;
  taxonomy: ScopeTaxonomy;
  commercialConfidence: number;
  modelConfidence?: number;
  contractEvidence: ContractEvidence[];
  candidateDeliverables: CandidateDeliverableMatch[];
  issueEvidence: {
    identifier: string;
    title: string;
    status: string;
    estimateHours?: number;
  } | null;
  engineeringEvidence: {
    prNumber: number;
    headSha: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    primaryModules: string[];
    changedFiles: string[];
  };
  detectedCapabilities: DetectedCapability[];
  scopeDelta: ScopeDeltaStatement[];
  impact: {
    estimatedHours: { min: number; max: number };
    commercialValue: {
      currency: string;
      min: number;
      max: number;
      status: 'available' | 'unavailable';
    };
  };
  decisionExplanation: DecisionExplanation;
  evaluatedAt: string;
}

/* ------------------------------------------------------------------ */
/* 5. Policy Configuration                                             */
/* ------------------------------------------------------------------ */

export interface PolicyConfig {
  version: string;
  reviewThreshold: number; // default 0.85
  highConfidenceThreshold: number; // default 0.90
  hourlyRate?: number;
  defaultPolicyMode: PolicyMode;
  allowInferenceWithoutClause: boolean;
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  version: 'policy_cfg_2026_09_v1',
  reviewThreshold: 0.85,
  highConfidenceThreshold: 0.90,
  hourlyRate: 150,
  defaultPolicyMode: 'OBSERVE',
  allowInferenceWithoutClause: false,
};

/* ------------------------------------------------------------------ */
/* 6. Commercial Evaluation Full Output                               */
/* ------------------------------------------------------------------ */

export interface EvaluationEvidence {
  source: 'SOW' | 'LINEAR' | 'GITHUB' | 'CHANGE_ORDER' | 'SYSTEM';
  mark: 'sow' | 'linear' | 'github' | 'approval' | 'system';
  label: string;
  value: string;
  result: 'matched' | 'linked' | 'read' | 'no match' | 'unlinked' | 'authorized' | 'override';
  tone: 'ok' | 'bad' | 'warn';
}

export interface CommercialEvaluation {
  evaluationId: string;
  pullRequestId: string;
  status: EvaluationStatus;
  issueId?: string;
  deliverableId?: string;
  contractClauseId?: string;
  state: CommercialState;
  taxonomy: ScopeTaxonomy;
  confidence: number; // Maintained for backward compatibility (= commercialConfidence)
  commercialConfidence: number;
  modelConfidence?: number;
  evidence: EvaluationEvidence[];
  evidenceBundle: EvidenceBundle;
  identityHash: string;
  detectedDelta: string[];
  estimatedHours: { min: number; max: number };
  commercialValue: { currency: string; min: number; max: number; status?: 'available' | 'unavailable' };
  recommendedAction: RecommendedAction;
  checkConclusion: CheckRunConclusion;
  policyMode: PolicyMode;
  reviewReasonCode?: ReviewReasonCode;
  evaluatorVersion: string;
  evaluatedAt: string;
}

/* ------------------------------------------------------------------ */
/* 7. Immutable Event Log                                              */
/* ------------------------------------------------------------------ */

export type CommercialEventType =
  | 'pr_opened'
  | 'evaluation_created'
  | 'evaluation_updated'
  | 'pm_reviewed'
  | 'change_order_created'
  | 'change_approved'
  | 'state_changed'
  | 'github_check_updated'
  | 'pr_merged'
  | 'human_override';

export interface CommercialEvent {
  id: string;
  timestamp: string;
  eventType: CommercialEventType;
  actor: string;
  pullRequestId: string;
  previousState?: CommercialState;
  newState?: CommercialState;
  metadata: Record<string, unknown>;
}
