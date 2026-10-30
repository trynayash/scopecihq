import assert from "node:assert";
import crypto from "node:crypto";
import http from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  changeOrdersTable,
  commercialEvaluationsTable,
  githubCheckRunsTable,
  githubInstallationsTable,
  organizationInvitesTable,
  organizationMembersTable,
  prDiffAnalysesTable,
  projectsTable,
  pullRequestsTable,
  scopeBaselinesTable,
  appSettingsTable,
  usersTable,
  webhookDeliveriesTable,
} from "@workspace/db/schema";

/**
 * The signed-in product: GitHub sign-in, projects, saved scope, repository
 * linking, and a pull request travelling through the real GitHub App client
 * to a fake GitHub. Needs a database (DATABASE_URL).
 */

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

process.env.GITHUB_CLIENT_ID = "Iv1.test-client";
process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
process.env.GITHUB_APP_ID = "424242";
process.env.GITHUB_APP_SLUG = "scopeci-test";
process.env.APP_BASE_URL = "http://localhost:3000";

const { default: app } = await import("../app");
const { setGitHubFetch, setGitHubRetryPause } = await import("../github/github-http.js");
// Retries after a GitHub error happen at once here.
setGitHubRetryPause(() => Promise.resolve());
const { GitHubAppClient, createAppJwt } = await import("../github/app-client.js");
const { NoIssueProvider } = await import("../github/issue-provider.js");
const { WebhookService } = await import("../github/webhook-service.js");
const { setWebhookService } = await import("../routes/github.js");
const { COMMENT_MARKER } = await import("../github/comment-formatter.js");
const { forgetGitHubAppSettings } = await import("../github/app-settings.js");

/* ------------------------------------------------------------------ */
/* A fake GitHub                                                       */
/* ------------------------------------------------------------------ */

const API = "https://api.github.com";
const WEB = "https://github.com";

const fake = {
  users: {
    "user-token-1": { id: 5001, login: "dana", name: "Dana Agency", email: null, avatar_url: null },
    "user-token-2": { id: 5001, login: "dana", name: "Dana Agency", email: null, avatar_url: null },
    "other-token": { id: 6002, login: "eve", name: null, email: null, avatar_url: null },
  } as Record<string, object>,
  codes: { "dana-code": "user-token-1", "eve-code": "other-token" } as Record<string, string>,
  refreshWorks: true,
  installationsFor: {
    "user-token-1": [501],
    "user-token-2": [501],
    "other-token": [501],
  } as Record<string, number[]>,
  repos: {
    501: [
      { id: 7001, full_name: "harbor-agency/storefront", private: true },
      { id: 7002, full_name: "harbor-agency/marketing", private: false },
    ],
  } as Record<number, Array<{ id: number; full_name: string; private: boolean }>>,
  files: {
    "harbor-agency/storefront#12": [
      [{ filename: "src/loyalty/points.ts", status: "added", additions: 40, deletions: 0 }],
      [{ filename: "src/loyalty/rewards-page.tsx", status: "added", additions: 60, deletions: 0 }],
    ],
    "harbor-agency/marketing#3": [[{ filename: "pages/about.tsx", status: "modified", additions: 3, deletions: 1 }]],
  } as Record<string, Array<Array<object>>>,
  checkRuns: [] as Array<{ id: number; repo: string; body: any }>,
  // Open pull requests per repository, as GitHub would list them.
  open: {} as Record<string, any[]>,
  comments: {
    "harbor-agency/storefront#12": [
      // A person quoting the marker: ScopeCI must never edit this one.
      { id: 1, body: `Copied from the bot: ${COMMENT_MARKER}`, user: { login: "dana", type: "User" } },
    ],
  } as Record<string, Array<{ id: number; body: string; user: { login: string; type: string } }>>,
  jwtChecked: 0,
  conversions: 0,
  nextId: 100,
};

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function verifyAppJwt(auth: string | null): boolean {
  const token = auth?.replace(/^Bearer /, "") ?? "";
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return false;
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, "base64url"));
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  return ok && payload.iss === "424242" && payload.exp > Date.now() / 1000;
}

async function fakeGitHub(url: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const auth = headers.get("authorization");
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  const path = url.replace(API, "").replace(WEB, "");

  if (url === `${WEB}/login/oauth/access_token` && method === "POST") {
    if (body.grant_type === "refresh_token") {
      return fake.refreshWorks && body.refresh_token === "refresh-1"
        ? json({ access_token: "user-token-2", refresh_token: "refresh-1", expires_in: 28800 })
        : json({ error: "bad_refresh_token" });
    }
    const token = fake.codes[body.code];
    return token
      ? json({ access_token: token, refresh_token: "refresh-1", expires_in: 28800 })
      : json({ error: "bad_verification_code" });
  }

  if (path === "/app-manifests/manifest-code/conversions" && method === "POST") {
    fake.conversions++;
    return json(
      {
        id: 777,
        slug: "scopeci-made-here",
        name: "ScopeCI Made Here",
        owner: { login: "harbor-agency" },
        html_url: "https://github.com/organizations/harbor-agency/settings/apps/scopeci-made-here",
        client_id: "Iv1.stored-client",
        client_secret: "stored-client-secret",
        webhook_secret: "stored-webhook-secret",
        pem: PRIVATE_PEM,
      },
      201,
    );
  }

  const userToken = auth?.replace(/^Bearer /, "") ?? "";
  if (path === "/user") return fake.users[userToken] ? json(fake.users[userToken]) : json({}, 401);
  if (path === "/user/installations?per_page=100") {
    const ids = fake.installationsFor[userToken];
    if (!ids) return json({}, 401);
    return json({
      installations: ids.map((id) => ({
        id,
        account: { login: "harbor-agency", id: 9001, type: "Organization" },
        repository_selection: "selected",
        permissions: { pull_requests: "write", checks: "write", contents: "read" },
      })),
    });
  }
  const repoList = path.match(/^\/user\/installations\/(\d+)\/repositories\?per_page=100$/);
  if (repoList) {
    const id = Number(repoList[1]);
    if (!fake.installationsFor[userToken]?.includes(id)) return json({}, 404);
    return json({ repositories: fake.repos[id] ?? [] });
  }

  const tokenMatch = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
  if (tokenMatch && method === "POST") {
    if (!verifyAppJwt(auth)) return json({ message: "Bad JWT" }, 401);
    fake.jwtChecked++;
    return json({ token: `inst-${tokenMatch[1]}`, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
  }

  // Everything below needs an installation token.
  if (!auth?.startsWith("Bearer inst-")) return json({ message: "Requires installation token" }, 401);

  const files = path.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/files\?per_page=100(?:&page=(\d+))?$/);
  if (files) {
    const pages = fake.files[`${files[1]}/${files[2]}#${files[3]}`] ?? [[]];
    const page = Number(files[4] ?? 1);
    const link: Record<string, string> =
      page < pages.length ? { link: `<${API}${path.split("&page=")[0]}&page=${page + 1}>; rel="next"` } : {};
    return json(pages[page - 1] ?? [], 200, link);
  }

  const openList = path.match(/^\/repos\/([^/]+\/[^/]+)\/pulls\?state=open/);
  if (openList) return json((fake.open[openList[1]] ?? []).map((p) => ({ number: p.number, head: p.head })));
  const single = path.match(/^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/);
  if (single) {
    const pr = (fake.open[single[1]] ?? []).find((p) => p.number === Number(single[2]));
    return pr ? json(pr) : json({ message: "Not Found" }, 404);
  }

  const checkCreate = path.match(/^\/repos\/([^/]+\/[^/]+)\/check-runs$/);
  if (checkCreate && method === "POST") {
    const run = { id: fake.nextId++, repo: checkCreate[1], body };
    fake.checkRuns.push(run);
    return json({ id: run.id, head_sha: body.head_sha, status: body.status, conclusion: body.conclusion, html_url: "x" }, 201);
  }
  const checkUpdate = path.match(/^\/repos\/([^/]+\/[^/]+)\/check-runs\/(\d+)$/);
  if (checkUpdate && method === "PATCH") {
    const run = fake.checkRuns.find((r) => r.id === Number(checkUpdate[2]));
    if (!run) return json({}, 404);
    run.body = { ...run.body, ...body };
    return json({ id: run.id, head_sha: run.body.head_sha, status: run.body.status, conclusion: run.body.conclusion });
  }

  const commentList = path.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments(\?per_page=100)?$/);
  if (commentList) {
    const key = `${commentList[1]}#${commentList[2]}`;
    fake.comments[key] ??= [];
    if (method === "GET") return json(fake.comments[key]);
    const comment = { id: fake.nextId++, body: body.body, user: { login: "scopeci-test[bot]", type: "Bot" } };
    fake.comments[key].push(comment);
    return json(comment, 201);
  }
  const commentUpdate = path.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)$/);
  if (commentUpdate && method === "PATCH") {
    const comment = Object.values(fake.comments)
      .flat()
      .find((c) => c.id === Number(commentUpdate[2]));
    if (!comment) return json({}, 404);
    comment.body = body.body;
    return json(comment);
  }

  return json({ message: `Fake GitHub has no route for ${method} ${path}` }, 404);
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

async function scenario(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err: any) {
    failures.push(`${name}: ${err.message}`);
    console.error(`  ✗ FAIL: ${name}`, err);
  }
}

type Reply = { status: number; body: any; headers: http.IncomingHttpHeaders };

