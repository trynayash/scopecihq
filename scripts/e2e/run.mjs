// End-to-end run of the real app: a fresh database, the built server, a
// fake GitHub (fake-github.mjs) and a real browser walking the journey a
// pilot PM takes, plus the ways it can go wrong. Every console error, page
// error and 5xx answer along the way fails the run.
//
// Needs: Postgres reachable as $E2E_DATABASE_ADMIN_URL (a database the run
// can drop and recreate "scopeci_e2e" from), `pnpm run build` done, and
// Playwright with Chromium (`npx playwright install chromium`).
//
//   node scripts/e2e/run.mjs            # screenshots go to $E2E_OUT or a temp dir

import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startFakeGitHub } from "./fake-github.mjs";
import { journey } from "./journey.mjs";
import { errorJourney } from "./errors.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 8097);
const GH_PORT = Number(process.env.E2E_GITHUB_PORT ?? 8096);
const APP = `http://localhost:${APP_PORT}`;
const GITHUB = `http://localhost:${GH_PORT}`;
const WEBHOOK_SECRET = "e2e-webhook-secret";
const OUT = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "scopeci-e2e-"));
fs.mkdirSync(OUT, { recursive: true });

const adminUrl = process.env.E2E_DATABASE_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";
const dbUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = "/scopeci_e2e";
  return u.toString();
})();

function resetDatabase() {
  const psql = (sql) => execFileSync("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-qc", sql], { stdio: "pipe" });
  psql("DROP DATABASE IF EXISTS scopeci_e2e WITH (FORCE)");
  psql("CREATE DATABASE scopeci_e2e");
}

function startServer() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const env = {
    ...process.env,
    PORT: String(APP_PORT),
    NODE_ENV: "development",
    DATABASE_URL: dbUrl,
    APP_BASE_URL: APP,
    GITHUB_API_URL: GITHUB,
    GITHUB_WEB_URL: GITHUB,
    GITHUB_CLIENT_ID: "e2e-client",
    GITHUB_CLIENT_SECRET: "e2e-client-secret",
    GITHUB_APP_ID: "4242",
    GITHUB_APP_SLUG: "scopeci-e2e",
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
    GITHUB_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"),
    ADMIN_SECRET: "e2e-admin-secret-0123456789",
    LOG_LEVEL: "warn",
    // Sweep for missed webhooks every few seconds instead of every ten minutes.
    SCOPECI_SWEEP_MS: "4000",
  };
  const child = spawn("node", ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"], { cwd: ROOT, env });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  return { child, log };
}

async function waitFor(url, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} didn't come up`);
}

const results = [];
let server;
let github;
let browser;
let code = 0;
try {
  resetDatabase();
  github = await startFakeGitHub({ port: GH_PORT, appUrl: APP, webhookSecret: WEBHOOK_SECRET });
  server = startServer();
  await waitFor(`${APP}/api/healthz`);
  browser = await chromium.launch();
  await journey({ browser, app: APP, github: GITHUB, fake: github, out: OUT, results, serverLog: server.log });
  await errorJourney({ browser, app: APP, github: GITHUB, out: OUT, results });
} catch (err) {
  results.push({ ok: false, name: "run", detail: err?.stack ?? String(err) });
} finally {
  await browser?.close();
  server?.child.kill();
  github?.server.close();
}

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots: ${OUT}`);
if (failed) {
  code = 1;
  const errors = (server?.log ?? []).join("").split("\n").filter((l) => /"level":(50|60)/.test(l));
  if (errors.length) console.log(`\nServer errors:\n${errors.slice(0, 10).join("\n")}`);
}
process.exit(code);
