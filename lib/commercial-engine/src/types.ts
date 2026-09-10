import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Core Enums & States                                                */
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

export const PolicyModeEnum = z.enum(['OBSERVE', 'REVIEW', 'ENFORCE']);
export type PolicyMode = z.infer<typeof PolicyModeEnum>;

export const CheckRunConclusionEnum = z.enum([
  'success',
  'neutral',
  'action_required',
  'failure',
]);
export type CheckRunConclusion = z.infer<typeof CheckRunConclusionEnum>;

/* ------------------------------------------------------------------ */
/* Scope Baseline & Provenance Graph Entities                          */
/* ------------------------------------------------------------------ */

export interface ContractClause {
  id: string;
  clauseRef: string; // e.g. "§4.2"
  title: string;
  legalText: string;
  inclusions: string[];
  exclusions: string[];
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
  clauses: ContractClause[];
  deliverables: Deliverable[];
  createdAt: string;
}

export interface LinearIssue {
  id: string; // e.g. "ENG-184"
  title: string;
  description: string;
  status: string;
  estimateHours?: number;
  deliverableId?: string;
}

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  module: string;
  linesAdded: number;
  linesDeleted: number;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  branch: string;
  base: string;
  author: string;
  issueId?: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  changedFiles: ChangedFile[];
  detectedSubsystems: string[];
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
/* Golden Evaluation Contract                                         */
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
  issueId?: string;
  deliverableId?: string;
  contractClauseId?: string;
  state: CommercialState;
  confidence: number;
  evidence: EvaluationEvidence[];
  detectedDelta: string[];
  estimatedHours: { min: number; max: number };
  commercialValue: { currency: string; min: number; max: number };
  recommendedAction: 'PROCEED' | 'REQUEST_CHANGE_APPROVAL' | 'MANUAL_PM_REVIEW' | 'RESOLVE_CHANGE_ORDER';
  checkConclusion: CheckRunConclusion;
  policyMode: PolicyMode;
  evaluatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Immutable Event Log                                                */
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
