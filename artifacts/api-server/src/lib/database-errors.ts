/** Postgres and network codes that mean the database is unreachable or busy, not that the query was wrong. */
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "57P01", // admin shutdown
  "57P02", // crash shutdown
  "57P03", // cannot connect now
  "53300", // too many connections
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
]);

/** A database TLS setup that doesn't verify (see DATABASE_CA_CERT). */
const TLS_REFUSED = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * Whether an error means the database couldn't be reached at all. With
 * `tls: false`, a certificate that doesn't verify doesn't count: that is a
 * setup mistake a new deploy should be held back for, not an outage.
 */
export function databaseUnavailable(err: unknown, { tls = true } = {}): boolean {
  for (let e = err as { code?: unknown; message?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    const code = typeof e.code === "string" ? e.code : "";
    if (UNREACHABLE.has(code) || (tls && TLS_REFUSED.has(code))) return true;
    if (typeof e.message === "string" && /Connection terminated|timeout exceeded when trying to connect/i.test(e.message)) return true;
  }
  return false;
}
