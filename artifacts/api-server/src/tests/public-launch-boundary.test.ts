/**
 * ScopeCI Alpha — Public Launch Boundary Verification Suite
 *
 * Verifies that the public production surface (https://scopeci.onrender.com)
 * strictly serves ONLY the marketing landing page, privacy policy, and functional
 * waitlist, while completely isolating and protecting all internal/development
 * backends, integrations, admin tooling, and commercial intelligence APIs.
 */

import assert from "node:assert";
import { and, desc, eq } from "drizzle-orm";
import { db, pool, waitlistSignupsTable } from "@workspace/db";
import app from "../app.js";
import http from "node:http";

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

async function testScenario(name: string, fn: () => Promise<void>) {
  stats.scenariosRun++;
  try {
    await fn();
    stats.scenariosPassed++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err: any) {
    stats.failures.push(`${name}: ${err.message}`);
    console.error(`  ✗ FAIL: ${name}`, err);
  }
}

function check(condition: boolean, msg: string) {
  assert(condition, msg);
  stats.assertionsPassed++;
}

/**
 * Minimal in-memory request helper for testing Express app directly
 */
async function makeRequest(
  server: http.Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; text: string }> {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3000;
  const method = options.method || "GET";
  const headers = { ...options.headers };

  let payload = "";
  if (options.body) {
    payload = JSON.stringify(options.body);
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(payload).toString();
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: parsed,
            text: raw,
          });
        });
      }
    );

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runPublicLaunchBoundaryTests() {
  console.log("\n===============================================================");
  console.log("ScopeCI Alpha — Public Launch Boundary & Security Test Suite");
  console.log("Verifying Public / Private Separation for scopeci.onrender.com");
  console.log("===============================================================\n");

  const testPort = 3948;
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(testPort, resolve));

  const testSecret = "test_admin_secret_9999_xyz";
  process.env.ADMIN_SECRET = testSecret;
  process.env.SCOPECI_API_KEY = testSecret;

  const testEmail = `launch-test-${Date.now()}@digitalagency.test`;

  try {
    // -------------------------------------------------------------
    // Criterion 1: Healthcheck Route
    // -------------------------------------------------------------
    await testScenario("Criterion 1: Healthcheck endpoint /api/healthz functions for Render", async () => {
      const res = await makeRequest(server, "/api/healthz");
      check(res.status === 200, "Healthcheck returns 200 OK");
      check(res.body?.status === "ok", "Status payload is { status: 'ok' }");
    });

    // -------------------------------------------------------------
    // Criterion 2: Public Waitlist Submission & Attribution
    // -------------------------------------------------------------
    await testScenario("Criterion 2: Waitlist signup captures agency and full UTM attribution", async () => {
      const res = await makeRequest(server, "/api/waitlist", {
        method: "POST",
        body: {
          email: testEmail,
          agency: "Vanguard Studio Partners",
          utmSource: "linkedin",
          utmMedium: "sponsored_feed",
          utmCampaign: "agency_q3_launch",
          utmContent: "commercial_ci_card",
          utmTerm: "software_agency_sow",
          referrer: "https://www.linkedin.com/feed/",
        },
      });

      check(res.status === 201, `Waitlist submission returns 201 Created (got ${res.status})`);
      check(res.body?.email === testEmail.toLowerCase(), "Normalized email returned");

      // Verify DB persistence of attribution
      const [record] = await db
        .select()
        .from(waitlistSignupsTable)
        .where(eq(waitlistSignupsTable.email, testEmail.toLowerCase()));

      check(record !== undefined, "Waitlist signup persisted in database");
      check(record?.agency === "Vanguard Studio Partners", "Agency name stored");
      check(record?.utmSource === "linkedin", "utmSource captured");
      check(record?.utmCampaign === "agency_q3_launch", "utmCampaign captured");
      check(record?.referrer === "https://www.linkedin.com/feed/", "Referrer captured");
    });

    // -------------------------------------------------------------
    // Criterion 3: Duplicate Waitlist Submission (Idempotency / 409)
    // -------------------------------------------------------------
    await testScenario("Criterion 3: Duplicate waitlist submission returns safe 409 Conflict", async () => {
      const res = await makeRequest(server, "/api/waitlist", {
        method: "POST",
        body: {
          email: testEmail,
          agency: "Duplicate Attempt",
        },
      });

      check(res.status === 409, `Duplicate signup returns 409 Conflict (got ${res.status})`);
      check(res.body?.error === "That email is already on the waitlist.", "Safe user-friendly duplicate message");
    });

    // -------------------------------------------------------------
    // Criterion 4: Input Validation & Bot Honeypot Protection
    // -------------------------------------------------------------
    await testScenario("Criterion 4: Malformed email rejected with 400; bot honeypot dropped", async () => {
      const invalidRes = await makeRequest(server, "/api/waitlist", {
        method: "POST",
        body: { email: "not-an-email" },
      });
      check(invalidRes.status === 400, `Malformed email returns 400 (got ${invalidRes.status})`);

      // Bot with honeypot field
      const botRes = await makeRequest(server, "/api/waitlist", {
        method: "POST",
        body: {
          email: "spambot@harvest.ru",
          hp: "I am a bot filling hidden inputs",
        },
      });
      check(botRes.status === 201, "Honeypot returns 201 without alerting bot");

      // Ensure bot was not inserted
      const [botRecord] = await db
        .select()
        .from(waitlistSignupsTable)
        .where(eq(waitlistSignupsTable.email, "spambot@harvest.ru"));
      check(botRecord === undefined, "Bot was silently dropped and NOT inserted into database");
    });

    // -------------------------------------------------------------
    // Criterion 5: Rate Limiting Abuse Protection
    // -------------------------------------------------------------
    await testScenario("Criterion 5: Waitlist rate limiter triggers 429 when threshold exceeded", async () => {
      // Execute rapid concurrent requests beyond threshold (threshold is 10)
      const burstResults = await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          makeRequest(server, "/api/waitlist", {
            method: "POST",
            headers: { "x-forwarded-for": "198.51.100.42" },
            body: { email: `burst-test-${Date.now()}-${i}@test.com` },
          })
        )
      );
      const throttled = burstResults.some((res) => res.status === 429);
      check(throttled, "Rate limiter successfully blocked rapid automated requests with HTTP 429");
    });

    // -------------------------------------------------------------
    // Criterion 6: Private Admin Authorization (/api/admin/*)
    // -------------------------------------------------------------
    await testScenario("Criterion 6: Admin routes strictly reject anonymous access with 401", async () => {
      const anonRes = await makeRequest(server, "/api/admin/waitlist");
      check(anonRes.status === 401, "Anonymous request to /api/admin/waitlist returns 401");

      const badKeyRes = await makeRequest(server, "/api/admin/waitlist", {
        headers: { "x-admin-key": "invalid_wrong_secret" },
      });
      check(badKeyRes.status === 401, "Invalid admin key returns 401");

      // Valid key via Bearer token
      const authBearerRes = await makeRequest(server, "/api/admin/waitlist", {
        headers: { Authorization: `Bearer ${testSecret}` },
      });
      check(authBearerRes.status === 200, "Valid Bearer token grants admin access (200 OK)");
      check(Array.isArray(authBearerRes.body), "Waitlist returns array of signups");

      // Valid key via x-admin-key
      const authHeaderRes = await makeRequest(server, "/api/admin/waitlist/stats", {
        headers: { "x-admin-key": testSecret },
      });
      check(authHeaderRes.status === 200, "Valid x-admin-key grants stats access (200 OK)");
      check(typeof authHeaderRes.body?.total === "number", "Stats returns aggregate count");

      // Valid key via query parameter for browser CSV download
      const csvRes = await makeRequest(server, `/api/admin/waitlist/csv?key=${testSecret}`);
      check(csvRes.status === 200, "Admin CSV export returns 200 OK");
      check(csvRes.headers["content-type"]?.includes("text/csv") === true, "Content-Type is text/csv");
      check(csvRes.text.includes("email,agency,utm_source"), "CSV contains expected header columns");
    });

    // -------------------------------------------------------------
    // Criterion 7: Internal Integration APIs Protected from Public Access
    // -------------------------------------------------------------
    await testScenario("Criterion 7: Internal integration & onboarding routes reject anonymous callers", async () => {
      // Linear OAuth Connect
      const linearConnectRes = await makeRequest(server, "/api/integrations/linear/connect?organizationId=test_org");
      check(linearConnectRes.status === 401, "Anonymous call to /api/integrations/linear/connect returns 401");

      // Project Mapping
      const projectMapRes = await makeRequest(server, "/api/integrations/linear/projects/map", {
        method: "POST",
        body: { organizationId: "test_org" },
      });
      check(projectMapRes.status === 401, "Anonymous call to /api/integrations/linear/projects/map returns 401");

      // Issue Linking
      const linkDeliverableRes = await makeRequest(server, "/api/integrations/linear/issues/ENG-184/link-deliverable", {
        method: "POST",
        body: { deliverableId: "deliv_auth" },
      });
      check(linkDeliverableRes.status === 401, "Anonymous call to /api/integrations/linear/issues/:id/link-deliverable returns 401");
    });

    // -------------------------------------------------------------
    // Criterion 8: Webhook Endpoints Reject Forged Requests
    // -------------------------------------------------------------
    await testScenario("Criterion 8: Webhooks fail-closed against unauthenticated/forged requests", async () => {
      const ghRes = await makeRequest(server, "/api/webhooks/github", {
        method: "POST",
        body: { action: "opened" },
      });
      check(ghRes.status === 401, "Unsigned GitHub webhook returns 401 Unauthorized");

      const linRes = await makeRequest(server, "/api/webhooks/linear", {
        method: "POST",
        body: { type: "Issue", action: "update" },
      });
      check(linRes.status === 401, "Unsigned Linear webhook returns 401 Unauthorized");
    });

    // -------------------------------------------------------------
    // Criterion 9: Credential Isolation (Zero Secret Leakage)
    // -------------------------------------------------------------
    await testScenario("Criterion 9: Responses never leak internal database or integration secrets", async () => {
      const healthRes = await makeRequest(server, "/api/healthz");
      check(!healthRes.text.includes("postgres://") && !healthRes.text.includes("postgresql://"), "No database URLs in healthz");

      const waitlistRes = await makeRequest(server, "/api/waitlist", {
        method: "POST",
        body: { email: `check-leak-${Date.now()}@studio.agency` },
      });
      check(!waitlistRes.text.includes(testSecret), "ADMIN_SECRET is not in waitlist response");
      check(!waitlistRes.text.includes("DATABASE_URL"), "DATABASE_URL is not in waitlist response");
    });

    // -------------------------------------------------------------
    // Criterion 10: CSP Allows Google Fonts, Blocks Arbitrary Origins
    // -------------------------------------------------------------
    await testScenario("Criterion 10: CSP header allows Google Fonts and blocks arbitrary external origins", async () => {
      const res = await makeRequest(server, "/api/healthz");
      const csp = res.headers["content-security-policy"] as string || "";

      // Must allow Google Fonts stylesheet
      check(csp.includes("https://fonts.googleapis.com"), "CSP style-src includes https://fonts.googleapis.com");

      // Must allow Google Fonts woff2 files
      check(csp.includes("https://fonts.gstatic.com"), "CSP font-src includes https://fonts.gstatic.com");

      // Must have explicit style-src-elem directive for Google Fonts
      check(csp.includes("style-src-elem"), "CSP includes style-src-elem directive");

      // Must not broadly allow all https: for scripts (only 'self' 'unsafe-inline')
      const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) || "";
      check(!scriptSrc.includes("https:"), "script-src does not broadly allow all HTTPS origins");

      // Frame ancestors remain 'none'
      check(csp.includes("frame-ancestors 'none'"), "frame-ancestors is still 'none'");

      // default-src is still 'self'
      check(csp.includes("default-src 'self'"), "default-src is still 'self'");
    });

    // -------------------------------------------------------------
    // Criterion 11: Same-origin static assets survive production CORS
    // -------------------------------------------------------------
    await testScenario("Criterion 11: Built JS/CSS assets load with same-origin crossorigin requests in production", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");

      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const publicDir = path.join(currentDir, "..", "..", "..", "scopeci", "dist", "public");
      const assetsDir = path.join(publicDir, "assets");

      if (!fs.existsSync(assetsDir)) {
        console.log("  (skipped — frontend build not present)");
        return;
      }

      const jsAsset = fs.readdirSync(assetsDir).find((name) => name.endsWith(".js"));
      check(Boolean(jsAsset), "Built JS asset exists under artifacts/scopeci/dist/public/assets");

      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const origin = `http://127.0.0.1:${testPort}`;
        const res = await makeRequest(server, `/assets/${jsAsset}`, {
          headers: { Origin: origin },
        });
        check(res.status === 200, `Same-origin JS asset returns 200 (got ${res.status})`);
        check(
          typeof res.headers["access-control-allow-origin"] === "string",
          "Same-origin JS asset includes Access-Control-Allow-Origin",
        );
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }
    });

    // -------------------------------------------------------------
    // Criterion 12: SPA Fallback Does NOT Serve HTML for Static Assets
    // -------------------------------------------------------------
    await testScenario("Criterion 12: Missing static assets return 404, not index.html with wrong MIME type", async () => {
      // Request a non-existent CSS file — should NOT get index.html
      const cssRes = await makeRequest(server, "/assets/nonexistent-file.css");
      check(cssRes.status === 404, `Missing .css file returns 404 (got ${cssRes.status})`);

      // Request a non-existent JS file — should NOT get index.html
      const jsRes = await makeRequest(server, "/assets/nonexistent-file.js");
      check(jsRes.status === 404, `Missing .js file returns 404 (got ${jsRes.status})`);

      // Request a non-existent woff2 font file — should NOT get index.html
      const fontRes = await makeRequest(server, "/assets/nonexistent-font.woff2");
      check(fontRes.status === 404, `Missing .woff2 file returns 404 (got ${fontRes.status})`);

      // SPA routes (paths without extensions) should still work — they get index.html
      // or the SPA fallback. This verifies the fallback still works for SPA paths.
      // (Note: in test mode without a build, this may 404 too, which is fine —
      //  the key assertion is that .css/.js paths DON'T get index.html.)
    });

    // -------------------------------------------------------------
    // Criterion 13: Production Route Gating Logic Exists
    // -------------------------------------------------------------
    await testScenario("Criterion 13: Integration routes are gated behind ENABLE_INTEGRATION_ROUTES in production", async () => {
      // Read the routes/index source to verify the gate exists.
      // This is a source-level verification that the gate wasn't accidentally removed.
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");

      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const routesIndexPath = path.join(currentDir, "..", "routes", "index.ts");

      // Try compiled .mjs first (production), then .ts (source)
      let source = "";
      for (const ext of [".ts", ".mjs", ".js"]) {
        const candidate = routesIndexPath.replace(/\.\w+$/, ext);
        try {
          source = fs.readFileSync(candidate, "utf-8");
          if (source.length > 0) break;
        } catch {
          // try next
        }
      }

      check(source.includes("ENABLE_INTEGRATION_ROUTES"), "routes/index contains ENABLE_INTEGRATION_ROUTES gate");
      check(source.includes("NODE_ENV") || source.includes("isProduction"), "routes/index checks NODE_ENV for production");
      check(source.includes("githubRouter"), "routes/index still imports githubRouter (not deleted)");
      check(source.includes("linearRouter"), "routes/index still imports linearRouter (not deleted)");
    });

    // -------------------------------------------------------------
    // Criterion 14: No Hardcoded Runtime Domain Dependencies
    // -------------------------------------------------------------
    await testScenario("Criterion 14: No hardcoded scopeci.dev, scopeci.com, or scopeci.in in runtime source", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");

      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      // Check the routes directory (runtime source)
      const routesDir = path.join(currentDir, "..", "routes");
      const middlewaresDir = path.join(currentDir, "..", "middlewares");
      const appPath = path.join(currentDir, "..", "app.ts");

      const runtimeDirs = [routesDir, middlewaresDir];
      const runtimeFiles = [appPath];

      const forbiddenDomains = ["scopeci.dev", "scopeci.com", "scopeci.in"];

      for (const dir of runtimeDirs) {
        let entries: string[] = [];
        try {
          entries = fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts") || f.endsWith(".mjs") || f.endsWith(".js"));
        } catch {
          continue;
        }
        for (const file of entries) {
          const content = fs.readFileSync(path.join(dir, file), "utf-8");
          for (const domain of forbiddenDomains) {
            check(
              !content.includes(domain),
              `${file} must not contain hardcoded ${domain}`
            );
          }
        }
      }

      for (const filePath of runtimeFiles) {
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          for (const domain of forbiddenDomains) {
            check(
              !content.includes(domain),
              `${path.basename(filePath)} must not contain hardcoded ${domain}`
            );
          }
        } catch {
          // File may not exist in compiled form
        }
      }
    });

  } finally {
    // Clean up test waitlist records
    try {
      await db.delete(waitlistSignupsTable).where(eq(waitlistSignupsTable.email, testEmail.toLowerCase()));
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await pool.end();
    } catch {
      // ignore
    }
  }

  console.log("\n---------------------------------------------------------------");
  console.log(`Launch Boundary Scenarios: ${stats.scenariosPassed} / ${stats.scenariosRun}`);
  console.log(`Assertions Passed:         ${stats.assertionsPassed}`);
  if (stats.failures.length > 0) {
    console.log(`Failures (${stats.failures.length}):`);
    for (const f of stats.failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log("PUBLIC LAUNCH BOUNDARY STRICTLY ENFORCED & VERIFIED ✓");
    console.log("---------------------------------------------------------------\n");
    process.exit(0);
  }
}

runPublicLaunchBoundaryTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
