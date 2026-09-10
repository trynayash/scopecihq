import type {
  ChangeOrder,
  CommercialEvaluation,
  CommercialEvent,
  CommercialState,
} from './types.js';
import { resolveCheckConclusion } from './evaluator.js';

export interface TransitionContext {
  evaluation: CommercialEvaluation;
  events: CommercialEvent[];
}

export interface OverrideParams {
  actor: string; // e.g. "sarah@agency.com (PM)"
  reason: string;
}

export interface ChangeOrderApprovalParams {
  actor: string;
  changeOrder: ChangeOrder;
}

/**
 * Applies a PM Human Override to bypass a CHANGE_REQUIRED or REVIEW_REQUIRED state.
 */
export function applyHumanOverride(
  context: TransitionContext,
  params: OverrideParams,
): { updatedEvaluation: CommercialEvaluation; newEvents: CommercialEvent[] } {
  const { evaluation } = context;
  const previousState = evaluation.state;
  const newState: CommercialState = 'OVERRIDDEN';

  const updatedEvaluation: CommercialEvaluation = {
    ...evaluation,
    state: newState,
    checkConclusion: resolveCheckConclusion(newState, evaluation.policyMode),
    recommendedAction: 'PROCEED',
    evidence: [
      ...evaluation.evidence,
      {
        source: 'SYSTEM',
        mark: 'system',
        label: 'Human Override',
        value: `${params.actor}: "${params.reason}"`,
        result: 'override',
        tone: 'ok',
      },
    ],
  };

  const overrideEvent: CommercialEvent = {
    id: `evt_override_${Date.now()}`,
    timestamp: new Date().toISOString(),
    eventType: 'human_override',
    actor: params.actor,
    pullRequestId: evaluation.pullRequestId,
    previousState,
    newState,
    metadata: { reason: params.reason },
  };

  const stateChangedEvent: CommercialEvent = {
    id: `evt_state_${Date.now()}`,
    timestamp: new Date().toISOString(),
    eventType: 'state_changed',
    actor: params.actor,
    pullRequestId: evaluation.pullRequestId,
    previousState,
    newState,
    metadata: { newCheckConclusion: updatedEvaluation.checkConclusion },
  };

  return {
    updatedEvaluation,
    newEvents: [overrideEvent, stateChangedEvent],
  };
}

/**
 * Authorizes work through an approved Change Order.
 */
export function applyChangeOrderApproval(
  context: TransitionContext,
  params: ChangeOrderApprovalParams,
): { updatedEvaluation: CommercialEvaluation; newEvents: CommercialEvent[] } {
  const { evaluation } = context;
  const previousState = evaluation.state;
  const newState: CommercialState = 'APPROVED_CHANGE';

  const updatedEvaluation: CommercialEvaluation = {
    ...evaluation,
    state: newState,
    checkConclusion: resolveCheckConclusion(newState, evaluation.policyMode),
    recommendedAction: 'PROCEED',
    evidence: [
      ...evaluation.evidence.filter((e) => e.source !== 'SOW' || e.result !== 'no match'),
      {
        source: 'CHANGE_ORDER',
        mark: 'approval',
        label: 'Approved Change Order',
        value: `${params.changeOrder.id} · ${params.changeOrder.title}`,
        result: 'authorized',
        tone: 'ok',
      },
    ],
  };

  const approvalEvent: CommercialEvent = {
    id: `evt_co_${Date.now()}`,
    timestamp: new Date().toISOString(),
    eventType: 'change_approved',
    actor: params.actor,
    pullRequestId: evaluation.pullRequestId,
    previousState,
    newState,
    metadata: { changeOrderId: params.changeOrder.id, amount: params.changeOrder.amount },
  };

  const stateChangedEvent: CommercialEvent = {
    id: `evt_state_co_${Date.now()}`,
    timestamp: new Date().toISOString(),
    eventType: 'state_changed',
    actor: params.actor,
    pullRequestId: evaluation.pullRequestId,
    previousState,
    newState,
    metadata: { newCheckConclusion: updatedEvaluation.checkConclusion },
  };

  return {
    updatedEvaluation,
    newEvents: [approvalEvent, stateChangedEvent],
  };
}
