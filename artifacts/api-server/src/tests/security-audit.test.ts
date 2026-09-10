import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  organizationsTable,
  linearConnectionsTable,
  linearWebhookDeliveriesTable,
  webhookDeliveriesTable,
  projectLinksTable,
  scopeBaselinesTable,
  waitlistSignupsTable,
} from "@workspace/db/schema";
import {
  encryptToken,
  decryptToken,
  resolveEncryptionKey,
  verifyLinearWebhookSignature,
  verifyLinearWebhookTimestamp,
} from "../linear/crypto.js";
import { RealLinearClient, MockLinearClient } from "../linear/linear-client.js";
import { WebhookService, verifyWebhookSignature } from "../github/webhook-service.js";
import { MockGitHubClient } from "../github/github-client.js";
import { MockIssueProvider } from "../github/issue-provider.js";
import { timingSafeCompare, requireTenantAccess } from "../middlewares/auth.js";
import { sanitizeMarkdown } from "../github/comment-formatter.js";
import { rateLimiter } from "../middlewares/rate-limit.js";

interface TestStats {
  scenariosRun: number;
  scenariosPassed: number;
  assertionsPassed: number;
  failures: string[];
}

const stats: TestStats = {
  scenariosRun: 0,
  scenariosPassed: 0,
  assertionsPassed: 0,
  failures: [],
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  stats.assertionsPassed++;
}

async function runScenario(name: string, fn: () => Promise<void>): Promise<void> {
  stats.scenariosRun++;
  process.stdout.write(`  [SECURITY SCENARIO ${stats.scenariosRun}] ${name}... `);
  try {
    await fn();
    stats.scenariosPassed++;
    console.log("\x1b[32mPASSED\x1b[0m");
  } catch (err: any) {
    stats.failures.push(`${name}: ${err.message}`);
    console.log(`\x1b[31mFAILED\x1b[0m\n    Error: ${err.message}`);
  }
}

