import crypto from "node:crypto";
import type { changeOrdersTable } from "@workspace/db/schema";
import type { ChangeOrderItem } from "@workspace/commercial-engine";
import { itemKey } from "./acceptance.js";

type ChangeOrderRow = typeof changeOrdersTable.$inferSelect;

/**
 * Identifies a letter ScopeCI wrote. Stored with the change order whenever
 * ScopeCI writes its letter; a stored letter that no longer matches was
 * edited by the PM and is theirs, never redrawn.
 */
export const letterHash = (subject: string, body: string) =>
  crypto.createHash("sha256").update(`${subject}\n\n${body}`).digest("hex");

/**
 * Whether a change order's letter is still the one ScopeCI wrote, so it may
 * be redrawn. Change orders drafted before the hash was kept have none:
 * theirs is compared with `drafted()`, the letter ScopeCI would write for
 * them today, which reads a renamed pull request as an edit.
 */
export function letterUntouched(row: ChangeOrderRow, drafted: () => { subject: string; body: string }): boolean {
  if (row.messageSubject === null && row.messageBody === null) return true;
  const subject = row.messageSubject ?? "";
  const body = row.messageBody ?? "";
  if (row.letterHash) return letterHash(subject, body) === row.letterHash;
  const before = drafted();
  return subject === before.subject && body === before.body;
}

export const isDecided = (status: string) => status === "APPROVED" || status === "REJECTED";

export const itemsOf = (row: ChangeOrderRow): ChangeOrderItem[] => (row.itemsJson as ChangeOrderItem[] | null) ?? [];

/**
 * Where a pull request's change orders stand against its latest result.
 *
 * A pull request has at most one open change order (draft or sent). Once the
 * client decides one, excluded work it didn't list (a later push) needs a new
 * one; work already on a decided change order, approved or declined, is never
 * raised again.
 *
 * - `current`: the change order the pull request is on: the open one, else
 *   the latest decided one when nothing new needs raising, else none (one is
 *   to be raised for `fresh`).
 * - `previous`: the latest decided change order, when `current` isn't it.
 * - `fresh`: the result's items that no decided change order lists.
 *
 * `orders` must be the pull request's change orders, oldest first.
 */
export function changeOrderPlan(orders: ChangeOrderRow[], resultItems: ChangeOrderItem[]) {
  const decided = orders.filter((o) => isDecided(o.status));
  const open = orders.find((o) => !isDecided(o.status)) ?? null;
  const listed = new Set(decided.flatMap(itemsOf).map((i) => itemKey(i.item)));
  const fresh = resultItems.filter((i) => !listed.has(itemKey(i.item)));
  const lastDecided = decided.at(-1) ?? null;
  if (open) return { current: open, previous: lastDecided, fresh };
  if (fresh.length > 0) return { current: null, previous: lastDecided, fresh };
  return { current: lastDecided, previous: null, fresh };
}
