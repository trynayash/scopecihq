/**
 * ScopeCI Alpha — Public Launch Boundary Verification Suite
 *
 * Verifies that the public production surface (https://scopeci.onrender.com)
 * strictly serves ONLY the marketing landing page, privacy policy, and functional
 * waitlist, while completely isolating and protecting all internal/development
 * backends, integrations, admin tooling, and commercial intelligence APIs.
 */

import assert from "node:assert";
import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { db, pool, siteEventsTable, waitlistSignupsTable } from "@workspace/db";
import app from "../app.js";
import { logger } from "../lib/logger.js";
import { dailyEventBudget } from "../routes/events.js";
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
    rawBody?: string;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; text: string }> {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 3000;
  const method = options.method || "GET";
  const headers = { ...options.headers };

  let payload = "";
  if (options.rawBody !== undefined) {
    payload = options.rawBody;
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(payload).toString();
  } else if (options.body) {
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
          utmSource: "newsletter",
          utmMedium: "sponsored_feed",
          utmCampaign: "agency_q3_launch",
          utmContent: "commercial_ci_card",
          utmTerm: "software_agency_sow",
          referrer: "https://news.ycombinator.com/",
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
      check(record?.utmSource === "newsletter", "utmSource captured");
      check(record?.utmCampaign === "agency_q3_launch", "utmCampaign captured");
      check(record?.referrer === "https://news.ycombinator.com/", "Referrer captured");
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

      // The key is never accepted in a query string: it would end up in
      // browser history and proxy logs.
      const queryKeyRes = await makeRequest(server, `/api/admin/waitlist/csv?key=${testSecret}`);
      check(queryKeyRes.status === 401, `Admin key in a query string is refused (got ${queryKeyRes.status})`);
      check(String(anonRes.headers["cache-control"]).includes("no-store"), "Admin responses are not cacheable");
    });

    // -------------------------------------------------------------
    // Criterion 6b: Admin session cookie (sign in, use, delete, sign out)
    // -------------------------------------------------------------
    await testScenario("Criterion 6b: Admin signs in once and gets an httpOnly, SameSite=Strict session", async () => {
      const wrongRes = await makeRequest(server, "/api/admin/session", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.60" },
        body: { key: "not-the-key" },
      });
      check(wrongRes.status === 401, `Wrong key is refused (got ${wrongRes.status})`);
      check(wrongRes.headers["set-cookie"] === undefined, "Wrong key sets no cookie");

      const signInRes = await makeRequest(server, "/api/admin/session", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.60" },
        body: { key: testSecret },
      });
      check(signInRes.status === 204, `Correct key signs in (got ${signInRes.status})`);
      const setCookie = signInRes.headers["set-cookie"]?.[0] ?? "";
      check(setCookie.startsWith("scopeci_admin="), "Session cookie is set");
      check(/HttpOnly/i.test(setCookie), "Session cookie is HttpOnly");
      check(/SameSite=Strict/i.test(setCookie), "Session cookie is SameSite=Strict");
      check(!setCookie.includes(testSecret), "Session cookie does not contain the admin key");

      const cookie = setCookie.split(";")[0];
      const sessionRes = await makeRequest(server, "/api/admin/session", { headers: { cookie } });
      check(sessionRes.status === 204, "Session check passes with the cookie");

      const csvRes = await makeRequest(server, "/api/admin/waitlist/csv", { headers: { cookie } });
      check(csvRes.status === 200, "Admin CSV export returns 200 OK with the session cookie");
      check(csvRes.headers["content-type"]?.includes("text/csv") === true, "Content-Type is text/csv");
      check(csvRes.text.includes("email,agency,utm_source"), "CSV contains expected header columns");

      const forged = `${Date.now() + 60_000}.${"A".repeat(43)}`;
      const forgedRes = await makeRequest(server, "/api/admin/waitlist", { headers: { cookie: `scopeci_admin=${forged}` } });
      check(forgedRes.status === 401, "A forged session cookie is refused");

      // Remove a signup, as a privacy removal request would.
      const doomedEmail = `remove-me-${Date.now()}@studio.agency`;
      await makeRequest(server, "/api/waitlist", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.61" },
        body: { email: doomedEmail },
      });
      const [doomed] = await db.select().from(waitlistSignupsTable).where(eq(waitlistSignupsTable.email, doomedEmail));
      check(doomed !== undefined, "Signup to remove exists");

      const anonDelete = await makeRequest(server, `/api/admin/waitlist/${doomed.id}`, { method: "DELETE" });
      check(anonDelete.status === 401, "Anonymous delete is refused");

      const deleteRes = await makeRequest(server, `/api/admin/waitlist/${doomed.id}`, { method: "DELETE", headers: { cookie } });
      check(deleteRes.status === 204, `Admin delete returns 204 (got ${deleteRes.status})`);
      const [gone] = await db.select().from(waitlistSignupsTable).where(eq(waitlistSignupsTable.email, doomedEmail));
      check(gone === undefined, "Signup is gone from the database");

      const againRes = await makeRequest(server, `/api/admin/waitlist/${doomed.id}`, { method: "DELETE", headers: { cookie } });
      check(againRes.status === 404, "Deleting it twice returns 404");

      const signOutRes = await makeRequest(server, "/api/admin/session", { method: "DELETE", headers: { cookie } });
      check(signOutRes.status === 204, "Sign out returns 204");
      check(/Max-Age=0/.test(signOutRes.headers["set-cookie"]?.[0] ?? ""), "Sign out expires the cookie");
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

    // -------------------------------------------------------------
    // Criterion 15: API errors are JSON, never Express HTML pages
    // -------------------------------------------------------------
    await testScenario("Criterion 15: Unknown API routes and malformed bodies answer in JSON", async () => {
      const missingRes = await makeRequest(server, "/api/does-not-exist");
      check(missingRes.status === 404, `Unknown API route returns 404 (got ${missingRes.status})`);
      check(missingRes.body?.error === "Not found.", "Unknown API route returns a JSON error");

      const malformedRes = await makeRequest(server, "/api/waitlist", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.70" },
        rawBody: "{not json",
      });
      check(malformedRes.status === 400, `Malformed JSON returns 400 (got ${malformedRes.status})`);
      check(typeof malformedRes.body?.error === "string", "Malformed JSON returns a JSON error");
      check(!malformedRes.text.includes("<pre>"), "No HTML stack trace in the response");
    });

    // -------------------------------------------------------------
    // Criterion 16: Rate limiter can't be dodged with X-Forwarded-For
    // -------------------------------------------------------------
    await testScenario("Criterion 16: A client-written X-Forwarded-For does not reset the rate limit", async () => {
      // A proxy appends the address it saw, so the client's own value sits on
      // the left. Rotating it per request must not earn a fresh allowance.
      const results = [];
      for (let i = 0; i < 12; i++) {
        results.push(
          await makeRequest(server, "/api/waitlist", {
            method: "POST",
            headers: { "x-forwarded-for": `10.0.${i}.1, 203.0.113.9` },
            body: { email: `spoof-${Date.now()}-${i}@test.com` },
          }),
        );
      }
      check(results.some((res) => res.status === 429), "Rotating the left-most X-Forwarded-For still hits 429");
    });

    // -------------------------------------------------------------
    // Criterion 17: Analytics only accepts events the site sends
    // -------------------------------------------------------------
    await testScenario("Criterion 17: /api/events rejects event names the site never sends", async () => {
      const knownRes = await makeRequest(server, "/api/events", { method: "POST", body: { event: "page_view" } });
      check(knownRes.status === 202, `Known event accepted (got ${knownRes.status})`);
      const unknownRes = await makeRequest(server, "/api/events", { method: "POST", body: { event: "x".repeat(70) } });
      check(unknownRes.status === 400, `Unknown event refused (got ${unknownRes.status})`);
    });

    // -------------------------------------------------------------
    // Criterion 18: Analytics rows stay small, and the table stays bounded
    // -------------------------------------------------------------
    await testScenario("Criterion 18: /api/events keeps short values, and a daily budget bounds the table", async () => {
      // The event is stored after the 202 goes out, so wait for its row.
      const storedEvent = async (source: string) => {
        for (let i = 0; i < 60; i++) {
          const [row] = await db.select().from(siteEventsTable).where(eq(siteEventsTable.source, source));
          if (row) return row;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`No site event with source ${source} was stored`);
      };
      const marker = `launch-ev-${Date.now()}`;
      const headers = { "x-forwarded-for": "198.51.100.80" };

      const padded = await makeRequest(server, "/api/events", {
        method: "POST",
        headers,
        body: {
          event: "page_view",
          source: marker,
          medium: "m".repeat(5000),
          campaign: "c".repeat(5000),
          referrer: `https://news.example/post/1?email=jane@agency.test&pad=${"x".repeat(3000)}#top`,
          landingPage: "/pricing",
        },
      });
      check(padded.status === 202, `Padded event accepted (got ${padded.status})`);
      const row = await storedEvent(marker);
      check(row.medium?.length === 100 && row.campaign?.length === 100, "Campaign tags are cut to 100 characters");
      check(row.referrer === "https://news.example/post/1", `Referrer keeps the page, not its query (got ${row.referrer})`);
      check(row.landingPage === "/pricing", "Landing page path is kept");

      const odd = await makeRequest(server, "/api/events", {
        method: "POST",
        headers,
        body: { event: "page_view", source: `${marker}-odd`, referrer: "javascript:alert(1)", landingPage: `//evil.example/${"x".repeat(3000)}` },
      });
      check(odd.status === 202, `Event with odd fields accepted (got ${odd.status})`);
      const oddRow = await storedEvent(`${marker}-odd`);
      check(oddRow.referrer === null, "A referrer that isn't an http(s) address is dropped");
      check(oddRow.landingPage === null, "A landing page that isn't a path on this site is dropped");

      // A new day deletes events past the retention window, then counts what
      // the day already holds, and stops at the limit.
      const [old] = await db
        .insert(siteEventsTable)
        .values({ event: "page_view", source: `${marker}-old`, createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) })
        .returning({ id: siteEventsTable.id });
      const startOfDay = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const [{ today }] = await db
        .select({ today: sql<number>`count(*)::int` })
        .from(siteEventsTable)
        .where(gte(siteEventsTable.createdAt, startOfDay));
      const room = dailyEventBudget(today + 2, 90);
      const answers = [await room(logger), await room(logger), await room(logger)];
      check(answers.join() === "true,true,false", `Budget allows today's remaining room, then refuses (got ${answers.join()})`);
      const [stillOld] = await db.select().from(siteEventsTable).where(eq(siteEventsTable.id, old.id));
      check(stillOld === undefined, "Events older than 90 days are deleted");
      const [kept] = await db.select().from(siteEventsTable).where(eq(siteEventsTable.source, marker));
      check(kept !== undefined, "Today's events are kept");

      await db.delete(siteEventsTable).where(like(siteEventsTable.source, `${marker}%`));
    });

    // -------------------------------------------------------------
    // Criterion 19: Waitlist attribution is trimmed, never refused
    // -------------------------------------------------------------
    await testScenario("Criterion 19: Waitlist keeps short campaign tags and the linking page without its query", async () => {
      const email = `attribution-${Date.now()}@studio.agency`;
      const res = await makeRequest(server, "/api/waitlist", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.81" },
        body: {
          email,
          utmCampaign: "c".repeat(800),
          utmTerm: "   ",
          referrer: `https://blog.example/post?ref=jane@agency.test&pad=${"x".repeat(3000)}`,
        },
      });
      check(res.status === 201, `Signup with long attribution is accepted (got ${res.status})`);
      const [row] = await db.select().from(waitlistSignupsTable).where(eq(waitlistSignupsTable.email, email));
      check(row?.utmCampaign?.length === 100, "utmCampaign is cut to 100 characters");
      check(row?.utmTerm === null, "A blank tag is stored as nothing");
      check(row?.referrer === "https://blog.example/post", `Referrer keeps the page, not its query (got ${row?.referrer})`);
      await db.delete(waitlistSignupsTable).where(eq(waitlistSignupsTable.email, email));
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