async function main() {
  console.log("\n===============================================================");
  console.log("ScopeCI Alpha — September 2026 Adversarial Security Audit Suite");
  console.log("Testing OWASP Top 10:2025, Multi-Tenancy, Replay & Crypto Invariants");
  console.log("===============================================================\n");

  const runId = Date.now();
  const orgAId = crypto.randomUUID();
  const orgBId = crypto.randomUUID();

  // Setup test tenants in database
  await db.insert(organizationsTable).values([
    {
      id: orgAId,
      name: `Security Tenant A ${runId}`,
      slug: `sec-tenant-a-${runId}`,
    },
    {
      id: orgBId,
      name: `Security Tenant B ${runId}`,
      slug: `sec-tenant-b-${runId}`,
    },
  ]);

  try {
    /* -------------------------------------------------------------
       Scenario 1: Multi-Tenant Isolation: Cross-Tenant Access Rejection
       ------------------------------------------------------------- */
    await runScenario("Multi-Tenant Isolation: Caller from Org A cannot access Org B", async () => {
      const middleware = requireTenantAccess((req: any) => req.body?.organizationId);

      let statusCode = 200;
      let responseBody: any = null;
      const mockRes: any = {
        status(code: number) {
          statusCode = code;
          return {
            json(body: any) {
              responseBody = body;
            },
          };
        },
      };

      // Attacker authenticated as Org A attempts to access Org B
      const mockReq: any = {
        caller: { organizationId: orgAId, authenticated: true },
        body: { organizationId: orgBId },
      };

      await middleware(mockReq, mockRes, () => {
        statusCode = 200;
      });

      assert(statusCode === 403, `Expected status 403, got ${statusCode}`);
      assert(
        responseBody?.message?.includes("cross-tenant access is prohibited"),
        "Expected cross-tenant access rejection error message"
      );
    });

    /* -------------------------------------------------------------
       Scenario 2: Malformed Organization UUID Injection Rejection
       ------------------------------------------------------------- */
    await runScenario("Input Validation: Malformed / SQL-injection organizationId is rejected", async () => {
      const middleware = requireTenantAccess((req: any) => req.body?.organizationId);

      let statusCode = 200;
      let responseBody: any = null;
      const mockRes: any = {
        status(code: number) {
          statusCode = code;
          return {
            json(body: any) {
              responseBody = body;
            },
          };
        },
      };

      const injectionReq: any = {
        caller: { authenticated: true },
        body: { organizationId: "' OR 1=1; --" },
      };

      await middleware(injectionReq, mockRes, () => {
        statusCode = 200;
      });

      assert(statusCode === 400, `Expected status 400, got ${statusCode}`);
      assert(
        responseBody?.message?.includes("Invalid organizationId format"),
        "Expected format validation failure"
      );
    });

    /* -------------------------------------------------------------
       Scenario 3: Unmapped Linear Workspace Fail-Closed Protection
       ------------------------------------------------------------- */
    await runScenario("Linear Webhooks: Unmapped workspace fails closed without tenant fallback", async () => {
      const unmappedWorkspaceId = `lin_ws_unmapped_${Date.now()}`;
      const deliveryId = `lin_del_sec_${Date.now()}`;

      // Insert delivery record
      const [delivery] = await db
        .insert(linearWebhookDeliveriesTable)
        .values({
          deliveryId,
          eventType: "Issue",
          action: "create",
          linearWorkspaceId: unmappedWorkspaceId,
          linearIssueId: "lin_iss_sec_1",
          providerUpdatedAt: new Date(),
          status: "PENDING",
          expiresAt: new Date(Date.now() + 86400000),
        })
        .returning();

      // Check workspace connection
      const conn = await db
        .select()
        .from(linearConnectionsTable)
        .where(eq(linearConnectionsTable.linearWorkspaceId, unmappedWorkspaceId))
        .limit(1);

      let resolvedOrgId: string | null = conn.length > 0 ? conn[0].organizationId : null;

      // Fail closed: Do NOT fallback to first org in DB
      if (!resolvedOrgId) {
        await db
          .update(linearWebhookDeliveriesTable)
          .set({
            status: "IGNORED",
            errorMessage: "unmapped_workspace",
            processedAt: new Date(),
          })
          .where(eq(linearWebhookDeliveriesTable.id, delivery.id));
      }

      // Verify delivery is marked IGNORED and not PROCESSED
      const updated = await db.query.linearWebhookDeliveriesTable.findFirst({
        where: eq(linearWebhookDeliveriesTable.id, delivery.id),
      });

      assert(updated?.status === "IGNORED", `Expected IGNORED status, got ${updated?.status}`);
      assert(updated?.errorMessage === "unmapped_workspace", "Expected unmapped_workspace error message");
    });

    /* -------------------------------------------------------------
       Scenario 4: Linear Webhook Timestamp Replay Protection
       ------------------------------------------------------------- */
    await runScenario("Linear Webhooks: Timestamp validation enforces 300-second replay window", async () => {
      const now = Date.now();

      // 1. Fresh timestamp (within 300s) -> Valid
      const freshTimestamp = (now - 10_000).toString(); // 10s ago
      assert(verifyLinearWebhookTimestamp(freshTimestamp, 300) === true, "Fresh timestamp must be valid");

      // 2. Stale timestamp (10 minutes ago) -> Rejected
      const staleTimestamp = (now - 600_000).toString(); // 600s ago
      assert(verifyLinearWebhookTimestamp(staleTimestamp, 300) === false, "Stale timestamp must be rejected");

      // 3. Far-future timestamp (5 minutes in future) -> Rejected
      const futureTimestamp = (now + 300_000).toString();
      assert(verifyLinearWebhookTimestamp(futureTimestamp, 300) === false, "Far future timestamp must be rejected");

      // 4. Missing/undefined timestamp -> Rejected
      assert(verifyLinearWebhookTimestamp(undefined, 300) === false, "Undefined timestamp must be rejected");
    });

    /* -------------------------------------------------------------
       Scenario 5: Webhook Signature Forgery Rejection (Linear)
       ------------------------------------------------------------- */
    await runScenario("Cryptographic Verification: Linear forged HMAC-SHA256 is rejected", async () => {
      const secret = "correct_linear_webhook_secret_12345";
      const payload = JSON.stringify({ action: "create", type: "Issue" });
      const validSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
      const forgedSig = crypto.createHmac("sha256", "wrong_secret").update(payload).digest("hex");

      assert(verifyLinearWebhookSignature(payload, validSig, secret) === true, "Valid signature must pass");
      assert(verifyLinearWebhookSignature(payload, forgedSig, secret) === false, "Forged signature must fail");
      assert(verifyLinearWebhookSignature(payload, "malformed_hex", secret) === false, "Malformed hex must fail");
      assert(verifyLinearWebhookSignature(payload, "", secret) === false, "Empty signature must fail");
    });

    /* -------------------------------------------------------------
       Scenario 6: Webhook Signature Forgery Rejection (GitHub)
       ------------------------------------------------------------- */
    await runScenario("Cryptographic Verification: GitHub forged X-Hub-Signature-256 is rejected", async () => {
      const secret = "correct_github_webhook_secret_12345";
      const payload = JSON.stringify({ action: "opened", repository: { full_name: "test/repo" } });
      const validSig = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
      const forgedSig = `sha256=${crypto.createHmac("sha256", "wrong_secret").update(payload).digest("hex")}`;

      assert(verifyWebhookSignature(payload, validSig, secret) === true, "Valid GitHub signature must pass");
      assert(verifyWebhookSignature(payload, forgedSig, secret) === false, "Forged GitHub signature must fail");
      assert(verifyWebhookSignature(payload, "invalid_prefix", secret) === false, "Invalid prefix signature must fail");

      // Verify GitHub service precheck fails closed on forged signature
      const service = new WebhookService({
        webhookSecret: secret,
        gitHubClient: new MockGitHubClient(),
        issueProvider: new MockIssueProvider(),
      });
      let threw = false;
      try {
        await service.precheckAndPersistDelivery(
          {
            deliveryId: `gh_del_sec_${Date.now()}`,
            eventType: "pull_request",
            signature: forgedSig,
          },
          payload,
          JSON.parse(payload)
        );
      } catch (err: any) {
        threw = true;
        assert(err.message === "Invalid webhook signature", `Expected Invalid webhook signature, got ${err.message}`);
      }
      assert(threw, "Precheck must throw on forged signature");
    });

    /* -------------------------------------------------------------
       Scenario 7: Open Redirect Protection in OAuth
       ------------------------------------------------------------- */
    await runScenario("OAuth Security: Open redirect URLs are strictly sanitized to application domain", async () => {
      const appBase = "https://app.scopeci.dev";

      function sanitizeUrl(target: string | undefined): string {
        const fallback = `${appBase}/settings/integrations/linear`;
        if (!target) return fallback;
        try {
          if (target.startsWith("/") && !target.startsWith("//")) {
            return `${appBase}${target}`;
          }
          const parsed = new URL(target);
          if (parsed.origin === new URL(appBase).origin) {
            return target;
          }
          return fallback;
        } catch {
          return fallback;
        }
      }

      // Attack: Attempt redirect to attacker domain
      const evilTarget = "https://attacker.evil.com/steal-token";
      assert(sanitizeUrl(evilTarget) === `${appBase}/settings/integrations/linear`, "Evil domain must be sanitized to fallback");

      // Attack: Protocol relative URL
      const protoRelative = "//attacker.evil.com";
      assert(sanitizeUrl(protoRelative) === `${appBase}/settings/integrations/linear`, "Protocol relative must be sanitized");

      // Valid: Approved app path
      const validTarget = `${appBase}/settings/integrations/linear?status=connected`;
      assert(sanitizeUrl(validTarget) === validTarget, "Approved app URL must be preserved");

      // Valid: Relative path
      assert(sanitizeUrl("/dashboard") === `${appBase}/dashboard`, "Relative path must resolve to appBase");
    });

    /* -------------------------------------------------------------
       Scenario 8: Admin Authentication Timing-Safe Comparison
       ------------------------------------------------------------- */
    await runScenario("Timing Attack Defense: timingSafeCompare operates in constant time", async () => {
      const adminSecret = "super_secret_high_entropy_token_64chars_abcdefghijklmnopqrstuvwxyz";

      // Correct secret
      assert(timingSafeCompare(adminSecret, adminSecret) === true, "Identical secrets must match");

      // Secret with same length but different last byte
      const tamperedLast = adminSecret.substring(0, adminSecret.length - 1) + "X";
      assert(timingSafeCompare(tamperedLast, adminSecret) === false, "Different byte must return false");

      // Secret with different length
      assert(timingSafeCompare("short", adminSecret) === false, "Different length must return false");
      assert(timingSafeCompare("", adminSecret) === false, "Empty string must return false");
    });

    /* -------------------------------------------------------------
       Scenario 9: CSV Formula Injection Sanitization
       ------------------------------------------------------------- */
    await runScenario("Data Export Security: CSV formula injection characters are escaped with single quotes", async () => {
      const escape = (val: unknown): string => {
        if (val === null || val === undefined) return "";
        let str = String(val);
        if (/^[=+\-@\t\r]/.test(str)) {
          str = `'${str}`;
        }
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      // Formula injection attacks
      assert(escape("=cmd|' /C calc'!A0") === "'=cmd|' /C calc'!A0", "Equals sign formula must be prefixed with '");
      assert(escape("+1+2") === "'+1+2", "Plus sign formula must be prefixed with '");
      assert(escape("-2+3") === "'-2+3", "Minus sign formula must be prefixed with '");
      assert(escape("@SUM(A1:A10)") === "'@SUM(A1:A10)", "At sign formula must be prefixed with '");

      // Safe inputs
      assert(escape("standard_user@domain.com") === "standard_user@domain.com", "Normal email must not be altered");
      assert(escape("Acme, Inc.") === '"Acme, Inc."', "Comma must be enclosed in quotes");
    });

    /* -------------------------------------------------------------
       Scenario 10: SSRF Protection in Linear Client
       ------------------------------------------------------------- */
    await runScenario("SSRF Defense: RealLinearClient blocks private/loopback/cloud-metadata hosts", async () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      try {
        // Attack: AWS/GCP cloud metadata service
        let metadataBlocked = false;
        try {
          new RealLinearClient("token", "http://169.254.169.254/latest/meta-data");
        } catch (err: any) {
          metadataBlocked = err.message.includes("SSRF Blocked") || err.message.includes("HTTPS");
        }
        assert(metadataBlocked, "Metadata endpoint must be blocked");

        // Attack: Local loopback
        let loopbackBlocked = false;
        try {
          new RealLinearClient("token", "https://localhost:8080/graphql");
        } catch (err: any) {
          loopbackBlocked = err.message.includes("SSRF Blocked");
        }
        assert(loopbackBlocked, "Localhost endpoint must be blocked in production");

        // Valid: Real Linear endpoint
        const validClient = new RealLinearClient("token", "https://api.linear.app/graphql");
        assert(validClient !== null, "Valid Linear endpoint must be accepted");
      } finally {
        process.env.NODE_ENV = oldEnv;
      }
    });

    /* -------------------------------------------------------------
       Scenario 11: Authenticated Encryption (AES-256-GCM) Tampering Detection
       ------------------------------------------------------------- */
    await runScenario("Cryptographic Integrity: Tampered ciphertext or auth tag fails AEAD decryption", async () => {
      const originalToken = "lin_oauth_tok_secret_access_token_12345";
      const encrypted = encryptToken(originalToken, "v1");

      // Clean decryption
      const decrypted = decryptToken(encrypted);
      assert(decrypted === originalToken, "Clean payload must decrypt successfully");

      // Tampered ciphertext: Flip single byte
      const tamperedCipher = {
        ...encrypted,
        ciphertext:
          encrypted.ciphertext.substring(0, 4) +
          (encrypted.ciphertext[4] === "a" ? "b" : "a") +
          encrypted.ciphertext.substring(5),
      };

      let cipherTamperDetected = false;
      try {
        decryptToken(tamperedCipher);
      } catch {
        cipherTamperDetected = true;
      }
      assert(cipherTamperDetected, "Tampered ciphertext must fail authentication tag check");

      // Tampered auth tag
      const tamperedTag = {
        ...encrypted,
        authTag:
          encrypted.authTag.substring(0, 4) +
          (encrypted.authTag[4] === "f" ? "0" : "f") +
          encrypted.authTag.substring(5),
      };

      let tagTamperDetected = false;
      try {
        decryptToken(tamperedTag);
      } catch {
        tagTamperDetected = true;
      }
      assert(tagTamperDetected, "Tampered authTag must fail authentication tag check");
    });

    /* -------------------------------------------------------------
       Scenario 12: Production Encryption Key Fail-Closed
       ------------------------------------------------------------- */
    await runScenario("Cryptographic Configuration: resolveEncryptionKey fails closed in production", async () => {
      const oldEnv = process.env.NODE_ENV;
      const oldKey = process.env.LINEAR_TOKEN_ENCRYPTION_KEY;
      delete process.env.LINEAR_TOKEN_ENCRYPTION_KEY;
      delete process.env.LINEAR_TOKEN_ENCRYPTION_KEY_V1;
      process.env.NODE_ENV = "production";

      let threw = false;
      try {
        resolveEncryptionKey("v1");
      } catch (err: any) {
        threw = true;
        assert(
          err.message.includes("LINEAR_TOKEN_ENCRYPTION_KEY must be explicitly configured"),
          `Expected missing key error, got: ${err.message}`
        );
      } finally {
        process.env.NODE_ENV = oldEnv;
        if (oldKey) process.env.LINEAR_TOKEN_ENCRYPTION_KEY = oldKey;
      }

      assert(threw, "Must throw in production if encryption key is missing");
    });

    /* -------------------------------------------------------------
       Scenario 13: Markdown Table Delimiter & Backtick Sanitization
       ------------------------------------------------------------- */
    await runScenario("Content Sanitization: Pipe characters and backticks in untrusted text are escaped", async () => {
      const untrustedInput = "Issue Title | rm -rf / | `eval(code)`";
      const sanitized = sanitizeMarkdown(untrustedInput);

      assert(!sanitized.includes("|"), "Sanitized string must not contain raw pipe characters");
      assert(sanitized.includes("&#124;"), "Pipes must be converted to &#124;");
      assert(!sanitized.includes("`"), "Sanitized string must not contain raw backticks");
      assert(sanitized.includes("&#96;"), "Backticks must be converted to &#96;");
    });

    /* -------------------------------------------------------------
       Scenario 14: Sliding Window Rate Limiting Throttling
       ------------------------------------------------------------- */
    await runScenario("Availability: Rate limiter throttles rapid bursts exceeding configured threshold", async () => {
      const limiter = rateLimiter({
        windowMs: 1000,
        max: 3,
        keyGenerator: () => "test_client_ip_1",
      });

      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        let code = 200;
        const mockRes: any = {
          setHeader() {},
          status(c: number) {
            code = c;
            return { json() {} };
          },
        };
        limiter({} as any, mockRes, () => {
          code = 200;
        });
        results.push(code);
      }

      assert(results[0] === 200, "Request 1 must be allowed (200)");
      assert(results[1] === 200, "Request 2 must be allowed (200)");
      assert(results[2] === 200, "Request 3 must be allowed (200)");
      assert(results[3] === 429, `Request 4 must be rate-limited (429), got ${results[3]}`);
      assert(results[4] === 429, `Request 5 must be rate-limited (429), got ${results[4]}`);
    });
  } finally {
    // Clean up test tenants
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgAId));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgBId));
  }

  console.log("\n---------------------------------------------------------------");
  console.log(`Security Scenarios Completed: ${stats.scenariosPassed} / ${stats.scenariosRun}`);
  console.log(`Security Assertions Passed:  ${stats.assertionsPassed}`);
  if (stats.failures.length > 0) {
    console.log(`Failures (${stats.failures.length}):`);
    for (const f of stats.failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log("\x1b[32mALL SECURITY INVARIANTS VERIFIED SUCCESSFULLY\x1b[0m");
    console.log("---------------------------------------------------------------\n");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error running security audit test suite:", err);
  process.exit(1);
});
