import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { commercialEventsTable } from "@workspace/db/schema";

/**
 * A PM's decision to let a flagged pull request through without a change
 * order: the client agreed informally, the work is absorbed as goodwill, or
 * the flag was wrong. It is kept in the event log (accepted, then perhaps
 * withdrawn), applies to later pushes of the same pull request, and covers
 * only the excluded work it was accepted with: anything new is flagged again.
 */
export const ACCEPTED = "PR_ACCEPTED";
export const WITHDRAWN = "PR_ACCEPTANCE_WITHDRAWN";

export interface Acceptance {
  reason: string;
  /** The excluded items accepted, lower-cased; empty when only a review was asked for. */
  items: string[];
  acceptedBy: string;
  acceptedAt: Date;
}

export const itemKey = (item: string) => item.trim().toLowerCase();

/** The standing acceptance for each pull request that has one. */
export async function acceptancesFor(pullRequestIds: string[]): Promise<Map<string, Acceptance>> {
  if (pullRequestIds.length === 0) return new Map();
  const events = await db
    .select()
    .from(commercialEventsTable)
    .where(
      and(
        eq(commercialEventsTable.entityType, "PULL_REQUEST"),
        inArray(commercialEventsTable.entityId, pullRequestIds),
        inArray(commercialEventsTable.eventType, [ACCEPTED, WITHDRAWN]),
      ),
    )
    .orderBy(desc(commercialEventsTable.occurredAt));
  const found = new Map<string, Acceptance>();
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.entityId)) continue;
    seen.add(event.entityId);
    if (event.eventType !== ACCEPTED) continue;
    const meta = (event.metadataJson ?? {}) as { reason?: string; items?: string[] };
    found.set(event.entityId, {
      reason: meta.reason ?? "",
      items: meta.items ?? [],
      acceptedBy: event.actorId ?? "",
      acceptedAt: event.occurredAt,
    });
  }
  return found;
}

export async function acceptanceFor(pullRequestId: string): Promise<Acceptance | null> {
  return (await acceptancesFor([pullRequestId])).get(pullRequestId) ?? null;
}

/** Whether an acceptance covers every excluded item a result flags. */
export function covers(acceptance: Acceptance, flaggedItems: string[]): boolean {
  const accepted = new Set(acceptance.items.map(itemKey));
  return flaggedItems.every((item) => accepted.has(itemKey(item)));
}
