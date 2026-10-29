import type { ContractClause, Deliverable, ScopeBaseline } from "./types.js";
import { plainHyphens } from "./contract-matcher.js";

/**
 * Scope Checklist.
 *
 * The list of what each clause includes and excludes, in the form a project
 * manager reviews and corrects after the SOW is parsed. Parsing is a first
 * draft; the confirmed checklist is what pull requests are checked against.
 */

export interface ScopeChecklistClause {
  clauseRef: string;
  title: string;
  included: string[];
  excluded: string[];
}

export interface ScopeChecklist {
  title: string;
  clauses: ScopeChecklistClause[];
}

/**
 * Trims, lowercases and de-duplicates items, dropping empty ones.
 * "Multi-currency pricing" pasted with a typographic hyphen (U+2010, U+2011)
 * is saved with "-", the way it reads.
 */
function normaliseItems(items: string[]): string[] {
  return Array.from(
    new Set(items.map((item) => plainHyphens(item).trim().replace(/\s+/g, " ").toLowerCase()).filter(Boolean)),
  );
}

export function checklistFromBaseline(baseline: ScopeBaseline): ScopeChecklist {
  return {
    title: baseline.title,
    clauses: baseline.clauses.map((clause) => ({
      clauseRef: clause.clauseRef,
      title: clause.title,
      included: [...clause.inclusions],
      excluded: [...clause.exclusions],
    })),
  };
}

/**
 * Builds the baseline the evaluator checks against. Deliverables follow the
 * SOW parser: one per clause, keyed by its included items and the longer
 * words of its title. An item listed as both included and excluded counts as
 * excluded.
 */
export function baselineFromChecklist(
  checklist: ScopeChecklist,
  options: { id?: string; version?: string; contractId?: string } = {},
): ScopeBaseline {
  const clauses: ContractClause[] = checklist.clauses.map((entry, index) => {
    const exclusions = normaliseItems(entry.excluded);
    const inclusions = normaliseItems(entry.included).filter((item) => !exclusions.includes(item));
    return {
      id: `clause_${index + 1}`,
      clauseRef: entry.clauseRef.trim() || `§${index + 1}`,
      title: entry.title.trim() || `Section ${index + 1}`,
      legalText: [
        ...inclusions.map((item) => `Includes ${item}.`),
        ...exclusions.map((item) => `Excludes ${item}.`),
      ].join(" "),
      inclusions,
      exclusions,
    };
  });

  const deliverables: Deliverable[] = clauses.map((clause, index) => ({
    id: `deliv_${index + 1}`,
    clauseId: clause.id,
    title: `${clause.title} Subsystem`,
    scopeBoundary: clause.title,
    keywords: Array.from(
      new Set([
        ...clause.inclusions,
        ...clause.title
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length > 3),
      ]),
    ),
    estimatedHours: { min: 0, max: 0 },
    budgetAllocated: 0,
  }));

  return {
    id: options.id ?? "baseline_checklist",
    version: options.version ?? "v1",
    contractId: options.contractId ?? "contract_checklist",
    title: checklist.title.trim() || "Statement of Work",
    description: "Scope baseline from a reviewed checklist",
    status: "active",
    clauses,
    deliverables,
    createdAt: new Date().toISOString(),
  };
}
