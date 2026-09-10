import crypto from "node:crypto";

/**
 * Phase 3 Hard Requirement 1:
 * OAuth credential encryption must be implemented as authenticated
 * encryption (AES-256-GCM) with key rotation in mind.
 *
 * Stored payload:
 * - ciphertext
 * - IV / nonce
 * - authentication tag
 * - encryption key version
 *
 * Never assume one forever-static encryption key.
 */

export interface EncryptedPayload {
  ciphertext: string;
  iv: string; // Hex-encoded 12-byte IV/nonce
  authTag: string; // Hex-encoded 16-byte GCM authentication tag
  keyVersion: string; // e.g. "v1", "v2"
}

const DEFAULT_KEY_VERSION = "v1";

/**
 * Resolves a 32-byte AES-256 key for a specific key version, supporting zero-downtime key rotation.
 * Checks environment variable `LINEAR_TOKEN_ENCRYPTION_KEY_<VERSION>` first,
 * then falls back to `LINEAR_TOKEN_ENCRYPTION_KEY`, then a deterministic test key.
 */
export function resolveEncryptionKey(keyVersion: string = DEFAULT_KEY_VERSION): Buffer {
  const versionedEnvName = `LINEAR_TOKEN_ENCRYPTION_KEY_${keyVersion.toUpperCase()}`;
  const rawKey =
    process.env[versionedEnvName] ||
    process.env.LINEAR_TOKEN_ENCRYPTION_KEY;

  if (!rawKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("LINEAR_TOKEN_ENCRYPTION_KEY must be explicitly configured in production.");
    }
    // Deterministic fallback for test/local development
    return crypto.createHash("sha256").update("scopeci-alpha-deterministic-test-encryption-key-32b").digest();
  }

  // Deterministically hash to 32 bytes (256 bits) to accept passphrase or hex string
  return crypto.createHash("sha256").update(rawKey).digest();
}

/**
 * Encrypts a plaintext secret (such as an OAuth access or refresh token) using AES-256-GCM.
 */
export function encryptToken(
  plaintext: string,
  keyVersion: string = DEFAULT_KEY_VERSION
): EncryptedPayload {
  if (!plaintext) {
    throw new Error("Cannot encrypt empty token payload");
  }

  const key = resolveEncryptionKey(keyVersion);
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    keyVersion,
  };
}

/**
 * Decrypts an authenticated AES-256-GCM encrypted payload using the key version specified in the payload.
 * Throws an error if the authentication tag does not match or if the ciphertext has been tampered with.
 */
export function decryptToken(payload: EncryptedPayload): string {
  if (!payload || !payload.ciphertext || !payload.iv || !payload.authTag) {
    throw new Error("Invalid encrypted payload structure");
  }

  const keyVersion = payload.keyVersion || DEFAULT_KEY_VERSION;
  const key = resolveEncryptionKey(keyVersion);
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(payload.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Generates a cryptographically secure random CSRF state string for OAuth flows (32 bytes / 64 hex chars).
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Phase 3 Requirement: Linear webhook HMAC-SHA256 signature verification.
 * Linear transmits the HMAC-SHA256 signature in the `Linear-Signature` header.
 */
export function verifyLinearWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  try {
    const computedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const headerBuf = Buffer.from(signatureHeader.trim(), "hex");
    const computedBuf = Buffer.from(computedSignature, "hex");

    if (headerBuf.length !== computedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(headerBuf, computedBuf);
  } catch {
    return false;
  }
}

/**
 * September 2026 Linear webhook guidance:
 * Validate webhook timestamp against replay attacks (recommended tolerance: 300 seconds).
 */
export function verifyLinearWebhookTimestamp(
  timestamp: string | number | undefined,
  maxAgeSeconds: number = 300
): boolean {
  if (!timestamp) {
    return false;
  }

  let eventTimeMs: number;
  if (typeof timestamp === "number") {
    // Check if seconds or milliseconds
    eventTimeMs = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  } else {
    const parsedNum = Number(timestamp);
    if (!Number.isNaN(parsedNum)) {
      eventTimeMs = parsedNum < 1e11 ? parsedNum * 1000 : parsedNum;
    } else {
      const parsedDate = Date.parse(timestamp);
      if (Number.isNaN(parsedDate)) {
        return false;
      }
      eventTimeMs = parsedDate;
    }
  }

  const now = Date.now();
  const ageMs = now - eventTimeMs;
  const maxAgeMs = maxAgeSeconds * 1000;

  // Allow up to 60s future drift for slight clock discrepancies between servers
  if (ageMs < -60_000) {
    return false;
  }

  return ageMs <= maxAgeMs;
}
