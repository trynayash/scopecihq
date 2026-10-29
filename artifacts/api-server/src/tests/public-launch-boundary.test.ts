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
import { contactMessagesTable, db, pool, siteEventsTable, waitlistSignupsTable } from "@workspace/db";
import app from "../app.js";
import { logger } from "../lib/logger.js";
import { dailyEventBudget } from "../routes/events.js";
import { CONTACT_DAILY_LIMIT, purgeOldContactMessages } from "../routes/contact.js";
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

    // -------------------------------------------------------------
    // Contact form (POST /api/contact) and the admin inbox
    // -------------------------------------------------------------
    const contactMarker = `contact-${Date.now()}`;
    const contactRows = like(contactMessagesTable.email, `%${contactMarker}%`);
    const contactBody = (overrides: Record<string, unknown> = {}) => ({
      name: "Dana Agency",
      email: `dana+${contactMarker}@studio.agency`,
      topic: "general",
      message: "We run fixed-price projects and want to try ScopeCI.",
      ...overrides,
    });
    const sendContact = (ip: string, body: unknown) =>
      makeRequest(server, "/api/contact", { method: "POST", headers: { "x-forwarded-for": ip }, body });

    // -------------------------------------------------------------
    // Criterion 20: A contact message is stored with every field cleaned
    // -------------------------------------------------------------
    await testScenario("Criterion 20: A contact message is stored, every field trimmed and cleaned", async () => {
      const email = `jane.doe+${contactMarker}-a@studio.agency`;
      const res = await sendContact("192.0.2.10", {
        name: "  Jane\r\nDoe\u0000  ",
        email: `  Jane.Doe+${contactMarker}-A@Studio.Agency  `,
        company: "\t Harbor \u0007& Pine  ",
        topic: "pilot",
        message: "\r\n  Hello there\r\nSecond line\rThird line\u0000\u2028Fourth\tline  \n\n",
        website: "",
      });
      check(res.status === 201, `Contact message accepted with 201 (got ${res.status}: ${res.text})`);
      check(res.text === '{"ok":true}', `Answer is exactly { ok: true } (got ${res.text})`);

      const [row] = await db.select().from(contactMessagesTable).where(eq(contactMessagesTable.email, email));
      check(row !== undefined, "Message is stored, its email trimmed and lowercased");
      check(row?.name === "Jane Doe", `Line breaks and control characters in the name become one space (got ${JSON.stringify(row?.name)})`);
      check(row?.company === "Harbor & Pine", `Company is trimmed and cleaned (got ${JSON.stringify(row?.company)})`);
      check(row?.topic === "pilot", "Topic is stored");
      check(
        row?.message === "Hello there\nSecond line\nThird line\nFourth\tline",
        `Message keeps its lines as LF, drops other control characters and is trimmed (got ${JSON.stringify(row?.message)})`,
      );
      check(row?.createdAt instanceof Date && Math.abs(row.createdAt.getTime() - Date.now()) < 60_000, "createdAt is set by the database");

      // Limits apply after trimming, and an empty company is stored as none.
      const padded = await sendContact("192.0.2.10", contactBody({
        name: `   ${"n".repeat(120)}   `,
        email: `padded+${contactMarker}@studio.agency`,
        company: "   ",
        message: `   ${"m".repeat(10)}   `,
      }));
      check(padded.status === 201, `120-character name and 10-character message pass once trimmed (got ${padded.status}: ${padded.text})`);
      const [paddedRow] = await db
        .select()
        .from(contactMessagesTable)
        .where(eq(contactMessagesTable.email, `padded+${contactMarker}@studio.agency`));
      check(paddedRow?.name.length === 120 && paddedRow?.message === "m".repeat(10), "Trimmed name and message are stored");
      check(paddedRow?.company === null, "A blank company is stored as null");

      const noCompany = await sendContact("192.0.2.10", contactBody({ email: `nocompany+${contactMarker}@studio.agency`, company: null }));
      check(noCompany.status === 201, `A null company is accepted (got ${noCompany.status})`);

      // Only what the form asks for is kept: no IP address, user agent or cookie.
      const columns = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'contact_messages' ORDER BY column_name",
      );
      check(
        columns.rows.map((c) => c.column_name).join() === "company,created_at,email,id,message,name,topic",
        `contact_messages holds only the form's fields (got ${columns.rows.map((c) => c.column_name).join()})`,
      );
      await db.delete(contactMessagesTable).where(contactRows);
    });

    // -------------------------------------------------------------
    // Criterion 21: Each invalid field is refused with one sentence naming it
    // -------------------------------------------------------------
    await testScenario("Criterion 21: Each invalid contact field gets a 400 with one sentence naming it", async () => {
      const cases: Array<[string, unknown, string]> = [
        ["missing name", contactBody({ name: undefined }), "Enter your name."],
        ["blank name", contactBody({ name: " \r\n\t " }), "Enter your name."],
        ["name that isn't text", contactBody({ name: 42 }), "Enter your name."],
        ["121-character name", contactBody({ name: "n".repeat(121) }), "Your name can be up to 120 characters."],
        ["missing email", contactBody({ email: undefined }), "Enter your email address."],
        ["blank email", contactBody({ email: "   " }), "Enter your email address."],
        ["invalid email", contactBody({ email: "jane@" }), "Enter a valid email address."],
        ["email with a line break", contactBody({ email: "jane@studio.agency\r\nBcc: x@evil.test" }), "Enter a valid email address."],
        ["255-character email", contactBody({ email: `${"a".repeat(64)}@${"b".repeat(186)}.com` }), "Your email address can be up to 254 characters."],
        ["201-character company", contactBody({ company: "c".repeat(201) }), "Your company name can be up to 200 characters."],
        ["company that isn't text", contactBody({ company: 42 }), "Enter your company name as text, or leave it empty."],
        ["missing topic", contactBody({ topic: undefined }), "Choose a topic for your message."],
        ["unknown topic", contactBody({ topic: "sales" }), "Choose a topic for your message."],
        ["missing message", contactBody({ message: undefined }), "Write a message of at least 10 characters."],
        ["9 characters once trimmed", contactBody({ message: "   too short\r\n  " }), "Write a message of at least 10 characters."],
        ["5001-character message", contactBody({ message: "m".repeat(5001) }), "Your message can be up to 5000 characters."],
        ["several fields wrong", { email: "nope", message: "hi" }, "Enter your name."],
        ["an array, not an object", [1, 2], "Enter your name."],
      ];
      // All from one address: a refused message doesn't use up the limit.
      for (const [label, body, expected] of cases) {
        const res = await sendContact("192.0.2.20", body);
        check(res.status === 400, `${label}: 400 (got ${res.status})`);
        check(res.body?.error === expected, `${label}: "${expected}" (got ${JSON.stringify(res.body)})`);
      }
      const after = await sendContact("192.0.2.20", contactBody());
      check(after.status === 201, `A valid message from the same address is still accepted (got ${after.status})`);

      const stored = await db.select().from(contactMessagesTable).where(contactRows);
      check(stored.length === 1, `Only the valid message was stored (got ${stored.length})`);
      await db.delete(contactMessagesTable).where(contactRows);
    });

    // -------------------------------------------------------------
    // Criterion 22: The honeypot answers 201 and stores nothing
    // -------------------------------------------------------------
    await testScenario("Criterion 22: A filled honeypot gets 201 { ok: true } and nothing is stored", async () => {
      const bot = await sendContact("192.0.2.25", contactBody({ website: "https://cheap-seo.example" }));
      check(bot.status === 201, `Honeypot returns 201 (got ${bot.status})`);
      check(bot.text === '{"ok":true}', `Honeypot gets the same answer as a person (got ${bot.text})`);

      const sloppyBot = await sendContact("192.0.2.25", { website: "x", email: "nope" });
      check(sloppyBot.status === 201, `Honeypot wins over invalid fields (got ${sloppyBot.status})`);

      const stored = await db.select().from(contactMessagesTable).where(contactRows);
      check(stored.length === 0, `Nothing was stored (got ${stored.length})`);
    });

    // -------------------------------------------------------------
    // Criterion 23: Five messages per IP per 10 minutes
    // -------------------------------------------------------------
    await testScenario("Criterion 23: The sixth message from one IP within 10 minutes gets a 429", async () => {
      const results = [];
      for (let i = 0; i < 6; i++) {
        results.push(await sendContact("192.0.2.30", contactBody({ email: `burst${i}+${contactMarker}@studio.agency` })));
      }
      check(results.slice(0, 5).every((r) => r.status === 201), `The first five are accepted (got ${results.map((r) => r.status).join()})`);
      const limited = results[5];
      check(limited.status === 429, `The sixth gets 429 (got ${limited.status})`);
      check(limited.body?.error === "Too Many Requests", "429 body names the error, as the waitlist limiter's does");
      check(
        limited.body?.message === "Too many messages from this IP. Please wait 10 minutes and try again.",
        `429 says what to do (got ${limited.body?.message})`,
      );
      check(limited.body?.retryAfterSeconds === 600, `429 says when (got ${limited.body?.retryAfterSeconds})`);

      const stored = await db.select().from(contactMessagesTable).where(contactRows);
      check(stored.length === 5, `Five messages were stored (got ${stored.length})`);

      const other = await sendContact("192.0.2.31", contactBody());
      check(other.status === 201, `Another IP is not limited (got ${other.status})`);
      await db.delete(contactMessagesTable).where(contactRows);
    });

    // -------------------------------------------------------------
    // Criterion 24: At most 300 messages are stored per UTC day
    // -------------------------------------------------------------
    await testScenario("Criterion 24: Past 300 messages in a UTC day, the contact form answers 429", async () => {
      const startOfDay = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const filler = (i: number, createdAt: Date) => ({
        name: "Filler",
        email: `filler${i}+${contactMarker}@studio.agency`,
        topic: "general",
        message: "A message that fills the day.",
        createdAt,
      });

      // Yesterday's messages don't count against today.
      const yesterday = new Date(startOfDay.getTime() - 60 * 60 * 1000);
      await db.insert(contactMessagesTable).values(Array.from({ length: CONTACT_DAILY_LIMIT }, (_, i) => filler(i, yesterday)));
      const fresh = await sendContact("192.0.2.40", contactBody({ email: `fresh+${contactMarker}@studio.agency` }));
      check(fresh.status === 201, `300 messages yesterday don't stop one today (got ${fresh.status})`);

      const [{ today }] = await db
        .select({ today: sql<number>`count(*)::int` })
        .from(contactMessagesTable)
        .where(gte(contactMessagesTable.createdAt, startOfDay));
      const room = Math.max(0, CONTACT_DAILY_LIMIT - today);
      if (room > 0) {
        await db.insert(contactMessagesTable).values(Array.from({ length: room }, (_, i) => filler(1000 + i, new Date())));
      }

      const refused = await sendContact("192.0.2.41", contactBody({ email: `refused+${contactMarker}@studio.agency` }));
      check(refused.status === 429, `The 301st message today gets 429 (got ${refused.status})`);
      check(refused.body?.error === "Too Many Requests", "Same body shape as the per-IP limit");
      check(
        refused.body?.message === "Too many messages reached ScopeCI today. Please try again after midnight UTC.",
        `The sentence says when to try again (got ${refused.body?.message})`,
      );
      const wait = Number(refused.body?.retryAfterSeconds);
      check(wait > 0 && wait <= 24 * 60 * 60 && refused.headers["retry-after"] === String(wait), `Retry-After runs to 00:00 UTC (got ${wait})`);
      const [kept] = await db
        .select()
        .from(contactMessagesTable)
        .where(eq(contactMessagesTable.email, `refused+${contactMarker}@studio.agency`));
      check(kept === undefined, "The refused message was not stored");

      await db.delete(contactMessagesTable).where(contactRows);
      const again = await sendContact("192.0.2.41", contactBody());
      check(again.status === 201, `Below the cap again, messages are accepted (got ${again.status})`);
      await db.delete(contactMessagesTable).where(contactRows);
    });

    // -------------------------------------------------------------
    // Criterion 25: The admin inbox needs the admin session
    // -------------------------------------------------------------
    await testScenario("Criterion 25: Admin lists and deletes contact messages, and only with the admin session", async () => {
      const now = Date.now();
      const [newest, middle, oldest] = await db
        .insert(contactMessagesTable)
        .values([
          { name: "Newest", email: `newest+${contactMarker}@studio.agency`, company: "Harbor & Pine", topic: "privacy", message: "Line one\nLine two", createdAt: new Date(now - 1000) },
          { name: "Middle", email: `middle+${contactMarker}@studio.agency`, topic: "security", message: "A security question.", createdAt: new Date(now - 2000) },
          { name: "Oldest", email: `oldest+${contactMarker}@studio.agency`, topic: "legal", message: "A legal question.", createdAt: new Date(now - 3000) },
        ])
        .returning();
      // More than a page of older messages, to check the 500 cap.
      await db.insert(contactMessagesTable).values(
        Array.from({ length: 505 }, (_, i) => ({
          name: "Older",
          email: `older${i}+${contactMarker}@studio.agency`,
          topic: "general",
          message: "An older message.",
          createdAt: new Date(now - 60 * 60 * 1000 - i * 1000),
        })),
      );

      const anonList = await makeRequest(server, "/api/admin/contact");
      check(anonList.status === 401, `Anonymous list is refused (got ${anonList.status})`);
      const wrongKey = await makeRequest(server, "/api/admin/contact", {
        headers: { "x-admin-key": "not-the-key", "x-forwarded-for": "192.0.2.51" },
      });
      check(wrongKey.status === 401, `A wrong admin key is refused (got ${wrongKey.status})`);
      const anonDelete = await makeRequest(server, `/api/admin/contact/${newest.id}`, { method: "DELETE" });
      check(anonDelete.status === 401, `Anonymous delete is refused (got ${anonDelete.status})`);
      const forged = `${Date.now() + 60_000}.${"A".repeat(43)}`;
      const forgedList = await makeRequest(server, "/api/admin/contact", { headers: { cookie: `scopeci_admin=${forged}` } });
      check(forgedList.status === 401, "A forged session cookie is refused");

      const signInRes = await makeRequest(server, "/api/admin/session", {
        method: "POST",
        headers: { "x-forwarded-for": "192.0.2.50" },
        body: { key: testSecret },
      });
      const cookie = (signInRes.headers["set-cookie"]?.[0] ?? "").split(";")[0];
      check(signInRes.status === 204 && cookie.startsWith("scopeci_admin="), "Admin signs in");

      const list = await makeRequest(server, "/api/admin/contact", { headers: { cookie } });
      check(list.status === 200, `Admin lists messages (got ${list.status})`);
      check(String(list.headers["cache-control"]).includes("no-store"), "The list is not cacheable");
      const messages: Array<Record<string, unknown>> = list.body?.messages ?? [];
      check(messages.length === 500, `At most 500 messages are listed (got ${messages.length})`);
      const times = messages.map((m) => new Date(String(m.createdAt)).getTime());
      check(times.every((t, i) => i === 0 || times[i - 1] >= t), "Messages are newest first");
      const ours = messages.filter((m) => [newest.id, middle.id, oldest.id].includes(String(m.id))).map((m) => m.name);
      check(ours.join() === "Newest,Middle,Oldest", `Our three are in date order (got ${ours.join()})`);
      const first = messages.find((m) => m.id === newest.id);
      check(
        JSON.stringify(Object.keys(first ?? {}).sort()) === JSON.stringify(["company", "createdAt", "email", "id", "message", "name", "topic"]),
        `A message has exactly the contract's fields (got ${Object.keys(first ?? {}).join()})`,
      );
      check(first?.company === "Harbor & Pine" && first?.message === "Line one\nLine two" && first?.topic === "privacy", "Fields come back as stored");
      check(messages.find((m) => m.id === middle.id)?.company === null, "No company is null");
      check(first?.createdAt === newest.createdAt.toISOString(), "createdAt is an ISO date-time");

      const bearer = await makeRequest(server, "/api/admin/contact", { headers: { Authorization: `Bearer ${testSecret}` } });
      check(bearer.status === 200, `ADMIN_SECRET as a bearer token works, as for the waitlist (got ${bearer.status})`);

      const badId = await makeRequest(server, "/api/admin/contact/not-a-uuid", { method: "DELETE", headers: { cookie } });
      check(badId.status === 400 && badId.body?.error === "Invalid message id.", `A bad id gets 400 (got ${badId.status})`);

      const deleted = await makeRequest(server, `/api/admin/contact/${middle.id}`, { method: "DELETE", headers: { cookie } });
      check(deleted.status === 204, `Admin delete returns 204 (got ${deleted.status})`);
      const [gone] = await db.select().from(contactMessagesTable).where(eq(contactMessagesTable.id, middle.id));
      check(gone === undefined, "The message is gone from the database");
      const [stillThere] = await db.select().from(contactMessagesTable).where(eq(contactMessagesTable.id, newest.id));
      check(stillThere !== undefined, "Other messages are kept");

      const again = await makeRequest(server, `/api/admin/contact/${middle.id}`, { method: "DELETE", headers: { cookie } });
      check(again.status === 404 && again.body?.error === "No message with that id.", `Deleting it twice returns 404 (got ${again.status})`);

      const relisted = await makeRequest(server, "/api/admin/contact", { headers: { cookie } });
      check(!relisted.body?.messages?.some((m: { id: string }) => m.id === middle.id), "The list no longer has it");

      await db.delete(contactMessagesTable).where(contactRows);
    });

    // -------------------------------------------------------------
    // Criterion 26: Messages older than 365 days are purged
    // -------------------------------------------------------------
    await testScenario("Criterion 26: The hourly purge deletes contact messages older than 365 days, and only those", async () => {
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const row = (label: string, createdAt: Date) => ({
        name: label,
        email: `${label}+${contactMarker}@studio.agency`,
        topic: "general",
        message: "A message kept for the purge test.",
        createdAt,
      });
      await db.insert(contactMessagesTable).values([
        row("days366", daysAgo(366)),
        row("days400", daysAgo(400)),
        row("days1000", daysAgo(1000)),
        row("days364", daysAgo(364)),
        row("today", new Date()),
      ]);
      // A batch of two, so the three old ones take more than one batch.
      const deleted = await purgeOldContactMessages(2);
      check(deleted === 3, `Three old messages deleted (got ${deleted})`);
      const left = (await db.select({ name: contactMessagesTable.name }).from(contactMessagesTable).where(contactRows))
        .map((r) => r.name)
        .sort();
      check(left.join() === "days364,today", `Messages within 365 days are kept (got ${left.join()})`);
      check((await purgeOldContactMessages()) === 0, "A second run deletes nothing");
      await db.delete(contactMessagesTable).where(contactRows);
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
