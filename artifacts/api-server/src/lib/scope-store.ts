import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  contractClausesTable,
  contractsTable,
  deliverablesTable,
  projectsTable,
  scopeBaselinesTable,
} from "@workspace/db/schema";
import {
  baselineFromChecklist,
  extractScopeBoundaries,
  type ContractClause,
  type Deliverable,
  type ScopeBaseline,
  type ScopeChecklist,
} from "@workspace/commercial-engine";

/**
 * Reading and writing a project's scope. A confirmed checklist is stored as a
 * new ACTIVE baseline version of the project's contract (older versions are
 * kept as SUPERSEDED), so every evaluation can say which version it used.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ClauseRow = {
  id: string;
  clauseNumber: string;
  title: string;
  legalText: string;
  boundaryType: string;
  inclusionsJson?: unknown;
  exclusionsJson?: unknown;
};

export type DeliverableRow = {
  id: string;
  clauseId: string | null;
  name: string;
  boundarySummary: string;
  allocatedHours: number | null;
  allocatedBudget: number | null;
};

const asList = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;

/**
 * A clause's included and excluded items. Checklists saved in the app store
 * them as lists; older rows hold only wording, so those are read the same way
 * an uploaded SOW is, and a row stored as an EXCLUSION is excluded as a whole
 * even when its wording has no "excludes" phrase to pick up.
 */
export function clauseBoundaries(row: ClauseRow): { inclusions: string[]; exclusions: string[] } {
  const savedIn = asList(row.inclusionsJson);
  const savedOut = asList(row.exclusionsJson);
  if (savedIn || savedOut) return { inclusions: savedIn ?? [], exclusions: savedOut ?? [] };

  const { inclusions, exclusions } = extractScopeBoundaries(row.legalText);
  const isExclusion = row.boundaryType === "EXCLUSION";
  return {
    inclusions: isExclusion ? [] : inclusions,
    exclusions: isExclusion && exclusions.length === 0 ? [row.title.toLowerCase()] : exclusions,
  };
}

export function toDomainClause(row: ClauseRow): ContractClause {
  return { id: row.id, clauseRef: row.clauseNumber, title: row.title, legalText: row.legalText, ...clauseBoundaries(row) };
}

/** Keywords follow the SOW parser: the clause's inclusions plus the longer words of the name. */
export function toDomainDeliverable(row: DeliverableRow, clauses: ContractClause[]): Deliverable {
  const clause = clauses.find((c) => c.id === row.clauseId);
  const nameWords = row.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  return {
    id: row.id,
    clauseId: row.clauseId || "",
    title: row.name,
    scopeBoundary: row.boundarySummary,
    keywords: Array.from(new Set([...(clause?.inclusions ?? []), ...nameWords])),
    estimatedHours: row.allocatedHours ? { min: row.allocatedHours, max: row.allocatedHours } : { min: 0, max: 0 },
    budgetAllocated: row.allocatedBudget ?? 0,
  };
}

export async function loadActiveBaseline(contractId: string) {
  return db.query.scopeBaselinesTable.findFirst({
    where: and(eq(scopeBaselinesTable.contractId, contractId), eq(scopeBaselinesTable.status, "ACTIVE")),
    with: { clauses: true, deliverables: true, contract: true },
  });
}

type BaselineRecord = NonNullable<Awaited<ReturnType<typeof loadActiveBaseline>>>;

export function toDomainBaseline(record: BaselineRecord): ScopeBaseline {
  const clauses = record.clauses.map(toDomainClause);
  return {
    id: record.id,
    version: record.versionNumber,
    contractId: record.contractId,
    title: record.contract?.name ?? "Contract Scope Baseline",
    description: "Active contractual scope specification",
    status: "active",
    clauses,
    deliverables: record.deliverables.map((d) => toDomainDeliverable(d, clauses)),
    createdAt: record.createdAt.toISOString(),
  };
}

