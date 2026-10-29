// A small stand-in for github.com and api.github.com, enough for ScopeCI's
// whole journey: sign in with GitHub, list the App's installations and
// repositories, mint installation tokens, read a pull request's files, and
// keep the check runs and comments ScopeCI posts. It also sends signed
// webhooks to the app, the way GitHub would.
//
// Control endpoints (for the journey script, never part of GitHub):
//   POST /__e2e/sign-in-as   {login}        who the next sign-in becomes
//   POST /__e2e/pull-request {repo, number, title, body, branch, sha, files, action}
//                                            open or update a pull request and send its webhook
//   POST /__e2e/fail         {path, status, times}  answer a path with an error, n times
//   GET  /__e2e/state                       check runs and comments so far

import crypto from "node:crypto";
import http from "node:http";

const USERS = {
  dana: { id: 91001, login: "dana-pm", name: "Dana Okafor", email: null, avatar_url: null },
  eve: { id: 91002, login: "eve-dev", name: "Eve Lindqvist", email: null, avatar_url: null },
};
const INSTALLATION = {
  id: 601,
  account: { login: "harbor-agency", id: 7700, type: "Organization" },
  repository_selection: "selected",
  permissions: { pull_requests: "write", checks: "write", contents: "read", metadata: "read" },
};
const REPOS = [
  { id: 8801, full_name: "harbor-agency/storefront", name: "storefront", private: true },
  { id: 8802, full_name: "harbor-agency/marketing", name: "marketing", private: false },
];

