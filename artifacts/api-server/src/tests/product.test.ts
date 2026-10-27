import assert from "node:assert";
import crypto from "node:crypto";
import http from "node:http";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  commercialEvaluationsTable,
  githubInstallationsTable,
  organizationMembersTable,
  prDiffAnalysesTable,
  projectsTable,
  scopeBaselinesTable,
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
const { setGitHubFetch } = await import("../github/github-http.js");
const { GitHubAppClient, createAppJwt } = await import("../github/app-client.js");
const { NoIssueProvider } = await import("../github/issue-provider.js");
const { WebhookService } = await import("../github/webhook-service.js");
const { setWebhookService } = await import("../routes/github.js");
const { COMMENT_MARKER } = await import("../github/comment-formatter.js");

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
  comments: {
    "harbor-agency/storefront#12": [
      // A person quoting the marker: ScopeCI must never edit this one.
      { id: 1, body: `Copied from the bot: ${COMMENT_MARKER}`, user: { login: "dana", type: "User" } },
    ],
  } as Record<string, Array<{ id: number; body: string; user: { login: string; type: string } }>>,
  jwtChecked: 0,
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
  options: { method?: string; body?: unknown; cookie?: string; origin?: string } = {},
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

    await scenario("Archiving a project frees its repository and hides it", async () => {
      const archived = await call(server, `/api/projects/${projectId}`, { method: "DELETE", cookie: dana });
      assert.strictEqual(archived.status, 204);
      assert.strictEqual((await call(server, `/api/projects/${projectId}`, { cookie: dana })).status, 404);
      const row = await db.query.projectsTable.findFirst({ where: eq(projectsTable.id, projectId) });
      assert.strictEqual(row?.repositoryExternalId, null);
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