export function checklistFromRecord(record: BaselineRecord): ScopeChecklist {
  return {
    title: record.contract?.name ?? "",
    clauses: [...record.clauses]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.clauseNumber.localeCompare(b.clauseNumber))
      .map((row) => {
        const { inclusions, exclusions } = clauseBoundaries(row);
        return { clauseRef: row.clauseNumber, title: row.title, included: inclusions, excluded: exclusions };
      }),
  };
}

/** Saves a confirmed checklist as the project's new active baseline. */
export async function saveChecklist(
  project: { id: string; organizationId: string; name: string; currency: string; contractId: string | null },
  checklist: ScopeChecklist,
  createdBy: string,
): Promise<{ baselineId: string; version: string; savedAt: Date }> {
  const domain = baselineFromChecklist(checklist);

  return db.transaction(async (tx: Tx) => {
    let contractId = project.contractId;
    if (contractId) {
      await tx
        .update(contractsTable)
        .set({ name: domain.title.slice(0, 255), updatedAt: new Date() })
        .where(eq(contractsTable.id, contractId));
    } else {
      const [contract] = await tx
        .insert(contractsTable)
        .values({
          organizationId: project.organizationId,
          name: (domain.title || project.name).slice(0, 255),
          sourceFilename: "Confirmed in ScopeCI",
          sourceType: "CHECKLIST",
          effectiveAt: new Date(),
          currency: project.currency,
        })
        .returning({ id: contractsTable.id });
      contractId = contract.id;
      await tx
        .update(projectsTable)
        .set({ contractId, updatedAt: new Date() })
        .where(eq(projectsTable.id, project.id));
    }

    const previous = await tx
      .select({ version: scopeBaselinesTable.versionNumber })
      .from(scopeBaselinesTable)
      .where(eq(scopeBaselinesTable.contractId, contractId))
      .orderBy(desc(scopeBaselinesTable.createdAt));
    const highest = previous.reduce((max, row) => Math.max(max, Number(row.version.match(/^v(\d+)$/)?.[1] ?? 0)), 0);
    const version = `v${highest + 1}`;

    await tx
      .update(scopeBaselinesTable)
      .set({ status: "SUPERSEDED" })
      .where(and(eq(scopeBaselinesTable.contractId, contractId), eq(scopeBaselinesTable.status, "ACTIVE")));

    const [baseline] = await tx
      .insert(scopeBaselinesTable)
      .values({ contractId, versionNumber: version, status: "ACTIVE", createdBy: createdBy.slice(0, 255) })
      .returning({ id: scopeBaselinesTable.id, createdAt: scopeBaselinesTable.createdAt });

    for (const [index, clause] of domain.clauses.entries()) {
      const [row] = await tx
        .insert(contractClausesTable)
        .values({
          scopeBaselineId: baseline.id,
          clauseNumber: clause.clauseRef.slice(0, 50),
          title: clause.title.slice(0, 255),
          legalText: clause.legalText,
          boundaryType: clause.inclusions.length > 0 ? "INCLUSION" : clause.exclusions.length > 0 ? "EXCLUSION" : "OTHER",
          inclusionsJson: clause.inclusions,
          exclusionsJson: clause.exclusions,
          sourceLocation: `Checklist item ${index + 1}`,
          // Keeps clauses in the order they were confirmed.
          createdAt: new Date(baseline.createdAt.getTime() + index),
        })
        .returning({ id: contractClausesTable.id });
      // One deliverable per clause, as the demo builds it, so a confirmed
      // checklist judges pull requests exactly as /try did.
      await tx.insert(deliverablesTable).values({
        scopeBaselineId: baseline.id,
        clauseId: row.id,
        name: clause.title.slice(0, 255),
        description: clause.legalText,
        acceptanceCriteria: "",
        boundarySummary: clause.title,
      });
    }

    return { baselineId: baseline.id, version, savedAt: baseline.createdAt };
  });
}