export function startFakeGitHub({ port, appUrl, webhookSecret }) {
  const state = {
    nextUser: "dana",
    codes: new Map(), // code -> user key
    tokens: new Map(), // access token -> user key
    pulls: new Map(), // "owner/repo#n" -> pull request
    files: new Map(), // "owner/repo#n" -> files
    checkRuns: [],
    comments: new Map(), // "owner/repo#n" -> comments
    failures: [], // { path, status, times }
    nextId: 1000,
    requests: 0,
  };

  const send = (res, status, data, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(data === undefined ? "" : JSON.stringify(data));
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(Object.fromEntries(new URLSearchParams(raw)));
        }
      });
    });

  async function deliver(event, payload) {
    const raw = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac("sha256", webhookSecret).update(raw).digest("hex")}`;
    const res = await fetch(`${appUrl}/api/webhooks/github`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": crypto.randomUUID(),
        "x-hub-signature-256": signature,
      },
      body: raw,
    });
    return res.status;
  }

  const server = http.createServer(async (req, res) => {
    state.requests++;
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method;
    const body = method === "GET" ? {} : await readBody(req);
    const auth = (req.headers.authorization ?? "").replace(/^(Bearer|token) /i, "");

    // Injected failures, for the error-handling journeys.
    const failure = state.failures.find((f) => path.startsWith(f.path) && f.times > 0);
    if (failure && !path.startsWith("/__e2e")) {
      failure.times--;
      return send(res, failure.status, { message: `Injected ${failure.status}` });
    }

    /* ---- control ---- */
    if (path === "/__e2e/sign-in-as" && method === "POST") {
      state.nextUser = body.login;
      return send(res, 200, { ok: true });
    }
    if (path === "/__e2e/fail" && method === "POST") {
      state.failures.push({ path: body.path, status: body.status, times: body.times ?? 1 });
      return send(res, 200, { ok: true });
    }
    if (path === "/__e2e/state") {
      return send(res, 200, {
        checkRuns: state.checkRuns,
        comments: Object.fromEntries(state.comments),
        requests: state.requests,
      });
    }
    if (path === "/__e2e/pull-request" && method === "POST") {
      const repo = REPOS.find((r) => r.full_name === body.repo);
      const key = `${body.repo}#${body.number}`;
      const existing = state.pulls.get(key);
      const pr = {
        id: repo.id * 1000 + body.number,
        number: body.number,
        title: body.title,
        body: body.body ?? "",
        state: body.action === "closed" ? "closed" : "open",
        merged: Boolean(body.merged),
        draft: false,
        head: { ref: body.branch, sha: body.sha },
        base: { ref: "main", sha: "0".repeat(40) },
        user: { login: "eve-dev" },
        additions: body.files.reduce((n, f) => n + (f.additions ?? 0), 0),
        deletions: body.files.reduce((n, f) => n + (f.deletions ?? 0), 0),
        changed_files: body.files.length,
        commits: (existing?.commits ?? 0) + 1,
        html_url: `https://github.com/${body.repo}/pull/${body.number}`,
        created_at: existing?.created_at ?? new Date().toISOString(),
        merged_at: body.merged ? new Date().toISOString() : null,
      };
      state.pulls.set(key, pr);
      state.files.set(key, body.files);
      if (body.silent) return send(res, 200, { delivered: null });
      const [owner, name] = body.repo.split("/");
      const status = await deliver("pull_request", {
        action: body.action ?? (existing ? "synchronize" : "opened"),
        installation: { id: INSTALLATION.id },
        repository: { id: repo.id, name, full_name: repo.full_name, owner: { login: owner } },
        pull_request: pr,
      });
      return send(res, 200, { delivered: status });
    }

    /* ---- github.com ---- */
    if (path === "/login/oauth/authorize") {
      const code = `code-${crypto.randomUUID()}`;
      state.codes.set(code, state.nextUser);
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (path === "/login/oauth/access_token" && method === "POST") {
      const who = body.grant_type === "refresh_token" ? body.refresh_token?.replace(/^refresh-/, "") : state.codes.get(body.code);
      if (!who || !USERS[who]) return send(res, 200, { error: "bad_verification_code" });
      state.codes.delete(body.code);
      const token = `user-${who}-${crypto.randomUUID()}`;
      state.tokens.set(token, who);
      return send(res, 200, { access_token: token, refresh_token: `refresh-${who}`, expires_in: 28800 });
    }

    /* ---- api.github.com, as the person ---- */
    const person = state.tokens.get(auth);
    if (path === "/user") return person ? send(res, 200, USERS[person]) : send(res, 401, { message: "Bad credentials" });
    if (path === "/user/installations") return person ? send(res, 200, { installations: [INSTALLATION] }) : send(res, 401, {});
    if (path === `/user/installations/${INSTALLATION.id}/repositories`) {
      return person ? send(res, 200, { repositories: REPOS }) : send(res, 401, {});
    }

    /* ---- api.github.com, as the App ---- */
    if (path === `/app/installations/${INSTALLATION.id}/access_tokens` && method === "POST") {
      return send(res, 201, { token: "inst-e2e", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (auth !== "inst-e2e") return send(res, 401, { message: `No route or no installation token for ${method} ${path}` });

    const m = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)$/);
    if (!m) return send(res, 404, { message: "Not Found" });
    const repo = `${m[1]}/${m[2]}`;
    const rest = m[3];

    if (rest === "/pulls" && method === "GET") {
      const open = [...state.pulls.entries()]
        .filter(([key, pr]) => key.startsWith(`${repo}#`) && pr.state === "open")
        .map(([, pr]) => pr);
      return send(res, 200, open);
    }
    let mm = rest.match(/^\/pulls\/(\d+)$/);
    if (mm) {
      const pr = state.pulls.get(`${repo}#${mm[1]}`);
      return pr ? send(res, 200, pr) : send(res, 404, { message: "Not Found" });
    }
    mm = rest.match(/^\/pulls\/(\d+)\/files$/);
    if (mm) return send(res, 200, state.files.get(`${repo}#${mm[1]}`) ?? []);

    if (rest === "/check-runs" && method === "POST") {
      const run = { id: state.nextId++, repo, ...body };
      state.checkRuns.push(run);
      return send(res, 201, { id: run.id, head_sha: body.head_sha, status: body.status, conclusion: body.conclusion, html_url: "#" });
    }
    mm = rest.match(/^\/check-runs\/(\d+)$/);
    if (mm && method === "PATCH") {
      const run = state.checkRuns.find((r) => r.id === Number(mm[1]));
      if (!run) return send(res, 404, {});
      // What the run said before each update, for checks that look back.
      run.history = [...(run.history ?? []), { title: run.output?.title, conclusion: run.conclusion }];
      Object.assign(run, body);
      return send(res, 200, { id: run.id, head_sha: run.head_sha, status: run.status, conclusion: run.conclusion });
    }
    mm = rest.match(/^\/issues\/(\d+)\/comments$/);
    if (mm) {
      const key = `${repo}#${mm[1]}`;
      if (!state.comments.has(key)) state.comments.set(key, []);
      if (method === "GET") return send(res, 200, state.comments.get(key));
      const comment = { id: state.nextId++, body: body.body, user: { login: "scopeci-e2e[bot]", type: "Bot" } };
      state.comments.get(key).push(comment);
      return send(res, 201, comment);
    }
    mm = rest.match(/^\/issues\/comments\/(\d+)$/);
    if (mm && method === "PATCH") {
      const comment = [...state.comments.values()].flat().find((c) => c.id === Number(mm[1]));
      if (!comment) return send(res, 404, {});
      comment.body = body.body;
      return send(res, 200, comment);
    }
    return send(res, 404, { message: `Fake GitHub has no route for ${method} ${path}` });
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ server, state, deliver })));
}