function call(
  server: http.Server,
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; origin?: string; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const payload = options.body === undefined ? "" : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? (payload ? "POST" : "GET"),
        headers: {
          "x-forwarded-for": "203.0.113.80",
          ...(options.cookie ? { cookie: options.cookie } : {}),
          ...(options.origin ? { origin: options.origin } : {}),
          ...options.headers,
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let body: any = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            // keep text
          }
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cookieFrom(reply: Reply, name: string): string | undefined {
  const all = reply.headers["set-cookie"] ?? [];
  const match = all.find((c) => c.startsWith(`${name}=`));
  return match?.split(";")[0];
}

async function signIn(server: http.Server, code: string): Promise<string> {
  const start = await call(server, "/api/auth/github?next=/app/projects");
  const state = new URL(String(start.headers.location)).searchParams.get("state")!;
  const stateCookie = cookieFrom(start, "scopeci_oauth")!;
  const done = await call(server, `/api/auth/github/callback?code=${code}&state=${state}`, { cookie: stateCookie });
  const session = cookieFrom(done, "scopeci_session");
  assert.ok(session && session.length > "scopeci_session=".length, "session cookie set");
  return session!;
}

const SCOPE = {
  title: "Statement of Work — Harbor & Pine Online Store",
  clauses: [
    {
      clauseRef: "§3.1",
      title: "Storefront and Checkout",
      included: ["product catalogue and search", "shopping cart", "stripe checkout"],
      excluded: ["loyalty points programme", "gift cards"],
    },
  ],
};

function prPayload(repo: { id: number; full_name: string }, number: number, sha: string, action = "opened", installation = 501) {
  const [owner, name] = repo.full_name.split("/");
  return {
    action,
    installation: { id: installation },
    repository: { id: repo.id, name, full_name: repo.full_name, owner: { login: owner } },
    pull_request: {
      id: repo.id * 1000 + number,
      number,
      title: number === 12 ? "Add loyalty points at checkout" : "Update about page",
      body: "",
      head: { ref: number === 12 ? "feat/loyalty-points" : "chore/about", sha },
      base: { ref: "main", sha: "0".repeat(40) },
      user: { login: "dev" },
      state: "open",
      draft: false,
      additions: 100,
      deletions: 0,
      changed_files: 2,
      commits: 1,
      html_url: `https://github.com/${repo.full_name}/pull/${number}`,
      created_at: new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

async function run() {
  console.log("\nScopeCI — signed-in product\n");
  setGitHubFetch(fakeGitHub);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const secret = "product-test-webhook-secret";
  const service = new WebhookService({
    webhookSecret: secret,
    gitHubClient: new GitHubAppClient({ appId: "424242", privateKey: PRIVATE_PEM, slug: "scopeci-test" }),
    issueProvider: new NoIssueProvider(),
  });
  // Re-checks the app triggers (after a change order is approved) go through the same fake GitHub.
  setWebhookService(service);
  async function deliver(payload: object, eventType = "pull_request") {
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
    const deliveryId = `del_${crypto.randomUUID()}`;
    const pre = await service.precheckAndPersistDelivery({ deliveryId, eventType, signature }, raw, payload);
    return pre.shouldProcess ? service.processPullRequestEvent(deliveryId, payload) : { status: pre.reason };
  }

  let dana = "";
  let eve = "";
  let projectId = "";
  let secondProjectId = "";

  try {
    await scenario("Without GitHub credentials, sign-in reports itself unavailable", async () => {
      const id = process.env.GITHUB_CLIENT_ID;
      delete process.env.GITHUB_CLIENT_ID;
      const session = await call(server, "/api/session");
      assert.strictEqual(session.body.signInAvailable, false);
      const start = await call(server, "/api/auth/github");
      assert.strictEqual(start.status, 302);
      assert.strictEqual(start.headers.location, "/app?signin=unavailable");
      process.env.GITHUB_CLIENT_ID = id;
    });

    await scenario("Sign-in sends the person to GitHub with a state bound to a cookie", async () => {
      const start = await call(server, "/api/auth/github?next=/app/projects");
      const location = new URL(String(start.headers.location));
      assert.strictEqual(location.origin + location.pathname, `${WEB}/login/oauth/authorize`);
      assert.strictEqual(location.searchParams.get("client_id"), "Iv1.test-client");
      assert.strictEqual(location.searchParams.get("redirect_uri"), "http://localhost:3000/api/auth/github/callback");
      assert.ok((location.searchParams.get("state") ?? "").length >= 32);
      assert.ok(String(start.headers["set-cookie"]).includes("HttpOnly"));
    });

    await scenario("A callback with the wrong state, a cancel or a bad code signs nobody in", async () => {
      const start = await call(server, "/api/auth/github");
      const stateCookie = cookieFrom(start, "scopeci_oauth")!;
      const wrong = await call(server, "/api/auth/github/callback?code=dana-code&state=forged", { cookie: stateCookie });
      assert.strictEqual(wrong.headers.location, "/app?signin=expired");
      assert.strictEqual(cookieFrom(wrong, "scopeci_session"), undefined);

      const state = new URL(String(start.headers.location)).searchParams.get("state");
      const noCookie = await call(server, `/api/auth/github/callback?code=dana-code&state=${state}`);
      assert.strictEqual(noCookie.headers.location, "/app?signin=expired");

      const cancelled = await call(server, `/api/auth/github/callback?error=access_denied&state=${state}`, { cookie: stateCookie });
      assert.strictEqual(cancelled.headers.location, "/app?signin=cancelled");

      const bad = await call(server, `/api/auth/github/callback?code=nope&state=${state}`, { cookie: stateCookie });
      assert.strictEqual(bad.headers.location, "/app?signin=failed");

      // Signing in from an invite link and failing comes back to the invite.
      const fromInvite = await call(server, "/api/auth/github?next=/app/invite/abc123");
      const inviteState = new URL(String(fromInvite.headers.location)).searchParams.get("state");
      const back = await call(server, `/api/auth/github/callback?error=access_denied&state=${inviteState}`, {
        cookie: cookieFrom(fromInvite, "scopeci_oauth")!,
      });
      assert.strictEqual(back.headers.location, "/app/invite/abc123?signin=cancelled");
    });

    await scenario("A good callback creates the person, their workspace and a session", async () => {
      dana = await signIn(server, "dana-code");
      const session = await call(server, "/api/session", { cookie: dana });
      assert.strictEqual(session.body.user.login, "dana");
      assert.strictEqual(session.body.organization.name, "Dana Agency");

      const user = await db.query.usersTable.findFirst({ where: eq(usersTable.githubUserId, "5001") });
      assert.ok(user, "user stored");
      assert.ok(!JSON.stringify(user!.githubTokenJson).includes("user-token-1"), "token stored encrypted");
    });

    await scenario("Signing in again reuses the same workspace", async () => {
      const again = await signIn(server, "dana-code");
      const user = await db.query.usersTable.findFirst({ where: eq(usersTable.githubUserId, "5001") });
      const memberships = await db.select().from(organizationMembersTable).where(eq(organizationMembersTable.userId, user!.id));
      assert.strictEqual(memberships.length, 1);
      const session = await call(server, "/api/session", { cookie: again });
      assert.strictEqual(session.body.user.login, "dana");
    });

    await scenario("Only a redirect back into the app is followed after sign-in", async () => {
      const start = await call(server, "/api/auth/github?next=https://evil.example/");
      const state = new URL(String(start.headers.location)).searchParams.get("state");
      const done = await call(server, `/api/auth/github/callback?code=dana-code&state=${state}`, {
        cookie: cookieFrom(start, "scopeci_oauth"),
      });
      assert.strictEqual(done.headers.location, "/app");
    });

    await scenario("Projects need a session, and writes must come from the app", async () => {
      assert.strictEqual((await call(server, "/api/projects")).status, 401);
      const foreign = await call(server, "/api/projects", { body: { name: "X" }, cookie: dana, origin: "https://evil.example" });
      assert.strictEqual(foreign.status, 403);
    });

    await scenario("A project is created, listed and read back", async () => {
      const created = await call(server, "/api/projects", {
        body: { name: "Harbor & Pine store", clientName: "Harbor & Pine", hourlyRate: 150 },
        cookie: dana,
        origin: "http://localhost:3000",
      });
      assert.strictEqual(created.status, 201);
      projectId = created.body.id;
      assert.strictEqual(created.body.policyMode, "OBSERVE");
      assert.strictEqual(created.body.scopeVersion, null);

      const list = await call(server, "/api/projects", { cookie: dana });
      assert.ok(list.body.projects.some((p: any) => p.id === projectId));
      const detail = await call(server, `/api/projects/${projectId}`, { cookie: dana });
      assert.strictEqual(detail.body.project.clientName, "Harbor & Pine");
      assert.strictEqual(detail.body.scope, null);
    });

    await scenario("Saving the scope twice makes v2 active and keeps v1", async () => {
      const empty = await call(server, `/api/projects/${projectId}/scope`, {
        method: "PUT",
        body: { title: "x", clauses: [{ clauseRef: "§1", title: "x", included: [], excluded: [] }] },
        cookie: dana,
      });
      assert.strictEqual(empty.status, 400);

      const first = await call(server, `/api/projects/${projectId}/scope`, { method: "PUT", body: SCOPE, cookie: dana });
      assert.strictEqual(first.status, 200);
      assert.strictEqual(first.body.version, "v1");
      const edited = { ...SCOPE, clauses: [{ ...SCOPE.clauses[0], excluded: [...SCOPE.clauses[0].excluded, "Wishlist "] }] };
      const second = await call(server, `/api/projects/${projectId}/scope`, { method: "PUT", body: edited, cookie: dana });
      assert.strictEqual(second.body.version, "v2");
      assert.deepStrictEqual(second.body.clauses[0].excluded, ["loyalty points programme", "gift cards", "wishlist"]);

      const project = await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) });
      const baselines = await db.select().from(scopeBaselinesTable).where(eq(scopeBaselinesTable.contractId, project!.contractId!));
      assert.deepStrictEqual(
        baselines.map((b) => `${b.versionNumber}:${b.status}`).sort(),
        ["v1:SUPERSEDED", "v2:ACTIVE"],
      );
      const detail = await call(server, `/api/projects/${projectId}`, { cookie: dana });
      assert.strictEqual(detail.body.project.scopeVersion, "v2");
      assert.strictEqual(detail.body.scope.clauses[0].clauseRef, "§3.1");
    });

    await scenario("A scope too big to check is refused; an item that grows when lower-cased is clamped", async () => {
      // A project of its own, so the shared one keeps the scope versions later scenarios expect.
      const scratch = await call(server, "/api/projects", { method: "POST", body: { name: "Scratch" }, cookie: dana });
      assert.strictEqual(scratch.status, 201, JSON.stringify(scratch.body));
      const scratchId = scratch.body.id ?? scratch.body.project?.id;
      // Each list holds up to 100 items, so 21 sections of 100 pass the schema but not the budget.
      const clauses = Array.from({ length: 21 }, (_, c) => ({
        clauseRef: `§${c + 1}`,
        title: `Part ${c + 1}`,
        included: Array.from({ length: 100 }, (_, i) => `item ${c}-${i}`),
        excluded: [],
      }));
      const huge = await call(server, `/api/projects/${scratchId}/scope`, { method: "PUT", body: { title: "Big", clauses }, cookie: dana });
      assert.strictEqual(huge.status, 400);
      assert.match(huge.body.error, /up to 2,000 items/);

      // "İ" lower-cases to two characters: 300 of them would store 600.
      const dotted = "İ".repeat(300);
      const grown = { ...SCOPE, clauses: [{ ...SCOPE.clauses[0], excluded: [...SCOPE.clauses[0].excluded, dotted] }] };
      const saved = await call(server, `/api/projects/${scratchId}/scope`, { method: "PUT", body: grown, cookie: dana });
      assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
      assert.ok(saved.body.clauses[0].excluded.every((item: string) => item.length <= 300));
      assert.strictEqual((await call(server, `/api/projects/${scratchId}`, { cookie: dana })).status, 200, "the project still reads back");

      assert.strictEqual((await call(server, `/api/projects/${scratchId}`, { method: "DELETE", cookie: dana })).status, 204);
    });

    await scenario("Project writes from a page showing another workspace are refused", async () => {
      const other = { "x-scopeci-workspace": "00000000-0000-4000-8000-000000000000" };
      const stale = await call(server, `/api/projects/${projectId}`, { method: "PATCH", body: { clientName: "Wrong" }, cookie: dana, headers: other });
      assert.strictEqual(stale.status, 409);
      assert.strictEqual(stale.body.error, "You switched workspace in another window. Reload this page to continue.");
      const created = await call(server, "/api/projects", { method: "POST", body: { name: "Stray" }, cookie: dana, headers: other });
      assert.strictEqual(created.status, 409, "a project isn't created in the workspace the page doesn't show");
      assert.strictEqual((await call(server, `/api/projects/${projectId}`, { cookie: dana, headers: other })).status, 200, "reading is never refused");
    });

    await scenario("Another workspace can't see or change the project", async () => {
      eve = await signIn(server, "eve-code");
      assert.strictEqual((await call(server, `/api/projects/${projectId}`, { cookie: eve })).status, 404);
      const patch = await call(server, `/api/projects/${projectId}`, { method: "PATCH", body: { name: "mine" }, cookie: eve });
      assert.strictEqual(patch.status, 404);
      assert.strictEqual((await call(server, "/api/projects/not-a-uuid", { cookie: eve })).status, 404);
    });

    await scenario("Repositories the person can see through the App are listed", async () => {
      const repos = await call(server, "/api/github/repositories", { cookie: dana });
      assert.strictEqual(repos.status, 200);
      assert.strictEqual(repos.body.installUrl, "https://github.com/apps/scopeci-test/installations/new");
      assert.deepStrictEqual(
        repos.body.repositories.map((r: any) => r.fullName),
        ["harbor-agency/storefront", "harbor-agency/marketing"],
      );
      assert.strictEqual(repos.body.repositories[0].linkedProjectId, null);
    });

    await scenario("Linking checks access with GitHub and maps the installation to the workspace", async () => {
      const notVisible = await call(server, `/api/projects/${projectId}/repository`, {
        method: "PUT",
        body: { installationId: 501, repositoryId: 99999 },
        cookie: dana,
      });
      assert.strictEqual(notVisible.status, 403);

      const linked = await call(server, `/api/projects/${projectId}/repository`, {
        method: "PUT",
        body: { installationId: 501, repositoryId: 7001 },
        cookie: dana,
      });
      assert.strictEqual(linked.status, 200, JSON.stringify(linked.body));
      assert.strictEqual(linked.body.repository.fullName, "harbor-agency/storefront");
      const install = await db.query.githubInstallationsTable.findFirst({
        where: eq(githubInstallationsTable.installationId, "501"),
      });
      const user = await db.query.usersTable.findFirst({ where: eq(usersTable.githubUserId, "5001") });
      const membership = await db.query.organizationMembersTable.findFirst({
        where: eq(organizationMembersTable.userId, user!.id),
      });
      assert.strictEqual(install?.organizationId, membership?.organizationId);
    });

    await scenario("The same GitHub account can't be claimed by a second workspace", async () => {
      const eveProject = await call(server, "/api/projects", { body: { name: "Eve's" }, cookie: eve });
      const claim = await call(server, `/api/projects/${eveProject.body.id}/repository`, {
        method: "PUT",
        body: { installationId: 501, repositoryId: 7002 },
        cookie: eve,
      });
      assert.strictEqual(claim.status, 409);
    });

    await scenario("A pull request building excluded work gets a check, a comment and a draft", async () => {
      const sha = "a".repeat(40);
      const result: any = await deliver(prPayload({ id: 7001, full_name: "harbor-agency/storefront" }, 12, sha));
      assert.strictEqual(result.status, "processed", JSON.stringify(result));
      assert.strictEqual(result.evaluationState, "CHANGE_REQUIRED");
      assert.ok(fake.jwtChecked >= 1, "installation token minted with a valid App JWT");

      const run = fake.checkRuns.find((r) => r.body.head_sha === sha);
      assert.ok(run, "check run created on the head commit");
      assert.strictEqual(run!.body.name, "scopeci / commercial");
      assert.strictEqual(run!.body.output.title, "ScopeCI: Change order needed");
      assert.strictEqual(run!.body.conclusion, "neutral");
      assert.strictEqual(run!.body.details_url, `http://localhost:3000/app/projects/${projectId}`);

      const comments = fake.comments["harbor-agency/storefront#12"];
      assert.strictEqual(comments.length, 2, "posted a new comment, left the person's alone");
      assert.ok(comments[0].body.startsWith("Copied from the bot"));
      assert.ok(comments[1].body.includes("### ScopeCI: Change order needed"));
      assert.ok(comments[1].body.includes("Open the change order draft in ScopeCI"));

      const prs = await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana });
      assert.strictEqual(prs.body.pullRequests.length, 1);
      const pr = prs.body.pullRequests[0];
      assert.strictEqual(pr.verdict, "CHANGE_REQUIRED");
      assert.strictEqual(pr.number, 12);
      assert.strictEqual(pr.changeOrder.subject, "Change request: loyalty points programme (Harbor & Pine Online Store)");
      assert.ok(pr.changeOrder.body.startsWith("Hi Harbor & Pine,"));
      assert.deepStrictEqual(
        pr.excluded.map((e: { item: string; clauseRef: string }) => [e.item, e.clauseRef]),
        [["Loyalty points programme", "§3.1"]],
        "names the excluded item with the clause that excludes it",
      );
      assert.strictEqual(pr.fileCount, 2, "counts both pages of changed files");
      assert.deepStrictEqual(
        pr.files.map((f: Record<string, unknown>) => Object.keys(f).sort()),
        [0, 1].map(() => ["additions", "deletions", "excludedItem", "path", "status"]),
        "files carry names and line counts only, never patches",
      );
      const points = pr.files.find((f: { path: string }) => f.path === "src/loyalty/points.ts");
      assert.deepStrictEqual(
        points,
        { path: "src/loyalty/points.ts", status: "added", additions: 40, deletions: 0, excludedItem: "Loyalty points programme" },
        "the file the check cited is tagged with the excluded item",
      );
      assert.strictEqual(pr.files[0].excludedItem, "Loyalty points programme", "cited files come first");

      const evaluation = await db.query.commercialEvaluationsTable.findFirst({
        where: eq(commercialEvaluationsTable.id, pr.evaluationId),
      });
      assert.strictEqual(evaluation?.headSha, sha);
    });

    await scenario("Both pages of changed files were read", async () => {
      const analysis = await db.query.prDiffAnalysesTable.findFirst({
        where: eq(prDiffAnalysesTable.headSha, "a".repeat(40)),
      });
      const paths = (analysis?.filesChangedJson as Array<{ path: string }>).map((f) => f.path);
      assert.deepStrictEqual(paths, ["src/loyalty/points.ts", "src/loyalty/rewards-page.tsx"]);
    });

    await scenario("A new push gets its own check run and the same comment is updated", async () => {
      const sha = "b".repeat(40);
      await deliver(prPayload({ id: 7001, full_name: "harbor-agency/storefront" }, 12, sha, "synchronize"));
      assert.strictEqual(fake.checkRuns.filter((r) => r.repo === "harbor-agency/storefront").length, 2);
      assert.strictEqual(fake.comments["harbor-agency/storefront#12"].length, 2, "no duplicate comment");
      const counts = (await call(server, "/api/projects", { cookie: dana })).body.projects.find((p: any) => p.id === projectId).counts;
      assert.deepStrictEqual(counts, {
        checked: 1,
        changeOrders: 1,
        decisions: 0,
        changeOrdersSent: 0,
        changeOrdersApproved: 0,
        approvedValue: 0,
      });
    });

    let evaluationId = "";
    await scenario("A flagged pull request's change order is priced and marked as sent", async () => {
      const prs = await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana });
      evaluationId = prs.body.pullRequests[0].evaluationId;
      assert.strictEqual(prs.body.pullRequests[0].trackedChangeOrder, null);

      const priced = await call(server, `/api/projects/${projectId}/change-order`, {
        method: "PUT",
        body: { evaluationId, hours: 16 },
        cookie: dana,
      });
      assert.strictEqual(priced.status, 200, JSON.stringify(priced.body));
      assert.strictEqual(priced.body.reference, "CO-1");
      assert.strictEqual(priced.body.status, "DRAFT");
      assert.strictEqual(priced.body.amount, 2400);
      assert.ok(priced.body.body.includes("$2,400 at our rate of $150 an hour"), priced.body.body);
      assert.deepStrictEqual(priced.body.items, ["Loyalty points programme"]);

      const sent = await call(server, `/api/projects/${projectId}/change-order`, {
        method: "PUT",
        body: { evaluationId, status: "SENT", body: "Hi Harbor & Pine, as discussed on the call…" },
        cookie: dana,
      });
      assert.strictEqual(sent.body.status, "SENT");
      assert.ok(sent.body.sentAt);
      assert.strictEqual(sent.body.body, "Hi Harbor & Pine, as discussed on the call…");
      assert.strictEqual(sent.body.amount, 2400, "editing the message keeps the price");

      const counts = (await call(server, `/api/projects/${projectId}`, { cookie: dana })).body.project.counts;
      assert.strictEqual(counts.changeOrdersSent, 1);
    });

    await scenario("A sent change order keeps the letter the client received; hours can still be recorded", async () => {
      const edit = await call(server, `/api/projects/${projectId}/change-order`, {
        method: "PUT",
        body: { evaluationId, body: "Something else entirely" },
        cookie: dana,
      });
      assert.strictEqual(edit.status, 409);
      const hours = await call(server, `/api/projects/${projectId}/change-order`, {
        method: "PUT",
        body: { evaluationId, hours: 20 },
        cookie: dana,
      });
      assert.strictEqual(hours.status, 200);
      assert.strictEqual(hours.body.body, "Hi Harbor & Pine, as discussed on the call…", "the letter isn't redrawn");
      assert.strictEqual(hours.body.amount, 3000);
      await call(server, `/api/projects/${projectId}/change-order`, { method: "PUT", body: { evaluationId, hours: 16 }, cookie: dana });
    });

    await scenario("Approving it covers the work, and the pull request is re-checked at once", async () => {
      const approved = await call(server, `/api/projects/${projectId}/change-order`, {
        method: "PUT",
        body: { evaluationId, status: "APPROVED" },
        cookie: dana,
      });
      assert.strictEqual(approved.body.status, "APPROVED");
      assert.ok(approved.body.decidedAt);

      const head = "b".repeat(40);
      let title = "";
      for (let i = 0; i < 40; i++) {
        title = fake.checkRuns.find((r) => r.body.head_sha === head)?.body.output?.title ?? "";
        if (title === "ScopeCI: Covered by an approved change") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.strictEqual(title, "ScopeCI: Covered by an approved change");
      assert.strictEqual(
        fake.checkRuns.filter((r) => r.body.head_sha === head).length,
        1,
        "the same commit's check run was updated, not duplicated",
      );

      const prs = await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana });
      assert.strictEqual(prs.body.pullRequests[0].verdict, "APPROVED_CHANGE");
      assert.strictEqual(prs.body.pullRequests[0].trackedChangeOrder.status, "APPROVED");
      assert.strictEqual(prs.body.pullRequests[0].changeOrder, null);
      assert.deepStrictEqual(prs.body.pullRequests[0].excluded, []);

      const counts = (await call(server, `/api/projects/${projectId}`, { cookie: dana })).body.project.counts;
      assert.strictEqual(counts.changeOrdersApproved, 1);
      assert.strictEqual(counts.approvedValue, 2400);
      assert.strictEqual(counts.changeOrdersSent, 0);
    });

    await scenario("A decided change order is locked, and other workspaces can't touch it", async () => {
      const prs = await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana });
      const latestId = prs.body.pullRequests[0].evaluationId;
      const again = await call(server, `/api/projects/${projectId}/change-order`, {
        method: "PUT",
        body: { evaluationId: latestId, status: "DECLINED" },
        cookie: dana,
      });
      assert.strictEqual(again.status, 409);
      const foreign = await call(server, `/api/projects/${projectId}/change-order`, {
        method: "PUT",
        body: { evaluationId: latestId, status: "DECLINED" },
        cookie: eve,
      });
      assert.strictEqual(foreign.status, 404);
      const unknown = await call(server, `/api/projects/${projectId}/change-order`, {
        method: "PUT",
        body: { evaluationId: crypto.randomUUID(), hours: 3 },
        cookie: dana,
      });
      assert.strictEqual(unknown.status, 404);
    });

    await scenario("Later pull requests building the approved work are covered too", async () => {
      const result: any = await deliver(prPayload({ id: 7001, full_name: "harbor-agency/storefront" }, 12, "f".repeat(40), "synchronize"));
      assert.strictEqual(result.evaluationState, "APPROVED_CHANGE");
    });

    const storefront = { id: 7001, full_name: "harbor-agency/storefront" };

    await scenario("Labels, assignees and review requests don't start a check", async () => {
      const before = fake.checkRuns.length;
      const result: any = await deliver(prPayload(storefront, 12, "f".repeat(40), "labeled"));
      assert.strictEqual(result.status, "ignored");
      assert.strictEqual(fake.checkRuns.length, before);
    });

    await scenario("Events for one pull request arriving together give one comment and one check run", async () => {
      fake.files["harbor-agency/storefront#17"] = [[{ filename: "src/cart/totals.ts", status: "modified", additions: 4, deletions: 1 }]];
      const sha = "1".repeat(40);
      const opened = prPayload(storefront, 17, sha);
      const results: any[] = await Promise.all([
        deliver(opened),
        deliver({ ...opened, action: "reopened" }),
        deliver({ ...opened, action: "review_requested" }),
      ]);
      assert.deepStrictEqual(results.map((r) => r.status), ["processed", "processed", "ignored"]);
      assert.strictEqual(fake.comments["harbor-agency/storefront#17"].length, 1, "one comment");
      assert.strictEqual(fake.checkRuns.filter((r) => r.body.head_sha === sha).length, 1, "one check run");
    });

    await scenario("The pull request's description is read, as on the demo", async () => {
      fake.files["harbor-agency/storefront#18"] = [[{ filename: "src/pages/footer.tsx", status: "modified", additions: 10, deletions: 2 }]];
      const payload = prPayload(storefront, 18, "2".repeat(40));
      payload.pull_request.title = "Footer tweaks";
      payload.pull_request.body = "Adds a gift cards page and links it from the footer.";
      const result: any = await deliver(payload);
      // Wording in a description alone is weaker evidence than a file path,
      // so it asks a person rather than call it out of scope; before, the
      // description wasn't read at all and this came back in scope.
      assert.strictEqual(result.evaluationState, "REVIEW_REQUIRED", JSON.stringify(result));
      const latest = await db.query.commercialEvaluationsTable.findFirst({
        where: eq(commercialEvaluationsTable.headSha, "2".repeat(40)),
      });
      assert.match(latest?.reason ?? "", /gift cards/i);
    });

    await scenario("A pull request with more files than GitHub lists says the rest weren't checked", async () => {
      const payload = prPayload(storefront, 17, "3".repeat(40), "synchronize");
      payload.pull_request.changed_files = 5000;
      await deliver(payload);
      const run = fake.checkRuns.find((r) => r.body.head_sha === "3".repeat(40));
      assert.ok(
        run?.body.output.summary.includes("GitHub listed 1 of this pull request's 5,000 changed files; the rest weren't checked."),
        run?.body.output.summary,
      );
      const comment = fake.comments["harbor-agency/storefront#17"][0].body;
      assert.ok(comment.includes("5,000 changed files") && comment.includes("| Scope version | v2 |"), comment);
    });

    await scenario("Re-check gives pull requests opened before the repository was connected a result", async () => {
      fake.files["harbor-agency/storefront#16"] = [[{ filename: "src/giftcards/redeem.ts", status: "added", additions: 30, deletions: 0 }]];
      const early = prPayload(storefront, 16, "4".repeat(40)).pull_request;
      fake.open["harbor-agency/storefront"] = [{ ...early, title: "Gift card redemption", head: { ref: "feat/gift-cards", sha: "4".repeat(40) } }];
      const started = await call(server, `/api/projects/${projectId}/recheck`, { method: "POST", cookie: dana });
      assert.strictEqual(started.status, 202, JSON.stringify(started.body));
      let found: any;
      for (let i = 0; i < 50 && !found; i++) {
        const list = await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana });
        found = list.body.pullRequests.find((p: any) => p.number === 16);
        if (!found) await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(found, "the early pull request has a result");
      assert.strictEqual(found.verdict, "CHANGE_REQUIRED");
      assert.strictEqual(found.scopeVersion, "v2");
      const foreign = await call(server, `/api/projects/${projectId}/recheck`, { method: "POST", cookie: eve });
      assert.strictEqual(foreign.status, 404);
    });

    await scenario("The sweep checks a pull request whose webhook never arrived, and only once", async () => {
      fake.files["harbor-agency/storefront#19"] = [[{ filename: "src/giftcards/apply.ts", status: "added", additions: 22, deletions: 0 }]];
      const lost = prPayload(storefront, 19, "5".repeat(40)).pull_request;
      fake.open["harbor-agency/storefront"] = [
        ...(fake.open["harbor-agency/storefront"] ?? []),
        { ...lost, title: "Apply gift cards at checkout", head: { ref: "feat/gift-card-apply", sha: "5".repeat(40) } },
      ];
      const first = await service.sweepMissedPullRequests();
      assert.strictEqual(first.checked, 1, "only the commit without a result");
      const list = await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana });
      assert.strictEqual(list.body.pullRequests.find((p: any) => p.number === 19)?.verdict, "CHANGE_REQUIRED");
      const again = await service.sweepMissedPullRequests();
      assert.strictEqual(again.checked, 0, "nothing left to check");
    });

    // GitHub failing part-way through a check, and a repository renamed on
    // GitHub. Faults are injected on the way to the fake GitHub.
    {
      const { githubCheckRunsTable, pullRequestsTable, linearWebhookDeliveriesTable } = await import("@workspace/db/schema");
      const { purgeExpiredDeliveries } = await import("../github/webhook-service.js");
      let fault: ((method: string, path: string, body: any) => Response | undefined) | null = null;
      setGitHubFetch(async (url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        return fault?.((init.method ?? "GET").toUpperCase(), url.replace(API, ""), body) ?? fakeGitHub(url, init);
      });
      const openBefore = [...(fake.open["harbor-agency/storefront"] ?? [])];
      const runsOn = (sha: string) => fake.checkRuns.filter((r) => r.body.head_sha === sha);
      const recordedOn = (sha: string) => db.select().from(githubCheckRunsTable).where(eq(githubCheckRunsTable.headSha, sha));
      const projectPr = async (number: number) =>
        (await db.query.pullRequestsTable.findFirst({
          where: and(eq(pullRequestsTable.projectId, projectId), eq(pullRequestsTable.number, number)),
        }))!;
      const openOnGitHub = (number: number, sha: string) =>
        fake.open["harbor-agency/storefront"].push({ ...prPayload(storefront, number, sha).pull_request });
      const giftCards = (file: string) => [[{ filename: file, status: "added", additions: 20, deletions: 0 }]];

      await scenario("A comment GitHub refuses after the verdict leaves the verdict showing, not a 'couldn't check' run", async () => {
        fake.files["harbor-agency/storefront#20"] = giftCards("src/giftcards/card-list.tsx");
        const sha = "a1".repeat(20);
        fault = (_method, path) =>
          path.startsWith("/repos/harbor-agency/storefront/issues/20/comments") ? json({ message: "Server Error" }, 502) : undefined;
        try {
          const result: any = await deliver(prPayload(storefront, 20, sha));
          assert.strictEqual(result.status, "error", JSON.stringify(result));
        } finally {
          fault = null;
        }
        const runs = runsOn(sha);
        assert.strictEqual(runs.length, 1, "no second run over the verdict");
        assert.strictEqual(runs[0].body.output.title, "ScopeCI: Change order needed");
        const [row] = await recordedOn(sha);
        assert.ok(row?.latestEvaluationId, "the verdict's run is recorded with its result");
      });

      await scenario("A commit that couldn't be checked gets one recorded run, which the sweep turns into the verdict", async () => {
        fake.files["harbor-agency/storefront#21"] = giftCards("src/giftcards/balance.ts");
        const sha = "b2".repeat(20);
        fault = (_method, path) => (path.startsWith("/repos/harbor-agency/storefront/pulls/21/files") ? json({ message: "Server Error" }, 500) : undefined);
        try {
          const result: any = await deliver(prPayload(storefront, 21, sha));
          assert.strictEqual(result.status, "error", JSON.stringify(result));
        } finally {
          fault = null;
        }
        let runs = runsOn(sha);
        assert.strictEqual(runs.length, 1);
        assert.strictEqual(runs[0].body.output.title, "ScopeCI couldn't check this commit");
        assert.strictEqual(runs[0].body.conclusion, "neutral");
        let [row] = await recordedOn(sha);
        assert.strictEqual(row?.githubCheckRunId, String(runs[0].id), "the 'couldn't check' run is recorded");
        assert.strictEqual(row?.latestEvaluationId, null, "with no result behind it");

        openOnGitHub(20, "a1".repeat(20));
        openOnGitHub(21, sha);
        const swept = await service.sweepMissedPullRequests();
        assert.strictEqual(swept.checked, 1, "only the commit without a verdict; #20's verdict is on GitHub");
        runs = runsOn(sha);
        assert.strictEqual(runs.length, 1, "the same run now shows the verdict");
        assert.strictEqual(runs[0].body.output.title, "ScopeCI: Change order needed");
        [row] = await recordedOn(sha);
        assert.ok(row?.latestEvaluationId);
      });

      await scenario("The sweep checks again a commit whose result was saved but whose check run never reached GitHub", async () => {
        fake.files["harbor-agency/storefront#22"] = giftCards("src/giftcards/gift-wrap.ts");
        const sha = "c2".repeat(20);
        // Creating any check run on this commit fails, the "couldn't check" one too.
        fault = (method, path, body) =>
          method === "POST" && path === "/repos/harbor-agency/storefront/check-runs" && body?.head_sha === sha
            ? json({ message: "Server Error" }, 502)
            : undefined;
        try {
          const result: any = await deliver(prPayload(storefront, 22, sha));
          assert.strictEqual(result.status, "error", JSON.stringify(result));
        } finally {
          fault = null;
        }
        const saved = await db.query.commercialEvaluationsTable.findFirst({ where: eq(commercialEvaluationsTable.headSha, sha) });
        assert.strictEqual(saved?.state, "CHANGE_REQUIRED", "the result was saved");
        assert.strictEqual(runsOn(sha).length, 0, "GitHub has nothing for the commit");

        openOnGitHub(22, sha);
        assert.strictEqual((await service.sweepMissedPullRequests()).checked, 1);
        const runs = runsOn(sha);
        assert.strictEqual(runs.length, 1);
        assert.strictEqual(runs[0].body.output.title, "ScopeCI: Change order needed");
        assert.strictEqual((await service.sweepMissedPullRequests()).checked, 0, "and only once");
      });

      await scenario("A check run this App can no longer edit is replaced by a new one, which later checks edit", async () => {
        const sha = "a1".repeat(20);
        const [before] = await recordedOn(sha);
        fault = (method, path) =>
          method === "PATCH" && path === `/repos/harbor-agency/storefront/check-runs/${before.githubCheckRunId}` ? json({ message: "Not Found" }, 404) : undefined;
        const pr20 = await projectPr(20);
        try {
          const result = await service.reevaluatePullRequest(pr20.id);
          assert.strictEqual(result.status, "processed", JSON.stringify(result));
        } finally {
          fault = null;
        }
        let runs = runsOn(sha);
        assert.strictEqual(runs.length, 2);
        assert.strictEqual(runs[1].body.output.title, "ScopeCI: Change order needed");
        const [after] = await recordedOn(sha);
        assert.strictEqual(after.githubCheckRunId, String(runs[1].id), "the new run is the one recorded");
        await service.reevaluatePullRequest(pr20.id);
        runs = runsOn(sha);
        assert.strictEqual(runs.length, 2, "the next check edits the new run");
      });

      await scenario("After the repository is renamed on GitHub, re-checks still reach its pull requests, old and new", async () => {
        const renamed = { id: 7001, full_name: "harbor-agency/shopfront" };
        fake.files["harbor-agency/shopfront#23"] = [[{ filename: "src/cart/coupon.ts", status: "added", additions: 12, deletions: 0 }]];
        fake.files["harbor-agency/shopfront#20"] = fake.files["harbor-agency/storefront#20"];
        const opened: any = await deliver(prPayload(renamed, 23, "c3".repeat(20)));
        assert.strictEqual(opened.status, "processed", JSON.stringify(opened));
        let project = await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) });
        assert.strictEqual(project?.repositoryFullName, "harbor-agency/shopfront", "the project follows the new name");
        assert.strictEqual((await projectPr(12)).url, "https://github.com/harbor-agency/shopfront/pull/12", "older links follow it too");

        const pr23 = await projectPr(23);
        assert.strictEqual((await service.reevaluatePullRequest(pr23.id)).status, "processed", "a pull request opened after the rename");
        assert.strictEqual((await service.reevaluatePullRequest((await projectPr(20)).id)).status, "processed", "and one checked before it");

        // And back, so the scenarios after these find the repository as they left it.
        fake.files["harbor-agency/storefront#23"] = fake.files["harbor-agency/shopfront#23"];
        const back: any = await deliver(prPayload(storefront, 23, "c4".repeat(20), "synchronize"));
        assert.strictEqual(back.status, "processed", JSON.stringify(back));
        project = await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) });
        assert.strictEqual(project?.repositoryFullName, "harbor-agency/storefront");
        assert.strictEqual((await projectPr(12)).url, "https://github.com/harbor-agency/storefront/pull/12");
        assert.strictEqual((await projectPr(23)).url, "https://github.com/harbor-agency/storefront/pull/23");
      });

      await scenario("Webhook deliveries past their 30 days are deleted, a batch at a time", async () => {
        const past = new Date(Date.now() - 24 * 3600_000);
        const future = new Date(Date.now() + 24 * 3600_000);
        const tag = crypto.randomUUID();
        await db.insert(webhookDeliveriesTable).values([
          ...[1, 2, 3].map((i) => ({ deliveryId: `old_${i}_${tag}`, eventType: "pull_request", status: "PROCESSED", expiresAt: past })),
          { deliveryId: `new_${tag}`, eventType: "pull_request", status: "PROCESSED", expiresAt: future },
        ]);
        await db.insert(linearWebhookDeliveriesTable).values([
          { deliveryId: `old_${tag}`, eventType: "Issue", status: "PROCESSED", expiresAt: past },
          { deliveryId: `new_${tag}`, eventType: "Issue", status: "PROCESSED", expiresAt: future },
        ]);
        const deleted = await purgeExpiredDeliveries(2);
        assert.ok(deleted >= 4, `deleted ${deleted}`);
        const github = await db.select({ id: webhookDeliveriesTable.deliveryId }).from(webhookDeliveriesTable);
        const linear = await db.select({ id: linearWebhookDeliveriesTable.deliveryId }).from(linearWebhookDeliveriesTable);
        assert.ok(!github.some((d) => d.id.startsWith("old_")) && github.some((d) => d.id === `new_${tag}`));
        assert.ok(!linear.some((d) => d.id.startsWith("old_")) && linear.some((d) => d.id === `new_${tag}`));
        assert.ok(github.length > 1, "the product's own deliveries, still within 30 days, are kept");
      });

      fake.open["harbor-agency/storefront"] = openBefore;
      setGitHubFetch(fakeGitHub);
    }

    await scenario("A PM accepts a pull request that needs a decision; it stays accepted on a push; withdrawing it brings the flag back", async () => {
      const sha = "2".repeat(40);
      const empty = await call(server, `/api/projects/${projectId}/pull-requests/18/acceptance`, {
        method: "PUT",
        body: { reason: "  " },
        cookie: dana,
      });
      assert.strictEqual(empty.status, 400);
      const accepted = await call(server, `/api/projects/${projectId}/pull-requests/18/acceptance`, {
        method: "PUT",
        body: { reason: "The client asked for the gift cards link on our call; no extra work." },
        cookie: dana,
      });
      assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
      assert.strictEqual(accepted.body.acceptedBy, "dana");
      assert.strictEqual(accepted.body.checkUpdated, true);
      const run = fake.checkRuns.filter((r) => r.body.head_sha === sha);
      assert.strictEqual(run.length, 1, "the same commit's check run is updated");
      assert.strictEqual(run[0].body.output.title, "ScopeCI: Accepted without a change order");
      assert.strictEqual(run[0].body.conclusion, "neutral", "report-only projects never pass or fail a check");
      let pr18 = (await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana })).body.pullRequests.find((p: any) => p.number === 18);
      assert.strictEqual(pr18.verdict, "OVERRIDDEN");
      assert.strictEqual(pr18.acceptance.acceptedBy, "dana");
      assert.match(pr18.reason, /Accepted without a change order by @dana/);

      const pushed = prPayload(storefront, 18, "6".repeat(40), "synchronize");
      pushed.pull_request.title = "Footer tweaks";
      pushed.pull_request.body = "Adds a gift cards page and links it from the footer.";
      const again: any = await deliver(pushed);
      assert.strictEqual(again.evaluationState, "OVERRIDDEN", "a new push stays accepted");

      const foreign = await call(server, `/api/projects/${projectId}/pull-requests/18/acceptance`, { method: "DELETE", cookie: eve });
      assert.strictEqual(foreign.status, 404);
      const withdrawn = await call(server, `/api/projects/${projectId}/pull-requests/18/acceptance`, { method: "DELETE", cookie: dana });
      assert.strictEqual(withdrawn.status, 200);
      assert.strictEqual(withdrawn.body.checkUpdated, true);
      pr18 = (await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana })).body.pullRequests.find((p: any) => p.number === 18);
      assert.strictEqual(pr18.verdict, "REVIEW_REQUIRED");
      assert.strictEqual(pr18.acceptance, null);
      const notFlagged = await call(server, `/api/projects/${projectId}/pull-requests/17/acceptance`, {
        method: "PUT",
        body: { reason: "fine" },
        cookie: dana,
      });
      assert.strictEqual(notFlagged.status, 409, "an in-scope pull request has nothing to accept");
    });

    await scenario("New excluded work after an approved change order gets a change order of its own", async () => {
      fake.files["harbor-agency/storefront#12"] = [
        [
          { filename: "src/loyalty/points.ts", status: "modified", additions: 4, deletions: 1 },
          { filename: "src/giftcards/redeem.ts", status: "added", additions: 50, deletions: 0 },
        ],
      ];
      const pushed = prPayload(storefront, 12, "7".repeat(40), "synchronize");
      pushed.pull_request.title = "Add loyalty points and gift cards at checkout";
      const result: any = await deliver(pushed);
      assert.strictEqual(result.evaluationState, "CHANGE_REQUIRED");
      const pr12 = (await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana })).body.pullRequests.find((p: any) => p.number === 12);
      assert.strictEqual(pr12.trackedChangeOrder, null, "the new work has no change order yet");
      assert.strictEqual(pr12.previousChangeOrder.reference, "CO-1");
      assert.strictEqual(pr12.previousChangeOrder.status, "APPROVED");
      const second = await call(server, `/api/projects/${projectId}/change-order`, {
        method: "PUT",
        body: { evaluationId: pr12.evaluationId, hours: 6 },
        cookie: dana,
      });
      assert.strictEqual(second.status, 200, JSON.stringify(second.body));
      assert.strictEqual(second.body.reference, "CO-2");
      assert.deepStrictEqual(second.body.items, ["Gift cards"]);
    });

    await scenario("Declined work is never raised again, and two people pricing at once get one change order", async () => {
      let pr12 = (await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana })).body.pullRequests.find((p: any) => p.number === 12);
      for (const status of ["SENT", "DECLINED"]) {
        const decided = await call(server, `/api/projects/${projectId}/change-order`, {
          method: "PUT",
          body: { evaluationId: pr12.evaluationId, status },
          cookie: dana,
        });
        assert.strictEqual(decided.status, 200, JSON.stringify(decided.body));
      }

      fake.files["harbor-agency/storefront#12"] = [
        [
          { filename: "src/loyalty/points.ts", status: "modified", additions: 4, deletions: 1 },
          { filename: "src/giftcards/redeem.ts", status: "added", additions: 50, deletions: 0 },
          { filename: "src/wishlist/list.tsx", status: "added", additions: 30, deletions: 0 },
        ],
      ];
      const pushed = prPayload(storefront, 12, "8".repeat(40), "synchronize");
      pushed.pull_request.title = "Add loyalty points, gift cards and a wishlist";
      const result: any = await deliver(pushed);
      assert.strictEqual(result.evaluationState, "CHANGE_REQUIRED");
      pr12 = (await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana })).body.pullRequests.find((p: any) => p.number === 12);
      assert.strictEqual(pr12.trackedChangeOrder, null);
      assert.strictEqual(pr12.previousChangeOrder.reference, "CO-2");
      assert.strictEqual(pr12.previousChangeOrder.status, "DECLINED");
      // The letter quotes the pull request's title; what it asks for is the subject and the list.
      assert.match(pr12.changeOrder.subject, /^Change request: wishlist \(/);
      assert.match(pr12.changeOrder.body, /^- Wishlist/m);
      assert.doesNotMatch(pr12.changeOrder.body, /^- Gift cards/m, "the suggested letter leaves out what the client declined");

      const price = () =>
        call(server, `/api/projects/${projectId}/change-order`, { method: "PUT", body: { evaluationId: pr12.evaluationId, hours: 3 }, cookie: dana });
      const [a, b] = await Promise.all([price(), price()]);
      assert.strictEqual(a.status, 200, JSON.stringify(a.body));
      assert.strictEqual(b.status, 200, JSON.stringify(b.body));
      assert.strictEqual(a.body.id, b.body.id, "one change order, not two");
      assert.strictEqual(a.body.reference, "CO-3");
      assert.deepStrictEqual(a.body.items, ["Wishlist"]);

      const again = prPayload(storefront, 12, "9".repeat(40), "synchronize");
      again.pull_request.title = "Add loyalty points, gift cards and a wishlist";
      await deliver(again);
      const orders = await db.select().from(changeOrdersTable).where(eq(changeOrdersTable.id, a.body.id));
      assert.deepStrictEqual(
        (orders[0].itemsJson as Array<{ item: string }>).map((i) => i.item),
        ["Wishlist"],
        "a later push doesn't add declined work to the draft",
      );
    });

    await scenario("A draft's letter follows new work even after a rename; a letter the PM edited is kept, also when hours are saved", async () => {
      const giftCards = { filename: "src/giftcards/balance.ts", status: "added", additions: 30, deletions: 0 };
      const wishlist = { filename: "src/wishlist/list.tsx", status: "added", additions: 30, deletions: 0 };
      let title = "Checkout polish";
      const push = async (sha: string, files: object[], action = "synchronize") => {
        fake.files["harbor-agency/storefront#21"] = [files];
        const payload = prPayload(storefront, 21, sha, action);
        payload.pull_request.title = title;
        const result: any = await deliver(payload);
        assert.strictEqual(result.evaluationState, "CHANGE_REQUIRED", JSON.stringify(result));
        const list = await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana });
        return list.body.pullRequests.find((p: any) => p.number === 21);
      };
      const update = (body: object) => call(server, `/api/projects/${projectId}/change-order`, { method: "PUT", body, cookie: dana });

      let pr21 = await push("a1".repeat(20), [giftCards], "opened");
      const priced = await update({ evaluationId: pr21.evaluationId, hours: 4 });
      assert.strictEqual(priced.status, 200, JSON.stringify(priced.body));
      assert.deepStrictEqual(priced.body.items, ["Gift cards"]);
      assert.ok(priced.body.body.includes("$600"), priced.body.body);

      // Renamed, then a push adds the wishlist: the letter nobody edited is
      // redrawn with both, at the same price. Before, the rename made it look
      // edited, so it kept naming gift cards alone.
      title = "Checkout polish, round two";
      pr21 = await push("a2".repeat(20), [giftCards, wishlist]);
      assert.deepStrictEqual([...pr21.trackedChangeOrder.items].sort(), ["Gift cards", "Wishlist"]);
      assert.match(pr21.trackedChangeOrder.subject, /wishlist/);
      assert.match(pr21.trackedChangeOrder.body, /^- Wishlist/m);
      assert.ok(pr21.trackedChangeOrder.body.includes('"Checkout polish, round two"'), pr21.trackedChangeOrder.body);
      assert.ok(pr21.trackedChangeOrder.body.includes("$600"), "the price stays");

      // The PM writes their own letter, then saves hours: the letter stays theirs.
      const own = { subject: "Gift cards and a wishlist", body: "Hi Harbor & Pine,\n\nAs agreed on Tuesday's call, here is the extra work." };
      assert.strictEqual((await update({ evaluationId: pr21.evaluationId, ...own })).status, 200);
      const hours = await update({ evaluationId: pr21.evaluationId, hours: 8 });
      assert.strictEqual(hours.status, 200, JSON.stringify(hours.body));
      assert.strictEqual(hours.body.subject, own.subject, "saving hours keeps the PM's letter");
      assert.strictEqual(hours.body.body, own.body);
      assert.strictEqual(hours.body.amount, 1200);

      // A push changes the items; the edited letter still isn't redrawn.
      pr21 = await push("a3".repeat(20), [giftCards]);
      assert.deepStrictEqual(pr21.trackedChangeOrder.items, ["Gift cards"]);
      assert.strictEqual(pr21.trackedChangeOrder.subject, own.subject);
      assert.strictEqual(pr21.trackedChangeOrder.body, own.body);

      // Nothing is sent with items the PM hasn't seen.
      const removed = await update({ evaluationId: pr21.evaluationId, status: "SENT", items: ["Gift cards", "Wishlist"] });
      assert.strictEqual(removed.status, 409, JSON.stringify(removed.body));
      assert.match(removed.body.error, /now lists Gift cards\. Review the letter/);
      pr21 = await push("a4".repeat(20), [giftCards, wishlist]);
      const added = await update({ evaluationId: pr21.evaluationId, status: "SENT", items: ["Gift cards"] });
      assert.strictEqual(added.status, 409, JSON.stringify(added.body));
      assert.match(added.body.error, /now also lists Wishlist\. Review the letter/);
      const [unsent] = await db.select().from(changeOrdersTable).where(eq(changeOrdersTable.id, priced.body.id));
      assert.strictEqual(unsent.status, "DRAFT", "it wasn't sent");
      const sent = await update({ evaluationId: pr21.evaluationId, status: "SENT", items: ["wishlist", "GIFT CARDS"] });
      assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
      assert.strictEqual(sent.body.status, "SENT");
      assert.strictEqual(sent.body.subject, own.subject);
    });

    await scenario("A change order is raised only from the pull request's latest result", async () => {
      const list = async () =>
        (await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana })).body.pullRequests.find((p: any) => p.number === 19);
      const before = await list();
      assert.strictEqual(before.trackedChangeOrder, null);
      fake.files["harbor-agency/storefront#19"] = [
        [
          { filename: "src/giftcards/apply.ts", status: "added", additions: 22, deletions: 0 },
          { filename: "src/wishlist/list.tsx", status: "added", additions: 12, deletions: 0 },
        ],
      ];
      const pushed = prPayload(storefront, 19, "b1".repeat(20), "synchronize");
      pushed.pull_request.title = "Apply gift cards at checkout";
      assert.strictEqual(((await deliver(pushed)) as any).evaluationState, "CHANGE_REQUIRED");

      // The page still shows the result from before the push.
      const price = (evaluationId: string) =>
        call(server, `/api/projects/${projectId}/change-order`, { method: "PUT", body: { evaluationId, hours: 2 }, cookie: dana });
      const stale = await price(before.evaluationId);
      assert.strictEqual(stale.status, 409, JSON.stringify(stale.body));
      assert.match(stale.body.error, /checked again since the page loaded\. Reload/);
      const after = await list();
      assert.strictEqual(after.trackedChangeOrder, null, "nothing was raised from the old result");
      const raised = await price(after.evaluationId);
      assert.strictEqual(raised.status, 200, JSON.stringify(raised.body));
      assert.deepStrictEqual([...raised.body.items].sort(), ["Gift cards", "Wishlist"], "the new work is on it");
      assert.strictEqual((await price(before.evaluationId)).status, 200, "an open change order stands whichever result the page showed");
    });

    const marketing = { id: 7002, full_name: "harbor-agency/marketing" };
    const admin = { id: 7003, full_name: "harbor-agency/admin" };
    let phaseOne = "";
    await scenario("Two pull requests with one number in a project: accepting and withdrawing act on the one shown", async () => {
      phaseOne = (
        await call(server, "/api/projects", { body: { name: "Harbor admin, phase one", clientName: "Harbor & Pine", hourlyRate: 100 }, cookie: dana })
      ).body.id;
      assert.strictEqual((await call(server, `/api/projects/${phaseOne}/scope`, { method: "PUT", body: SCOPE, cookie: dana })).status, 200);
      const link = (repositoryId: number) =>
        call(server, `/api/projects/${phaseOne}/repository`, { method: "PUT", body: { installationId: 501, repositoryId }, cookie: dana });
      assert.strictEqual((await link(marketing.id)).status, 200);
      fake.files["harbor-agency/marketing#5"] = [[{ filename: "src/giftcards/redeem.ts", status: "added", additions: 20, deletions: 0 }]];
      assert.strictEqual(((await deliver(prPayload(marketing, 5, "c1".repeat(20)))) as any).evaluationState, "CHANGE_REQUIRED");

      // The project moves to another repository, whose #5 is flagged too.
      assert.strictEqual((await call(server, `/api/projects/${phaseOne}/repository`, { method: "DELETE", cookie: dana })).status, 200);
      fake.repos[501].push({ id: admin.id, full_name: admin.full_name, private: true });
      assert.strictEqual((await link(admin.id)).status, 200);
      fake.files["harbor-agency/admin#5"] = [[{ filename: "src/loyalty/points.ts", status: "added", additions: 30, deletions: 0 }]];
      assert.strictEqual(((await deliver(prPayload(admin, 5, "c2".repeat(20)))) as any).evaluationState, "CHANGE_REQUIRED");

      const byRepo = async (repo: string) =>
        (await call(server, `/api/projects/${phaseOne}/pull-requests`, { cookie: dana })).body.pullRequests.find(
          (p: any) => p.number === 5 && p.url.includes(`/${repo}/pull/`),
        );
      let fromMarketing = await byRepo(marketing.full_name);
      let fromAdmin = await byRepo(admin.full_name);
      assert.ok(fromMarketing && fromAdmin, "both are listed");

      const accept = (number: number, evaluationId: string) =>
        call(server, `/api/projects/${phaseOne}/pull-requests/${number}/acceptance`, {
          method: "PUT",
          body: { reason: "Absorbed as goodwill", evaluationId },
          cookie: dana,
        });
      const accepted = await accept(5, fromMarketing.evaluationId);
      assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
      fromMarketing = await byRepo(marketing.full_name);
      fromAdmin = await byRepo(admin.full_name);
      assert.strictEqual(fromMarketing.acceptance?.acceptedBy, "dana", "the pull request shown is the one accepted");
      assert.strictEqual(fromAdmin.acceptance, null, "not the connected repository's #5");
      assert.strictEqual(fromAdmin.verdict, "CHANGE_REQUIRED");

      const withdraw = (evaluationId: string) =>
        call(server, `/api/projects/${phaseOne}/pull-requests/5/acceptance?evaluationId=${evaluationId}`, { method: "DELETE", cookie: dana });
      assert.strictEqual((await withdraw(fromAdmin.evaluationId)).status, 404, "that one isn't accepted");
      assert.strictEqual((await withdraw(fromMarketing.evaluationId)).status, 200);
      assert.strictEqual((await byRepo(marketing.full_name)).acceptance, null);
      assert.strictEqual((await withdraw("not-a-uuid")).status, 404);

      // A result that isn't the latest is refused, as is one from another
      // number or another project.
      await deliver(prPayload(admin, 5, "c3".repeat(20), "synchronize"));
      const outdated = await accept(5, fromAdmin.evaluationId);
      assert.strictEqual(outdated.status, 409, JSON.stringify(outdated.body));
      assert.match(outdated.body.error, /^The page is out of date/);
      fromAdmin = await byRepo(admin.full_name);
      assert.strictEqual((await accept(6, fromAdmin.evaluationId)).status, 404);
      const elsewhere = (await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana })).body.pullRequests[0];
      assert.strictEqual((await accept(elsewhere.number, elsewhere.evaluationId)).status, 404);
      assert.strictEqual(fromAdmin.acceptance, null);
    });

    await scenario("A repository moved to another project starts afresh there; the old project keeps its change orders and acceptances", async () => {
      const { pullRequestsTable, commercialEventsTable } = await import("@workspace/db/schema");
      const { acceptancesFor } = await import("../lib/acceptance.js");
      const adminFive = async (id: string) =>
        (await call(server, `/api/projects/${id}/pull-requests`, { cookie: dana })).body.pullRequests.find(
          (p: any) => p.number === 5 && p.url.includes(`/${admin.full_name}/pull/`),
        );

      // Phase one prices a change order for admin #5, then accepts it.
      const ours = await adminFive(phaseOne);
      const priced = await call(server, `/api/projects/${phaseOne}/change-order`, {
        method: "PUT",
        body: { evaluationId: ours.evaluationId, hours: 5 },
        cookie: dana,
      });
      assert.strictEqual(priced.status, 200, JSON.stringify(priced.body));
      const accepted = await call(server, `/api/projects/${phaseOne}/pull-requests/5/acceptance`, {
        method: "PUT",
        body: { reason: "Goodwill for phase one" },
        cookie: dana,
      });
      assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
      assert.strictEqual(accepted.body.checkUpdated, true);

      // Phase one is archived and phase two takes the repository; its open
      // pull requests are checked once the scope is confirmed.
      fake.open["harbor-agency/admin"] = [prPayload(admin, 5, "c3".repeat(20)).pull_request];
      assert.strictEqual((await call(server, `/api/projects/${phaseOne}`, { method: "DELETE", cookie: dana })).status, 204);
      const phaseTwo = (
        await call(server, "/api/projects", { body: { name: "Harbor admin, phase two", clientName: "Harbor & Pine", hourlyRate: 100 }, cookie: dana })
      ).body.id;
      const linked = await call(server, `/api/projects/${phaseTwo}/repository`, {
        method: "PUT",
        body: { installationId: 501, repositoryId: admin.id },
        cookie: dana,
      });
      assert.strictEqual(linked.status, 200, JSON.stringify(linked.body));
      assert.strictEqual((await call(server, `/api/projects/${phaseTwo}/scope`, { method: "PUT", body: SCOPE, cookie: dana })).status, 200);
      let theirs: any;
      for (let i = 0; i < 50 && !theirs; i++) {
        theirs = await adminFive(phaseTwo);
        if (!theirs) await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(theirs, "phase two checked the open pull request");
      assert.strictEqual(theirs.verdict, "CHANGE_REQUIRED", "phase one's acceptance doesn't carry over");
      assert.strictEqual(theirs.acceptance, null);
      assert.strictEqual(theirs.trackedChangeOrder, null, "nor its change order");
      assert.strictEqual(theirs.previousChangeOrder, null);

      // Phase two raises and approves its own change order, which clears its check.
      const own = await call(server, `/api/projects/${phaseTwo}/change-order`, {
        method: "PUT",
        body: { evaluationId: theirs.evaluationId, hours: 3 },
        cookie: dana,
      });
      assert.strictEqual(own.status, 200, JSON.stringify(own.body));
      assert.strictEqual(own.body.reference, "CO-1", "numbered in phase two's own contract");
      assert.notStrictEqual(own.body.id, priced.body.id);
      const approved = await call(server, `/api/projects/${phaseTwo}/change-order`, {
        method: "PUT",
        body: { evaluationId: theirs.evaluationId, status: "APPROVED" },
        cookie: dana,
      });
      assert.strictEqual(approved.status, 200, JSON.stringify(approved.body));
      let verdict = "";
      for (let i = 0; i < 50 && verdict !== "APPROVED_CHANGE"; i++) {
        verdict = (await adminFive(phaseTwo)).verdict;
        if (verdict !== "APPROVED_CHANGE") await new Promise((r) => setTimeout(r, 100));
      }
      assert.strictEqual(verdict, "APPROVED_CHANGE", "the approval in phase two covers the work there");

      // A re-check of phase two's commit that fails is reported on phase
      // two's own check run, never on phase one's row for the same pull request.
      {
        const { githubCheckRunsTable } = await import("@workspace/db/schema");
        const [twoRow] = await db
          .select()
          .from(pullRequestsTable)
          .where(and(eq(pullRequestsTable.externalId, `gh_pr_${admin.id * 1000 + 5}`), eq(pullRequestsTable.projectId, phaseTwo)));
        // Phase one checked the same commit before it was archived: its run stays as it was.
        const runsOnCommit = () => db.select().from(githubCheckRunsTable).where(eq(githubCheckRunsTable.headSha, "c3".repeat(20)));
        const othersOf = (rows: Awaited<ReturnType<typeof runsOnCommit>>) =>
          rows.filter((r) => r.pullRequestId !== twoRow.id).map((r) => `${r.id}:${r.latestEvaluationId}:${r.updatedAt.getTime()}`);
        const before = await runsOnCommit();
        setGitHubFetch(async (url, init) =>
          url.includes("/repos/harbor-agency/admin/pulls/5/files") ? json({ message: "Server Error" }, 500) : fakeGitHub(url, init),
        );
        try {
          const failed: any = await service.reevaluatePullRequest(twoRow.id);
          assert.strictEqual(failed.status, "error", JSON.stringify(failed));
        } finally {
          setGitHubFetch(fakeGitHub);
        }
        const after = await runsOnCommit();
        const mine = after.filter((r) => r.pullRequestId === twoRow.id);
        assert.strictEqual(mine.length, 1, "phase two's own run is updated, not a new one added");
        assert.strictEqual(mine[0].latestEvaluationId, null, "and says it couldn't check");
        assert.deepStrictEqual(othersOf(after), othersOf(before), "no other project's run changed");
      }

      // Restored, phase one still has its results, change order and acceptance.
      assert.strictEqual((await call(server, `/api/projects/${phaseOne}/restore`, { method: "POST", cookie: dana })).status, 200);
      const kept = await adminFive(phaseOne);
      assert.ok(kept, "phase one's results are still there");
      assert.strictEqual(kept.verdict, "OVERRIDDEN");
      assert.strictEqual(kept.acceptance?.reason, "Goodwill for phase one");
      assert.strictEqual(kept.trackedChangeOrder?.id, priced.body.id);
      assert.strictEqual(kept.trackedChangeOrder?.status, "DRAFT");

      // One row per project, and a decision applies only where it was made.
      const rows = await db.select().from(pullRequestsTable).where(eq(pullRequestsTable.externalId, `gh_pr_${admin.id * 1000 + 5}`));
      assert.deepStrictEqual(rows.map((r) => r.projectId).sort(), [phaseOne, phaseTwo].sort());
      const one = rows.find((r) => r.projectId === phaseOne)!;
      const two = rows.find((r) => r.projectId === phaseTwo)!;
      const danaOrg = one.organizationId;
      const eveOrg = (await call(server, "/api/session", { cookie: eve })).body.organization.id;
      assert.notStrictEqual(eveOrg, danaOrg);
      assert.ok((await acceptancesFor([one.id], { organizationId: danaOrg, projectId: phaseOne })).has(one.id));
      assert.ok(!(await acceptancesFor([one.id], { organizationId: danaOrg, projectId: phaseTwo })).has(one.id), "not in another project");
      assert.ok(!(await acceptancesFor([one.id], { organizationId: eveOrg, projectId: phaseOne })).has(one.id), "not in another workspace");

      // An acceptance recorded before decisions named their project counts
      // in its own workspace only.
      const [legacy] = await db
        .insert(commercialEventsTable)
        .values({
          organizationId: danaOrg,
          entityType: "PULL_REQUEST",
          entityId: two.id,
          eventType: "PR_ACCEPTED",
          actorType: "PM",
          actorId: "dana",
          metadataJson: { reason: "Recorded before projects were named", items: ["Loyalty points programme"] },
        })
        .returning();
      assert.strictEqual(
        (await acceptancesFor([two.id], { organizationId: danaOrg, projectId: phaseTwo })).get(two.id)?.reason,
        "Recorded before projects were named",
      );
      assert.ok(!(await acceptancesFor([two.id], { organizationId: eveOrg, projectId: phaseTwo })).has(two.id));
      await db.delete(commercialEventsTable).where(eq(commercialEventsTable.id, legacy.id));

      // Leave the workspace as the next scenarios expect it.
      assert.strictEqual((await call(server, `/api/projects/${phaseTwo}`, { method: "DELETE", cookie: dana })).status, 204);
      assert.strictEqual((await call(server, `/api/projects/${phaseOne}`, { method: "DELETE", cookie: dana })).status, 204);
      fake.repos[501] = fake.repos[501].filter((r) => r.id !== admin.id);
      delete fake.open["harbor-agency/admin"];
    });

    await scenario("An older pull request event arriving late changes nothing; a merged pull request stays merged", async () => {
      const { pullRequestsTable } = await import("@workspace/db/schema");
      fake.files["harbor-agency/storefront#23"] = [[{ filename: "src/cart/coupon.ts", status: "added", additions: 12, deletions: 0 }]];
      const event = (sha: string, action: string, updatedAt: string, title: string) => {
        const payload: any = prPayload(storefront, 23, sha, action);
        payload.pull_request.title = title;
        payload.pull_request.updated_at = updatedAt;
        return payload;
      };
      const row = async () =>
        (await db.select().from(pullRequestsTable).where(and(eq(pullRequestsTable.projectId, projectId), eq(pullRequestsTable.number, 23))))[0];
      const first = event("d1".repeat(20), "opened", "2026-10-01T10:00:00Z", "Cart coupons");
      const second = event("d2".repeat(20), "synchronize", "2026-10-01T11:00:00Z", "Cart coupons, tidied");

      // Two pushes delivered out of order: the older one, arriving second, is skipped.
      assert.strictEqual(((await deliver(second)) as any).status, "processed");
      const late: any = await deliver(first);
      assert.strictEqual(late.status, "ignored", JSON.stringify(late));
      const comment = () => fake.comments["harbor-agency/storefront#23"].at(-1)!.body;
      assert.ok(comment().includes("d2d2d2d") && !comment().includes("d1d1d1d"), "the comment stays on the newer commit");
      assert.strictEqual((await row()).title, "Cart coupons, tidied");

      // An old delivery sent again after the merge doesn't reopen it.
      const merged = event("d2".repeat(20), "closed", "2026-10-01T12:00:00Z", "Cart coupons, tidied");
      Object.assign(merged.pull_request, { state: "closed", merged: true, merged_at: "2026-10-01T12:00:00Z" });
      assert.strictEqual(((await deliver(merged)) as any).status, "processed");
      const redelivered: any = await deliver(first);
      assert.strictEqual(redelivered.status, "ignored", JSON.stringify(redelivered));
      assert.strictEqual((await row()).state, "MERGED");
      const listed = (await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana })).body.pullRequests.find(
        (p: any) => p.number === 23,
      );
      assert.strictEqual(listed.prState, "MERGED");
      assert.strictEqual(listed.headSha, "d2".repeat(20), "the latest result is still the newer commit's");
      const [delivery] = await db.select().from(webhookDeliveriesTable).where(eq(webhookDeliveriesTable.deliveryId, redelivered.deliveryId));
      assert.strictEqual(delivery?.status, "IGNORED");
      assert.strictEqual(delivery?.errorMessage, "Superseded by a newer pull request event");

      // A bulk re-check's list, read from GitHub before the merge, doesn't reopen it either.
      const snapshot = event("d2".repeat(20), "rechecked", "2026-10-01T11:00:00Z", "Cart coupons, tidied");
      assert.strictEqual(((await deliver(snapshot)) as any).status, "ignored");
      assert.strictEqual((await row()).state, "MERGED");

      // A newer event still applies.
      const reopened = event("d2".repeat(20), "reopened", "2026-10-01T13:00:00Z", "Cart coupons, tidied");
      assert.strictEqual(((await deliver(reopened)) as any).status, "processed");
      assert.strictEqual((await row()).state, "OPEN");
    });

    let eveWorkspace = "";
    let danaWorkspace = "";
    await scenario("An owner renames the workspace and invites someone with a single-use link", async () => {
      const renamed = await call(server, "/api/workspace", { method: "PATCH", body: { name: "Harbor Agency" }, cookie: dana });
      assert.strictEqual(renamed.status, 200);
      assert.strictEqual(renamed.body.name, "Harbor Agency");
      danaWorkspace = renamed.body.id;
      eveWorkspace = (await call(server, "/api/session", { cookie: eve })).body.organization.id;

      const invite = await call(server, "/api/workspace/invites", { method: "POST", cookie: dana });
      assert.strictEqual(invite.status, 201);
      assert.match(invite.body.url, /^http:\/\/localhost:3000\/app\/invite\/[A-Za-z0-9_-]{43}$/);
      const token = invite.body.url.split("/").pop();
      const stored = await db.query.organizationInvitesTable.findFirst({ where: eq(organizationInvitesTable.id, invite.body.id) });
      assert.notStrictEqual(stored?.tokenHash, token, "only a hash of the token is stored");

      const preview = await call(server, `/api/invites/${token}`, { cookie: eve });
      assert.strictEqual(preview.body.workspaceName, "Harbor Agency");
      assert.strictEqual(preview.body.invitedBy, "dana");
      assert.strictEqual(preview.body.alreadyMember, false);

      // Someone already in the workspace opening the link doesn't use it up.
      const member = await call(server, `/api/invites/${token}/accept`, { method: "POST", cookie: dana });
      assert.strictEqual(member.status, 200);
      assert.strictEqual(member.body.role, "OWNER");

      const joined = await call(server, `/api/invites/${token}/accept`, { method: "POST", cookie: eve });
      assert.strictEqual(joined.status, 200);
      assert.deepStrictEqual(joined.body, { id: danaWorkspace, name: "Harbor Agency", role: "MEMBER" });

      const session = await call(server, "/api/session", { cookie: eve });
      assert.strictEqual(session.body.organization.id, danaWorkspace, "joining switches to the workspace");
      assert.strictEqual(session.body.workspaces.length, 2);
      const projects = await call(server, "/api/projects", { cookie: eve });
      assert.ok(projects.body.projects.some((p: any) => p.id === projectId), "the new member sees the team's projects");

      const used = await call(server, `/api/invites/${token}`, { cookie: eve });
      assert.strictEqual(used.status, 404, "a used link stops working");
    });

    await scenario("Only owners manage the team; members can switch between their workspaces", async () => {
      assert.strictEqual((await call(server, "/api/workspace/invites", { method: "POST", cookie: eve })).status, 403);
      assert.strictEqual(
        (await call(server, "/api/workspace", { method: "PATCH", body: { name: "Mine now" }, cookie: eve })).status,
        403,
      );
      const team = await call(server, "/api/workspace", { cookie: eve });
      assert.deepStrictEqual(
        team.body.members.map((m: any) => `${m.login}:${m.role}:${m.you}`),
        ["dana:OWNER:false", "eve:MEMBER:true"],
      );
      assert.deepStrictEqual(team.body.invites, [], "members don't see invites");

      const back = await call(server, "/api/session/workspace", { method: "PUT", body: { organizationId: eveWorkspace }, cookie: eve });
      assert.strictEqual(back.status, 200);
      assert.ok(!(await call(server, "/api/projects", { cookie: eve })).body.projects.some((p: any) => p.id === projectId));
      const notMine = await call(server, "/api/session/workspace", {
        method: "PUT",
        body: { organizationId: crypto.randomUUID() },
        cookie: eve,
      });
      assert.strictEqual(notMine.status, 404);
      await call(server, "/api/session/workspace", { method: "PUT", body: { organizationId: danaWorkspace }, cookie: eve });
    });

    await scenario("A new sign-in opens the workspace chosen last, not the personal one", async () => {
      const again = await signIn(server, "eve-code");
      const session = await call(server, "/api/session", { cookie: again });
      assert.strictEqual(session.body.organization.id, danaWorkspace);
    });

    await scenario("Owners change roles; the last owner can't step down", async () => {
      const team = await call(server, "/api/workspace", { cookie: dana });
      const eveId = team.body.members.find((m: any) => m.login === "eve").userId;
      const danaId = team.body.members.find((m: any) => m.login === "dana").userId;
      assert.strictEqual((await call(server, `/api/workspace/members/${danaId}`, { method: "PATCH", body: { role: "MEMBER" }, cookie: dana })).status, 409);
      assert.strictEqual((await call(server, `/api/workspace/members/${danaId}`, { method: "PATCH", body: { role: "MEMBER" }, cookie: eve })).status, 403);
      const promoted = await call(server, `/api/workspace/members/${eveId}`, { method: "PATCH", body: { role: "OWNER" }, cookie: dana });
      assert.strictEqual(promoted.status, 200, JSON.stringify(promoted.body));
      assert.strictEqual(promoted.body.role, "OWNER");
      assert.strictEqual((await call(server, "/api/workspace/invites", { method: "POST", cookie: eve })).status, 201, "a new owner can invite");
      assert.strictEqual((await call(server, `/api/workspace/members/${eveId}`, { method: "PATCH", body: { role: "BOSS" }, cookie: dana })).status, 400);
      const back = await call(server, `/api/workspace/members/${eveId}`, { method: "PATCH", body: { role: "MEMBER" }, cookie: dana });
      assert.strictEqual(back.body.role, "MEMBER");

      // Two owners demoting each other at once: one wins, the other is told
      // the workspace needs an owner.
      await call(server, `/api/workspace/members/${eveId}`, { method: "PATCH", body: { role: "OWNER" }, cookie: dana });
      const [first, second] = await Promise.all([
        call(server, `/api/workspace/members/${eveId}`, { method: "PATCH", body: { role: "MEMBER" }, cookie: dana }),
        call(server, `/api/workspace/members/${danaId}`, { method: "PATCH", body: { role: "MEMBER" }, cookie: eve }),
      ]);
      assert.deepStrictEqual([first.status, second.status].sort(), [200, 409]);
      const owners = (await call(server, "/api/workspace", { cookie: dana })).body.members.filter((m: any) => m.role === "OWNER");
      assert.strictEqual(owners.length, 1, "exactly one owner is left");
      if (second.status === 200) {
        await call(server, `/api/workspace/members/${danaId}`, { method: "PATCH", body: { role: "OWNER" }, cookie: eve });
        await call(server, `/api/workspace/members/${eveId}`, { method: "PATCH", body: { role: "MEMBER" }, cookie: dana });
      }
    });

    await scenario("Removing a member cuts their access; the last owner can't be removed", async () => {
      const team = await call(server, "/api/workspace", { cookie: dana });
      const eveId = team.body.members.find((m: any) => m.login === "eve").userId;
      const danaId = team.body.members.find((m: any) => m.login === "dana").userId;
      assert.strictEqual((await call(server, `/api/workspace/members/${danaId}`, { method: "DELETE", cookie: dana })).status, 409);
      assert.strictEqual((await call(server, `/api/workspace/members/${eveId}`, { method: "DELETE", cookie: dana })).status, 204);

      assert.strictEqual((await call(server, `/api/projects/${projectId}`, { cookie: eve })).status, 404);
      const session = await call(server, "/api/session", { cookie: eve });
      assert.strictEqual(session.body.organization.id, eveWorkspace, "falls back to their own workspace");
    });

    await scenario("Anyone can leave a workspace, but not their only one", async () => {
      const invite = await call(server, "/api/workspace/invites", { method: "POST", cookie: dana });
      const token = invite.body.url.split("/").pop();
      assert.strictEqual((await call(server, `/api/invites/${token}/accept`, { method: "POST", cookie: eve })).status, 200);
      const me = (await call(server, "/api/session", { cookie: eve })).body.user;
      const eveId = (await call(server, "/api/workspace", { cookie: eve })).body.members.find((m: any) => m.you).userId;
      assert.ok(me);
      const left = await call(server, `/api/workspace/members/${eveId}`, { method: "DELETE", cookie: eve });
      assert.strictEqual(left.status, 204, "a member leaves without an owner's help");
      const now = await call(server, "/api/session", { cookie: eve });
      assert.strictEqual(now.body.organization.id, eveWorkspace);
      const only = await call(server, `/api/workspace/members/${eveId}`, { method: "DELETE", cookie: eve });
      assert.strictEqual(only.status, 409, "their own, only workspace stays");
    });

    /* Accounts: removal, sign-in, stale pages, limits and failures (audit fixes). */

    // Two more people, signing in from their own address so the shared sign-in
    // limit the earlier scenarios use is left alone.
    fake.users["frank-token"] = { id: 7003, login: "frank", name: "Frank Founder", email: null, avatar_url: null };
    fake.codes["frank-code"] = "frank-token";
    fake.users["gus-token"] = { id: 7004, login: "gus", name: null, email: null, avatar_url: null };
    fake.codes["gus-code"] = "gus-token";
    const accountsIp = { "x-forwarded-for": "203.0.113.90" };
    // Every call here comes from that address too, so these scenarios don't use
    // up the invite and project limits the scenarios around them rely on.
    const at = (path: string, options: Parameters<typeof call>[2] = {}) =>
      call(server, path, { ...options, headers: { ...accountsIp, ...options.headers } });
    const signInAs = async (code: string) => {
      const start = await at("/api/auth/github?next=/app");
      const state = new URL(String(start.headers.location)).searchParams.get("state");
      const done = await at(`/api/auth/github/callback?code=${code}&state=${state}`, {
        cookie: cookieFrom(start, "scopeci_oauth"),
      });
      const session = cookieFrom(done, "scopeci_session");
      assert.ok(session, `${code} signs in (went to ${done.headers.location})`);
      return session!;
    };
    let frank = "";
    let gus = "";
    let studio = "";
    let gusHome = "";
    let frankId = "";
    let gusId = "";

    await scenario("Someone removed from their only workspace gets a new one, and signing in again never puts them back", async () => {
      frank = await signInAs("frank-code");
      const home = (await at("/api/session", { cookie: frank })).body.organization;
      assert.deepStrictEqual([home.name, home.role], ["Frank Founder", "OWNER"]);
      studio = home.id;
      await at("/api/workspace", { method: "PATCH", body: { name: "Frank Studio" }, cookie: frank });
      const clientProject = await at("/api/projects", { body: { name: "Frank's client" }, cookie: frank });
      assert.strictEqual(clientProject.status, 201);

      gus = await signInAs("gus-code");
      gusHome = (await at("/api/session", { cookie: gus })).body.organization.id;
      const invite = await at("/api/workspace/invites", { method: "POST", cookie: frank });
      assert.strictEqual((await at(`/api/invites/${invite.body.url.split("/").pop()}/accept`, { method: "POST", cookie: gus })).status, 200);
      const team = (await at("/api/workspace", { cookie: frank })).body.members;
      frankId = team.find((m: any) => m.login === "frank").userId;
      gusId = team.find((m: any) => m.login === "gus").userId;
      const member = (id: string, role: string, cookie: string) =>
        at(`/api/workspace/members/${id}`, { method: "PATCH", body: { role }, cookie });
      assert.strictEqual((await member(gusId, "OWNER", frank)).status, 200);
      // The creator is made a member, then removed by the owner who is left.
      assert.strictEqual((await member(frankId, "MEMBER", gus)).status, 200);
      assert.strictEqual((await at(`/api/workspace/members/${frankId}`, { method: "DELETE", cookie: gus })).status, 204);

      const after = (await at("/api/session", { cookie: frank })).body;
      assert.ok(after.user, "still signed in, not shown as signed out");
      assert.notStrictEqual(after.organization.id, studio);
      assert.deepStrictEqual([after.organization.name, after.organization.role], ["Frank Founder", "OWNER"]);
      assert.deepStrictEqual(after.workspaces.map((w: any) => w.id), [after.organization.id]);
      const projects = (await at("/api/projects", { cookie: frank })).body.projects;
      assert.ok(!projects.some((p: any) => p.id === clientProject.body.id), "the studio's projects are out of reach");

      const again = (await at("/api/session", { cookie: await signInAs("frank-code") })).body;
      assert.strictEqual(again.organization.id, after.organization.id);
      assert.ok(!again.workspaces.some((w: any) => w.id === studio), "signing in again doesn't rejoin the studio");

      // Someone an earlier removal left with no workspace at all gets a new one,
      // never the workspace that still has their gh-<id> slug.
      await db.delete(organizationMembersTable).where(eq(organizationMembersTable.userId, frankId));
      frank = await signInAs("frank-code");
      const fresh = (await at("/api/session", { cookie: frank })).body;
      assert.strictEqual(fresh.organization.role, "OWNER");
      assert.ok(![studio, after.organization.id].includes(fresh.organization.id), "a new workspace");
      assert.strictEqual(fresh.workspaces.length, 1);
      const studioTeam = (await at("/api/workspace", { cookie: gus })).body.members;
      assert.deepStrictEqual(studioTeam.map((m: any) => `${m.login}:${m.role}`), ["gus:OWNER"]);
    });

    await scenario("Removing an owner, or making them a member, cancels the invite links they made", async () => {
      const rejoin = await at("/api/workspace/invites", { method: "POST", cookie: gus });
      assert.strictEqual((await at(`/api/invites/${rejoin.body.url.split("/").pop()}/accept`, { method: "POST", cookie: frank })).status, 200);
      const role = (r: string) => at(`/api/workspace/members/${frankId}`, { method: "PATCH", body: { role: r }, cookie: gus });
      const tokenOf = (reply: Reply) => reply.body.url.split("/").pop();
      assert.strictEqual((await role("OWNER")).status, 200);

      const kept = tokenOf(await at("/api/workspace/invites", { method: "POST", cookie: frank }));
      const gusLink = await at("/api/workspace/invites", { method: "POST", cookie: gus });
      assert.strictEqual((await role("MEMBER")).status, 200);
      assert.strictEqual((await at(`/api/invites/${kept}`, { cookie: frank })).status, 404, "stepping down cancels their links");
      assert.strictEqual((await at(`/api/invites/${tokenOf(gusLink)}`, { cookie: frank })).status, 200, "other owners' links stay");

      assert.strictEqual((await role("OWNER")).status, 200);
      assert.strictEqual((await at(`/api/invites/${kept}`, { cookie: frank })).status, 404, "promoting again doesn't revive them");
      const saved = tokenOf(await at("/api/workspace/invites", { method: "POST", cookie: frank }));
      assert.strictEqual((await at(`/api/workspace/members/${frankId}`, { method: "DELETE", cookie: gus })).status, 204);
      assert.strictEqual((await at(`/api/invites/${saved}/accept`, { method: "POST", cookie: frank })).status, 404);
      const open = (await at("/api/workspace", { cookie: gus })).body.invites;
      assert.deepStrictEqual(open.map((i: any) => i.id), [gusLink.body.id], "only the remaining owner's link is open");
      assert.ok(!(await at("/api/session", { cookie: frank })).body.workspaces.some((w: any) => w.id === studio));
    });

    await scenario("Team changes from a page showing another workspace are refused", async () => {
      const shows = (id: string) => ({ "x-scopeci-workspace": id });
      const stale = await at("/api/workspace", { method: "PATCH", body: { name: "Wrong team" }, cookie: gus, headers: shows(gusHome) });
      assert.strictEqual(stale.status, 409);
      assert.strictEqual(stale.body.error, "You switched workspace in another window. Reload this page to continue.");
      for (const [path, method] of [
        ["/api/workspace/invites", "POST"],
        [`/api/workspace/members/${gusId}`, "DELETE"],
        [`/api/workspace/members/${gusId}`, "PATCH"],
      ]) {
        const reply = await at(path, { method, body: method === "PATCH" ? { role: "MEMBER" } : undefined, cookie: gus, headers: shows(gusHome) });
        assert.strictEqual(reply.status, 409, `${method} ${path}`);
        // Refused as stale, not by another rule (gus is the last owner here too).
        assert.strictEqual(reply.body.error, stale.body.error, `${method} ${path}`);
      }
      const team = await at("/api/workspace", { cookie: gus, headers: shows(gusHome) });
      assert.strictEqual(team.body.name, "Frank Studio", "reading is never refused, and nothing changed");
      assert.deepStrictEqual(team.body.members.map((m: any) => `${m.login}:${m.role}`), ["gus:OWNER"]);

      const matching = await at("/api/workspace", { method: "PATCH", body: { name: "Studio" }, cookie: gus, headers: shows(studio.toUpperCase()) });
      assert.strictEqual(matching.status, 200);
      const noHeader = await at("/api/workspace", { method: "PATCH", body: { name: "Frank Studio" }, cookie: gus });
      assert.strictEqual(noHeader.status, 200, "callers that don't send it work as before");
    });

    await scenario("Too many sign-ins from one network go back to the app with a notice, not raw JSON", async () => {
      const startIp = { "x-forwarded-for": "203.0.113.91" };
      let start: Reply | undefined;
      for (let i = 0; i < 21; i++) start = await call(server, "/api/auth/github?next=/app/invite/abc123", { headers: startIp });
      assert.strictEqual(start!.status, 302);
      assert.strictEqual(start!.headers.location, "/app/invite/abc123?signin=busy");
      assert.ok(start!.headers["retry-after"]);

      const fromInvite = await call(server, "/api/auth/github?next=/app/invite/xyz789", { headers: { "x-forwarded-for": "203.0.113.93" } });
      const callbackIp = { "x-forwarded-for": "203.0.113.92" };
      for (let i = 0; i < 20; i++) {
        const used = await call(server, "/api/auth/github/callback?code=x&state=y", { headers: callbackIp });
        assert.strictEqual(used.headers.location, "/app?signin=expired");
      }
      const limited = await call(server, "/api/auth/github/callback?code=x&state=y", {
        cookie: cookieFrom(fromInvite, "scopeci_oauth"),
        headers: callbackIp,
      });
      assert.strictEqual(limited.status, 302);
      assert.strictEqual(limited.headers.location, "/app/invite/xyz789?signin=busy", "back to the invite they started from");
    });

    await scenario("A GitHub outage while refreshing says try again; a token that no longer decrypts asks for a sign-in", async () => {
      const githubIp = { "x-forwarded-for": "203.0.113.94" };
      const repos = () => call(server, "/api/github/repositories", { cookie: dana, headers: githubIp });
      const danaRow = eq(usersTable.githubUserId, "5001");
      const [saved] = await db
        .select({
          githubTokenJson: usersTable.githubTokenJson,
          githubRefreshTokenJson: usersTable.githubRefreshTokenJson,
          githubTokenExpiresAt: usersTable.githubTokenExpiresAt,
        })
        .from(usersTable)
        .where(danaRow);
      const expire = () => db.update(usersTable).set({ githubTokenExpiresAt: new Date(Date.now() - 1000) }).where(danaRow);
      let refreshes = 0;
      const tokenEndpoint = (answer: () => Promise<Response>) =>
        setGitHubFetch(async (url, init) => {
          if (url !== `${WEB}/login/oauth/access_token`) return fakeGitHub(url, init);
          refreshes++;
          return answer();
        });
      try {
        await expire();
        tokenEndpoint(async () => json({ message: "Server Error" }, 502));
        const down = await repos();
        assert.strictEqual(down.status, 502, JSON.stringify(down.body));
        assert.match(down.body.error, /Try again/);

        tokenEndpoint(async () => {
          throw new TypeError("fetch failed");
        });
        assert.strictEqual((await repos()).status, 502, "GitHub unreachable");
        tokenEndpoint(async () => json({ message: "Slow down" }, 429, { "retry-after": "1" }));
        assert.strictEqual((await repos()).status, 503, "GitHub limiting requests");

        // Two requests that both find the token expired share one refresh:
        // GitHub's refresh tokens work once.
        refreshes = 0;
        tokenEndpoint(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return json({ access_token: "user-token-2", refresh_token: "refresh-1", expires_in: 28800 });
        });
        const [first, second] = await Promise.all([repos(), repos()]);
        assert.deepStrictEqual([first.status, second.status], [200, 200]);
        assert.strictEqual(refreshes, 1);

        // Encrypted under a key the server no longer has.
        const unreadable = { ...(saved.githubTokenJson as object), authTag: "0".repeat(32) };
        await db
          .update(usersTable)
          .set({ githubTokenJson: unreadable, githubTokenExpiresAt: new Date(Date.now() + 3600_000) })
          .where(danaRow);
        const garbled = await repos();
        assert.strictEqual(garbled.status, 401);
        assert.match(garbled.body.error, /Sign in again/);
      } finally {
        setGitHubFetch(fakeGitHub);
        await db.update(usersTable).set(saved).where(danaRow);
      }
    });

    await scenario("A mangled link or an unreadable body is answered as the client's mistake", async () => {
      const mangled = await at("/api/invites/abc%zz", { cookie: dana });
      assert.strictEqual(mangled.status, 400);
      assert.strictEqual(mangled.body.error, "That link isn't valid. Check it and try again.");
      const address = server.address() as { port: number };
      const latin1 = await fetch(`http://127.0.0.1:${address.port}/api/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=latin1", "x-forwarded-for": "203.0.113.95" },
        body: JSON.stringify({ email: "charset-check@studio.test" }),
      });
      assert.strictEqual(latin1.status, 415);
      assert.strictEqual(((await latin1.json()) as { error: string }).error, "Send the request as JSON in UTF-8.");
    });

    await scenario("Wrong admin keys are limited on every route, not just the sign-in form", async () => {
      process.env.ADMIN_SECRET = "product-admin-secret";
      const guesser = { "x-forwarded-for": "203.0.113.96" };
      try {
        for (let i = 0; i < 10; i++) {
          const wrong = await call(server, "/api/admin/session", { headers: { ...guesser, "x-admin-key": `guess-${i}` } });
          assert.strictEqual(wrong.status, 401);
        }
        const blocked = await call(server, "/api/admin/session", { headers: { ...guesser, authorization: "Bearer product-admin-secret" } });
        assert.strictEqual(blocked.status, 429, "even the right key, once the address has guessed too often");
        const form = await call(server, "/api/admin/session", { body: { key: "product-admin-secret" }, headers: guesser });
        assert.strictEqual(form.status, 429, "the sign-in form shares the count");
        const apiKey = await call(server, "/api/integrations/linear/connect", { headers: { ...guesser, authorization: "Bearer guess" } });
        assert.strictEqual(apiKey.status, 429, "so does the API key");
        assert.strictEqual((await call(server, "/api/admin/session", { headers: guesser })).status, 401, "no key is not a guess");

        const script = { "x-forwarded-for": "203.0.113.97", "x-admin-key": "product-admin-secret" };
        for (let i = 0; i < 12; i++) assert.strictEqual((await call(server, "/api/admin/session", { headers: script })).status, 204);
      } finally {
        delete process.env.ADMIN_SECRET;
      }
    });

    await scenario("The waitlist export keeps every value in its own cell, with dates a spreadsheet reads", async () => {
      process.env.ADMIN_SECRET = "product-admin-secret";
      const email = `export-check-${Date.now()}@studio.test`;
      const { waitlistSignupsTable } = await import("@workspace/db/schema");
      try {
        const signup = await call(server, "/api/waitlist", {
          body: { email, agency: "Acme\r=IMAGE(B3)", utmSource: "\r=1+2" },
          headers: { "x-forwarded-for": "203.0.113.98" },
        });
        assert.strictEqual(signup.status, 201, JSON.stringify(signup.body));
        const csv = await call(server, "/api/admin/waitlist/csv", { headers: { "x-admin-key": "product-admin-secret" } });
        assert.strictEqual(csv.status, 200);
        const text = String(csv.body);
        // With quoted cells taken out, no line break is left to start a row inside a value.
        assert.ok(!/\r/.test(text.replace(/"(?:[^"]|"")*"/g, "")), "no bare carriage return outside a quoted cell");
        const line = text.split("\n").find((l) => l.includes(email))!;
        // The signup form may strip the carriage return before it is stored; either
        // way each value stays one cell and the formula can't run.
        assert.match(line, /,"Acme\r?=IMAGE\(B3\)",/);
        assert.match(line, /,"?'\r?=1\+2"?,/);
        assert.match(line, /,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      } finally {
        await db.delete(waitlistSignupsTable).where(eq(waitlistSignupsTable.email, email));
        delete process.env.ADMIN_SECRET;
      }
    });

    await scenario("The schema sync makes the contact form's table, locked by row level security and indexed by date", async () => {
      const { contactMessagesTable } = await import("@workspace/db/schema");
      const { pool } = await import("@workspace/db");
      const table = await pool.query<{ relrowsecurity: boolean }>(
        "SELECT relrowsecurity FROM pg_class WHERE relname = 'contact_messages' AND relkind = 'r'",
      );
      assert.strictEqual(table.rows[0]?.relrowsecurity, true, "row level security is on");
      const index = await pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'contact_messages' AND indexname = 'contact_messages_created_at_idx'",
      );
      assert.match(index.rows[0]?.indexdef ?? "", /\(created_at\)/);

      const email = `schema-check-${Date.now()}@studio.test`;
      try {
        const sent = await call(server, "/api/contact", {
          body: { name: "Schema Check", email, topic: "general", message: "Stored on a database the server set up." },
          headers: { "x-forwarded-for": "203.0.113.99" },
        });
        assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
        const [row] = await db.select().from(contactMessagesTable).where(eq(contactMessagesTable.email, email));
        assert.match(row?.id ?? "", /^[0-9a-f-]{36}$/, "the id is a uuid the database made");
      } finally {
        await db.delete(contactMessagesTable).where(eq(contactMessagesTable.email, email));
      }
    });

    await scenario("A saved GitHub App that no longer decrypts is reported, and isn't replaced by accident", async () => {
      process.env.ADMIN_SECRET = "product-admin-secret";
      const admin = { "x-admin-key": "product-admin-secret", "x-forwarded-for": "203.0.113.99" };
      const names = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"];
      const fromEnv = names.map((name) => [name, process.env[name]] as const);
      const { encryptToken } = await import("../linear/crypto.js");
      const garbled = { ...encryptToken("secret", "v1", "GITHUB_TOKEN_ENCRYPTION_KEY"), authTag: "0".repeat(32) };
      try {
        for (const name of names) delete process.env[name];
        await db.insert(appSettingsTable).values({
          key: "github_app",
          valueJson: {
            appId: "888",
            slug: "scopeci-old",
            name: "ScopeCI Old",
            owner: "harbor-agency",
            htmlUrl: "https://github.com/organizations/harbor-agency/settings/apps/scopeci-old",
            clientId: "Iv1.old",
            clientSecret: garbled,
            privateKey: garbled,
            webhookSecret: garbled,
            createdAt: new Date().toISOString(),
          },
        });
        forgetGitHubAppSettings();
        const status = await call(server, "/api/admin/github-app", { headers: admin });
        assert.strictEqual(status.body.configured, false);
        assert.strictEqual(status.body.storedUnreadable?.slug, "scopeci-old");
        const replace = await call(server, "/api/admin/github-app/manifest", { body: { name: "ScopeCI" }, headers: admin });
        assert.strictEqual(replace.status, 409);
        assert.match(replace.body.error, /scopeci-old.*GITHUB_TOKEN_ENCRYPTION_KEY/);
        assert.strictEqual((await call(server, "/api/admin/github-app", { method: "DELETE", headers: admin })).status, 204);
        assert.strictEqual((await call(server, "/api/admin/github-app", { headers: admin })).body.storedUnreadable, null);
      } finally {
        for (const [name, value] of fromEnv) process.env[name] = value;
        await db.delete(appSettingsTable);
        forgetGitHubAppSettings();
        delete process.env.ADMIN_SECRET;
      }
    });

    await scenario("Cancelled and expired invites can't be used", async () => {
      const cancelled = await call(server, "/api/workspace/invites", { method: "POST", cookie: dana });
      const cancelledToken = cancelled.body.url.split("/").pop();
      assert.strictEqual(
        (await call(server, `/api/workspace/invites/${cancelled.body.id}`, { method: "DELETE", cookie: dana })).status,
        204,
      );
      assert.strictEqual((await call(server, `/api/invites/${cancelledToken}/accept`, { method: "POST", cookie: eve })).status, 404);

      const expired = await call(server, "/api/workspace/invites", { method: "POST", cookie: dana });
      await db
        .update(organizationInvitesTable)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(organizationInvitesTable.id, expired.body.id));
      const expiredToken = expired.body.url.split("/").pop();
      assert.strictEqual((await call(server, `/api/invites/${expiredToken}/accept`, { method: "POST", cookie: eve })).status, 404);
      assert.strictEqual((await call(server, "/api/invites/not-a-real-token", { cookie: eve })).status, 404);
    });

    await scenario("A connected repository without a confirmed scope gets a neutral note", async () => {
      const second = await call(server, "/api/projects", { body: { name: "Marketing site" }, cookie: dana });
      secondProjectId = second.body.id;
      await call(server, `/api/projects/${secondProjectId}/repository`, {
        method: "PUT",
        body: { installationId: 501, repositoryId: 7002 },
        cookie: dana,
      });
      const result: any = await deliver(prPayload({ id: 7002, full_name: "harbor-agency/marketing" }, 3, "c".repeat(40)));
      assert.strictEqual(result.status, "ignored");
      const note = fake.checkRuns.find((r) => r.body.head_sha === "c".repeat(40));
      assert.strictEqual(note?.body.output.title, "ScopeCI: scope not confirmed yet");
      assert.strictEqual(note?.body.conclusion, "neutral");
    });

    await scenario("An installation no workspace claimed is ignored, never checked against someone else's scope", async () => {
      const before = fake.checkRuns.length;
      const result: any = await deliver(
        prPayload({ id: 7001, full_name: "harbor-agency/storefront" }, 12, "d".repeat(40), "opened", 999),
      );
      assert.strictEqual(result.status, "unmapped");
      assert.strictEqual(fake.checkRuns.length, before);
    });

    await scenario("Removing a repository from the App disconnects its project", async () => {
      await deliver(
        { action: "removed", installation: { id: 501 }, repositories_removed: [{ id: 7002, full_name: "harbor-agency/marketing" }] },
        "installation_repositories",
      );
      const detail = await call(server, `/api/projects/${secondProjectId}`, { cookie: dana });
      assert.strictEqual(detail.body.project.repository, null);
      const still = await call(server, `/api/projects/${projectId}`, { cookie: dana });
      assert.strictEqual(still.body.project.repository.fullName, "harbor-agency/storefront");
    });

    await scenario("A suspended installation stops checks until it is unsuspended", async () => {
      await deliver({ action: "suspend", installation: { id: 501 } }, "installation");
      const result: any = await deliver(prPayload({ id: 7001, full_name: "harbor-agency/storefront" }, 12, "e".repeat(40), "synchronize"));
      assert.strictEqual(result.status, "ignored");
      await deliver({ action: "unsuspend", installation: { id: 501 } }, "installation");
      const install = await db.query.githubInstallationsTable.findFirst({
        where: eq(githubInstallationsTable.installationId, "501"),
      });
      assert.strictEqual(install?.suspendedAt, null);
    });

    await scenario("Policy and rate changes apply; an expired GitHub token is refreshed", async () => {
      const patched = await call(server, `/api/projects/${projectId}`, {
        method: "PATCH",
        body: { policyMode: "ENFORCE", hourlyRate: null },
        cookie: dana,
      });
      assert.strictEqual(patched.body.policyMode, "ENFORCE");
      assert.strictEqual(patched.body.hourlyRate, null);

      await db.update(usersTable).set({ githubTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(usersTable.githubUserId, "5001"));
      const repos = await call(server, "/api/github/repositories", { cookie: dana });
      assert.strictEqual(repos.status, 200);
      assert.strictEqual(repos.body.repositories.find((r: any) => r.id === 7001).linkedProjectId, projectId);

      await db.update(usersTable).set({ githubTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(usersTable.githubUserId, "5001"));
      fake.refreshWorks = false;
      const expired = await call(server, "/api/github/repositories", { cookie: dana });
      assert.strictEqual(expired.status, 401);
      fake.refreshWorks = true;
    });

    await scenario("Archiving a project frees its repository and hides it, and releases its blocking checks", async () => {
      const blocking = async () => {
        const open = await db.query.pullRequestsTable.findMany({
          where: and(eq(pullRequestsTable.projectId, projectId), eq(pullRequestsTable.state, "OPEN")),
        });
        if (open.length === 0) return [];
        return db.query.githubCheckRunsTable.findMany({
          where: and(
            inArray(githubCheckRunsTable.pullRequestId, open.map((p) => p.id)),
            inArray(githubCheckRunsTable.conclusion, ["failure", "action_required"]),
          ),
        });
      };
      const before = await blocking();
      const archived = await call(server, `/api/projects/${projectId}`, { method: "DELETE", cookie: dana });
      assert.strictEqual(archived.status, 204);
      for (let i = 0; i < 40 && (await blocking()).length > 0; i++) await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual((await blocking()).length, 0, "no ScopeCI check is left blocking an open pull request");
      for (const run of before) {
        const posted = fake.checkRuns.find((r) => String(r.id) === run.githubCheckRunId);
        assert.strictEqual(posted?.body.conclusion, "neutral");
        assert.strictEqual(posted?.body.output?.title, "ScopeCI no longer checks this repository");
      }
      assert.strictEqual((await call(server, `/api/projects/${projectId}`, { cookie: dana })).status, 404);
      const row = await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) });
      assert.strictEqual(row?.repositoryExternalId, null);
    });

    await scenario("An archived project is listed and can be restored, with its results", async () => {
      const archived = await call(server, "/api/projects/archived", { cookie: dana });
      assert.ok(archived.body.projects.some((p: any) => p.id === projectId));
      assert.strictEqual((await call(server, `/api/projects/${projectId}/restore`, { method: "POST", cookie: eve })).status, 404);
      const restored = await call(server, `/api/projects/${projectId}/restore`, { method: "POST", cookie: dana });
      assert.strictEqual(restored.status, 200, JSON.stringify(restored.body));
      assert.strictEqual(restored.body.repository, null, "the repository is connected again by hand");
      assert.ok((await call(server, "/api/projects", { cookie: dana })).body.projects.some((p: any) => p.id === projectId));
      const results = await call(server, `/api/projects/${projectId}/pull-requests`, { cookie: dana });
      assert.ok(results.body.pullRequests.length > 0, "its results are still there");
      assert.strictEqual((await call(server, `/api/projects/${projectId}/restore`, { method: "POST", cookie: dana })).status, 404, "not archived any more");
    });

    await scenario("A GitHub account its workspace no longer uses can be connected from another", async () => {
      await call(server, "/api/session/workspace", { method: "PUT", body: { organizationId: eveWorkspace }, cookie: eve });
      const eveProject = await call(server, "/api/projects", { body: { name: "Eve's marketing" }, cookie: eve });
      const claim = await call(server, `/api/projects/${eveProject.body.id}/repository`, {
        method: "PUT",
        body: { installationId: 501, repositoryId: 7002 },
        cookie: eve,
      });
      assert.strictEqual(claim.status, 200, JSON.stringify(claim.body));
      const install = await db.query.githubInstallationsTable.findFirst({
        where: eq(githubInstallationsTable.installationId, "501"),
      });
      assert.strictEqual(install?.organizationId, eveWorkspace);
    });

    await scenario("Signing out ends the session", async () => {
      const out = await call(server, "/api/session", { method: "DELETE", cookie: dana });
      assert.strictEqual(out.status, 204);
      const session = await call(server, "/api/session", { cookie: dana });
      assert.strictEqual(session.body.user, null);
      assert.strictEqual((await call(server, "/api/projects", { cookie: dana })).status, 401);
    });

    await scenario("Webhook deliveries for the product were all recorded", async () => {
      const rows = await db
        .select()
        .from(webhookDeliveriesTable)
        .where(and(eq(webhookDeliveriesTable.repositoryFullName, "harbor-agency/storefront"), eq(webhookDeliveriesTable.status, "PROCESSED")));
      assert.ok(rows.length >= 2);
    });

    await scenario("An admin creates the GitHub App from the admin page; its keys are stored encrypted and used", async () => {
      process.env.ADMIN_SECRET = "product-admin-secret";
      const admin = { "x-admin-key": "product-admin-secret" };
      const fromEnv = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"].map(
        (name) => [name, process.env[name]] as const,
      );
      try {
        assert.strictEqual((await call(server, "/api/admin/github-app")).status, 401);
        assert.strictEqual((await call(server, "/api/admin/github-app/manifest", { body: { name: "X" } })).status, 401);

        // While the App comes from the environment, the page doesn't replace it.
        const envStatus = await call(server, "/api/admin/github-app", { headers: admin });
        assert.strictEqual(envStatus.body.source, "environment");
        const refused = await call(server, "/api/admin/github-app/manifest", { body: { name: "ScopeCI" }, headers: admin });
        assert.strictEqual(refused.status, 409);

        for (const [name] of fromEnv) delete process.env[name];
        await db.delete(appSettingsTable);
        forgetGitHubAppSettings();
        setWebhookService(null);

        const empty = await call(server, "/api/admin/github-app", { headers: admin });
        assert.strictEqual(empty.body.configured, false);
        assert.strictEqual(empty.body.baseUrl, "http://localhost:3000");
        assert.strictEqual((await call(server, "/api/session")).body.signInAvailable, false);

        const bad = await call(server, "/api/admin/github-app/manifest", {
          body: { name: "ScopeCI", organization: "not an org!" },
          headers: admin,
        });
        assert.strictEqual(bad.status, 400);

        const start = async () => {
          const reply = await call(server, "/api/admin/github-app/manifest", {
            body: { name: "ScopeCI Made Here", organization: "harbor-agency" },
            headers: admin,
          });
          assert.strictEqual(reply.status, 200);
          const action = new URL(reply.body.action);
          assert.strictEqual(action.origin + action.pathname, `${WEB}/organizations/harbor-agency/settings/apps/new`);
          return { state: action.searchParams.get("state")!, manifest: reply.body.manifest };
        };

        const first = await start();
        assert.deepStrictEqual(first.manifest.hook_attributes, { url: "http://localhost:3000/api/webhooks/github", active: true });
        assert.strictEqual(first.manifest.redirect_url, "http://localhost:3000/api/setup/github-app/callback");
        assert.deepStrictEqual(first.manifest.callback_urls, ["http://localhost:3000/api/auth/github/callback"]);
        assert.deepStrictEqual(first.manifest.default_events, ["pull_request"]);
        assert.deepStrictEqual(first.manifest.default_permissions, {
          pull_requests: "write",
          checks: "write",
          contents: "read",
          metadata: "read",
        });

        // Starting again replaces the first setup, so its state stops working.
        const second = await start();
        const late = await call(server, `/api/setup/github-app/callback?code=manifest-code&state=${first.state}`);
        assert.strictEqual(late.headers.location, "/admin/waitlist?github=expired");
        // A code sent with someone else's state is refused, and leaves the admin's setup alone.
        const forged = await call(server, `/api/setup/github-app/callback?code=manifest-code&state=forged`);
        assert.strictEqual(forged.headers.location, "/admin/waitlist?github=expired");
        assert.strictEqual(fake.conversions, 0);

        const done = await call(server, `/api/setup/github-app/callback?code=manifest-code&state=${second.state}`);
        assert.strictEqual(done.status, 302);
        assert.strictEqual(done.headers.location, "/admin/waitlist?github=created");
        assert.strictEqual(fake.conversions, 1);
        const replay = await call(server, `/api/setup/github-app/callback?code=manifest-code&state=${second.state}`);
        assert.strictEqual(replay.headers.location, "/admin/waitlist?github=expired");

        const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "github_app"));
        const stored = JSON.stringify(row.valueJson);
        for (const secretValue of ["stored-client-secret", "stored-webhook-secret", "BEGIN RSA PRIVATE KEY"]) {
          assert.ok(!stored.includes(secretValue), `${secretValue} is not stored in plain text`);
        }

        const status = await call(server, "/api/admin/github-app", { headers: admin });
        assert.strictEqual(status.body.configured, true);
        assert.strictEqual(status.body.source, "admin");
        assert.strictEqual(status.body.slug, "scopeci-made-here");
        assert.strictEqual(status.body.signInReady, true);
        assert.strictEqual(status.body.webhooksReady, true);
        assert.strictEqual(status.body.installUrl, "https://github.com/apps/scopeci-made-here/installations/new");

        // Sign-in and webhooks now run on the stored App.
        assert.strictEqual((await call(server, "/api/session")).body.signInAvailable, true);
        const signInStart = await call(server, "/api/auth/github");
        assert.strictEqual(new URL(String(signInStart.headers.location)).searchParams.get("client_id"), "Iv1.stored-client");

        const payload = JSON.stringify({ action: "opened", installation: { id: 999 } });
        const sign = (key: string) => `sha256=${crypto.createHmac("sha256", key).update(payload).digest("hex")}`;
        const deliver = async (signature: string) => {
          const address = server.address() as { port: number };
          const res = await fetch(`http://127.0.0.1:${address.port}/api/webhooks/github`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-github-event": "pull_request",
              "x-github-delivery": `del_${crypto.randomUUID()}`,
              "x-hub-signature-256": signature,
            },
            body: payload,
          });
          return res.status;
        };
        assert.strictEqual(await deliver(sign("mock_scopeci_webhook_secret")), 401);
        assert.notStrictEqual(await deliver(sign("stored-webhook-secret")), 401);

        assert.strictEqual((await call(server, "/api/admin/github-app", { method: "DELETE", headers: admin })).status, 204);
        assert.strictEqual((await call(server, "/api/admin/github-app", { headers: admin })).body.configured, false);
        assert.strictEqual((await call(server, "/api/admin/github-app", { method: "DELETE", headers: admin })).status, 404);
      } finally {
        for (const [name, value] of fromEnv) process.env[name] = value;
        await db.delete(appSettingsTable);
        forgetGitHubAppSettings();
        setWebhookService(service);
        delete process.env.ADMIN_SECRET;
      }
    });

    await scenario("The App JWT is RS256 and expires within ten minutes", async () => {
      const jwt = createAppJwt("424242", PRIVATE_PEM, 1_700_000_000);
      const [header, payload] = jwt
        .split(".")
        .slice(0, 2)
        .map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));
      assert.strictEqual(header.alg, "RS256");
      assert.strictEqual(payload.exp - payload.iat, 600);
    });
  } finally {
    setGitHubFetch(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\nProduct: ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
