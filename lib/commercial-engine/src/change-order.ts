import { formatHours, formatMoney } from "./formatter.js";
import type { CommercialEvaluation } from "./types.js";

/**
 * Change Order Draft.
 *
 * Turns a CHANGE_REQUIRED evaluation into the message an agency sends its
 * client: what was found, which clause excludes it, what it costs if that is
 * known, and the two ways forward. It is a draft for a person to edit and
 * send, never sent automatically.
 */

export interface ChangeOrderItem {
  /** What was built, in the contract's words where possible. */
  item: string;
  clauseRef: string;
  clauseTitle: string;
  /** The evaluator's name for it, so an approval can be matched on later pull requests. */
  capability?: string;
}

export interface ChangeOrderDraft {
  subject: string;
  body: string;
  items: ChangeOrderItem[];
}

export interface ChangeOrderDraftInput {
  evaluation: CommercialEvaluation;
  pullRequestTitle: string;
  projectName?: string;
  clientName?: string;
  agencyName?: string;
  hourlyRate?: number;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The excluded items behind an evaluation, read from its evidence rather than its messages. */
export function excludedItems(evaluation: CommercialEvaluation): ChangeOrderItem[] {
  const bundle = evaluation.evidenceBundle;
  const items: ChangeOrderItem[] = [];
  for (const statement of bundle.scopeDelta) {
    if (statement.nature !== "EXCLUSION") continue;
    const [capabilityId, clauseId] = statement.evidenceIdRefs;
    const capability = bundle.detectedCapabilities.find((c) => c.id === capabilityId);
    const clause = bundle.contractEvidence.find((c) => c.clauseId === clauseId);
    if (!capability) continue;
    // Contract wording reads well to a client; the built-in capability names
    // (organization_rbac) don't, so those use their description.
    const item =
      capability.extractionMethod === "CONTRACT_PHRASE_MATCH"
        ? capability.name
        : (capability.description ?? capability.name.replace(/_/g, " "));
    items.push({
      item: capitalise(item),
      clauseRef: clause?.clauseRef ?? "",
      clauseTitle: clause?.title ?? "",
      capability: capability.name,
    });
  }
  return items;
}

export interface ChangeOrderMessageInput {
  items: ChangeOrderItem[];
  pullRequestTitle: string;
  projectName?: string;
  clientName?: string;
  agencyName?: string;
  /** Hours someone stands behind: an issue estimate, or what a person typed in. */
  hours?: number;
  hourlyRate?: number;
}

/** The message itself, from the items and whatever is known about cost. */
export function composeChangeOrder(input: ChangeOrderMessageInput): { subject: string; body: string } {
  const { items } = input;
  const names = items.map((i) => i.item.toLowerCase());
  // "Statement of Work — Harbor & Pine" reads as just "Harbor & Pine" in a subject line.
  const project = input.projectName?.replace(/^\s*(?:statement of work|sow)\s*[:\-–—]\s*/i, "").trim();
  const subject = `Change request: ${names.join(", ")}${project ? ` (${project})` : ""}`;

  const list = items
    .map((i) => `- ${i.item}${i.clauseRef ? ` (excluded in ${i.clauseRef}${i.clauseTitle ? ` ${i.clauseTitle}` : ""})` : ""}`)
    .join("\n");

  const hours = input.hours && input.hours > 0 ? input.hours : undefined;
  const rate = input.hourlyRate && input.hourlyRate > 0 ? input.hourlyRate : undefined;
  let cost: string;
  if (hours) {
    cost = rate
      ? `We estimate ${formatHours(hours)} for this, which is ${formatMoney(hours * rate)} at our rate of ${formatMoney(rate)} an hour.`
      : `We estimate ${formatHours(hours)} for this.`;
  } else {
    cost = "We'll send you an estimate for this before starting it.";
  }

  const body = [
    `Hi ${input.clientName?.trim() || "there"},`,
    "",
    `While working on "${input.pullRequestTitle}", we found work that our statement of work lists as out of scope:`,
    "",
    list,
    "",
    cost,
    "",
    "How would you like to go ahead?",
    "1. Approve it as a change order, and we'll include it in this release.",
    "2. Leave it out for now, and we'll take it out of this change.",
    "",
    "Thanks,",
    input.agencyName?.trim() || "[Your name]",
  ].join("\n");

  return { subject, body };
}

export function draftChangeOrder(input: ChangeOrderDraftInput): ChangeOrderDraft | undefined {
  const { evaluation } = input;
  if (evaluation.state !== "CHANGE_REQUIRED") return undefined;

  const items = excludedItems(evaluation);
  if (items.length === 0) return undefined;

  const estimated =
    evaluation.estimateSource === "LINEAR_ISSUE_ESTIMATE" && evaluation.estimatedHours.max > 0
      ? evaluation.estimatedHours.max
      : undefined;
  return { ...composeChangeOrder({ ...input, items, hours: estimated }), items };
}
