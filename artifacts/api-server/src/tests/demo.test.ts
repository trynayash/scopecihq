import assert from "node:assert";
import http from "node:http";
import app from "../app";
import { setDemoGitHubFetch } from "../routes/demo";

/**
 * The public "try it" demo: SOW parsing, evaluation and public PR lookup.
 * Nothing here touches the database.
 */

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

async function call(
  server: http.Server,
  path: string,
  options: { method?: string; body?: unknown; ip?: string } = {},
): Promise<{ status: number; body: any }> {
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
          "x-forwarded-for": options.ip ?? "203.0.113.50",
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
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const SHOP_SOW = `# Statement of Work — Harbor & Pine Online Store

## §3.1 Storefront and Checkout
Product catalogue, shopping cart and Stripe checkout for a single currency (GBP).

**Explicit Inclusions**:
- Product catalogue and search
- Shopping cart
- Stripe checkout

**Explicit Exclusions**:
- Loyalty points programme
- Multi-currency pricing
- Gift cards
`;

const SHOP_SCOPE = {
  title: "Harbor & Pine Online Store",
  clauses: [
    {
      clauseRef: "§3.1",
      title: "Storefront and Checkout",
      included: ["product catalogue and search", "shopping cart", "stripe checkout"],
      excluded: ["loyalty points programme", "multi-currency pricing", "gift cards"],
    },
  ],
};

async function run() {
  console.log("\nScopeCI — public demo API\n");
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    await scenario("A numbered SOW is read into included and excluded items", async () => {
      const res = await call(server, "/api/demo/sow", { body: { markdown: SHOP_SOW } });
      assert.strictEqual(res.status, 200);
      const clause = res.body.clauses.find((c: any) => c.clauseRef === "§3.1");
      assert.ok(clause, "clause §3.1 present");
      assert.ok(clause.excluded.includes("gift cards"));
      assert.ok(clause.included.includes("shopping cart"));
    });

    await scenario("An SOW without numbered sections still yields scope", async () => {
      const markdown = "# Website rebuild\n\n## Scope\nWe will build the marketing site.\n\nOut of scope:\n- Blog migration\n- Hosting\n";
      const res = await call(server, "/api/demo/sow", { body: { markdown } });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.clauses[0].excluded, ["blog migration", "hosting"]);
      assert.strictEqual(res.body.clauses[0].clauseRef, "§1");
    });

    await scenario("Empty and oversized documents are refused with a readable error", async () => {
      const empty = await call(server, "/api/demo/sow", { body: { markdown: "" } });
      assert.strictEqual(empty.status, 400);
      const huge = await call(server, "/api/demo/sow", { body: { markdown: "x".repeat(40_001) } });
      assert.strictEqual(huge.status, 400);
      assert.strictEqual(typeof huge.body.error, "string");
    });

    await scenario("A long unbroken line is parsed quickly (no runaway backtracking)", async () => {
      const markdown = `## Scope\n${"word ".repeat(7_900)}is out of scope`;
      const started = Date.now();
      const res = await call(server, "/api/demo/sow", { body: { markdown } });
      const elapsed = Date.now() - started;
      assert.strictEqual(res.status, 200);
      assert.ok(elapsed < 2000, `took ${elapsed}ms`);
    });

    await scenario("Building excluded gift cards needs a change order, with a draft to send", async () => {
      const res = await call(server, "/api/demo/evaluate", {
        body: {
          scope: SHOP_SCOPE,
          pullRequest: {
            title: "Gift card purchase and redemption",
            branch: "feat/gift-cards",
            files: [{ path: "src/giftcards/redeem.ts", status: "added" }, { path: "src/giftcards/purchase.tsx", status: "added" }],
          },
          estimateHours: 12,
          hourlyRate: 120,
          projectName: "Statement of Work — Harbor & Pine Online Store",
        },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.state, "CHANGE_REQUIRED");
      assert.strictEqual(res.body.clause.clauseRef, "§3.1");
      assert.ok(res.body.comment.includes("ScopeCI: Change order needed"));
      assert.ok(!res.body.comment.includes("Linked issue"), "no fake linked-issue row without an issue");
      assert.strictEqual(res.body.changeOrder.subject, "Change request: gift cards (Harbor & Pine Online Store)");
      assert.ok(res.body.estimate.includes("from the hours you entered"), res.body.estimate);
      assert.ok(res.body.changeOrder.body.includes("$1,440"), "12h at $120");
    });

    await scenario("A cart fix is in scope and gets no change order", async () => {
      const res = await call(server, "/api/demo/evaluate", {
        body: { scope: SHOP_SCOPE, pullRequest: { title: "Fix cart rounding", files: [{ path: "src/checkout/cart.ts" }] } },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.state, "IN_SCOPE");
      assert.strictEqual(res.body.changeOrder, null);
    });

    await scenario("Without a rate, no money is shown; without hours, it says not estimated", async () => {
      const res = await call(server, "/api/demo/evaluate", {
        body: { scope: SHOP_SCOPE, pullRequest: { title: "Loyalty points", files: [{ path: "src/loyalty/points.ts" }] } },
      });
      assert.strictEqual(res.body.state, "CHANGE_REQUIRED");
      assert.strictEqual(res.body.estimate, "not estimated (enter the hours to price it)");
      assert.ok(!res.body.changeOrder.body.includes("$"));
    });

    await scenario("Invalid evaluation input is refused", async () => {
      const noFiles = await call(server, "/api/demo/evaluate", {
        body: { scope: SHOP_SCOPE, pullRequest: { title: "x", files: [] } },
      });
      assert.strictEqual(noFiles.status, 400);
      const tooMany = await call(server, "/api/demo/evaluate", {
        body: {
          scope: SHOP_SCOPE,
          pullRequest: { title: "x", files: Array.from({ length: 301 }, (_, i) => ({ path: `f${i}.ts` })) },
        },
      });
      assert.strictEqual(tooMany.status, 400);
    });

    await scenario("Only github.com pull request links are looked up", async () => {
      let calls = 0;
      setDemoGitHubFetch(async () => {
        calls++;
        return new Response("{}", { status: 200 });
      });
      for (const url of ["https://evil.example/a/b/pull/1", "https://github.com/a/b/issues/1", "file:///etc/passwd"]) {
        const res = await call(server, `/api/demo/github-pr?url=${encodeURIComponent(url)}`, { ip: "203.0.113.60" });
        assert.strictEqual(res.status, 400, url);
      }
      assert.strictEqual(calls, 0, "no request made for a bad link");
    });

    await scenario("A public PR is read, normalised and cached", async () => {
      let calls = 0;
      setDemoGitHubFetch(async (url) => {
        calls++;
        if (url.endsWith("/files?per_page=100")) {
          return Response.json([
            { filename: "src/giftcards/redeem.ts", status: "added" },
            { filename: "src/old.ts", status: "removed" },
          ]);
        }
        return Response.json({ number: 42, title: "Gift cards", body: "Closes HP-13", head: { ref: "feat/gift-cards" } });
      });
      const url = encodeURIComponent("https://github.com/harbor/store/pull/42");
      const first = await call(server, `/api/demo/github-pr?url=${url}`, { ip: "203.0.113.61" });
      assert.strictEqual(first.status, 200);
      assert.strictEqual(first.body.branch, "feat/gift-cards");
      assert.deepStrictEqual(first.body.files[1], { path: "src/old.ts", status: "deleted" });
      await call(server, `/api/demo/github-pr?url=${url}`, { ip: "203.0.113.61" });
      assert.strictEqual(calls, 2, "second lookup served from cache");
    });

    await scenario("Private or missing PRs and GitHub rate limits get clear errors", async () => {
      setDemoGitHubFetch(async () => new Response("{}", { status: 404 }));
      const missing = await call(server, `/api/demo/github-pr?url=${encodeURIComponent("https://github.com/a/b/pull/1")}`, {
        ip: "203.0.113.62",
      });
      assert.strictEqual(missing.status, 404);
      setDemoGitHubFetch(async () => new Response("{}", { status: 403 }));
      const limited = await call(server, `/api/demo/github-pr?url=${encodeURIComponent("https://github.com/a/b/pull/2")}`, {
        ip: "203.0.113.62",
      });
      assert.strictEqual(limited.status, 502);
      assert.ok(limited.body.error.includes("Paste the file list"));
    });

    await scenario("Documents built to make the parser backtrack are answered at once", async () => {
      const payloads = [
        "Excluding:".repeat(60) + "a" + " ".repeat(25_000) + "b",
        Array.from({ length: 39 }, () => "x" + " ".repeat(998) + "y").join("\n"),
        "- Excluding:\n".repeat(3000),
        "## Scope\nBudget:" + " ".repeat(39_000) + "x",
      ];
      for (const markdown of payloads) {
        const started = Date.now();
        const res = await call(server, "/api/demo/sow", { body: { markdown }, ip: "203.0.113.70" });
        const elapsed = Date.now() - started;
        assert.ok([200, 400].includes(res.status), `status ${res.status}`);
        assert.ok(elapsed < 1000, `took ${elapsed}ms`);
      }
    });

    await scenario("Out of scope headings are read as exclusions", async () => {
      const markdown = "## In Scope\n- User login\n- Checkout\n\n## Out of Scope\n- Mobile apps\n- Gift cards\n";
      const res = await call(server, "/api/demo/sow", { body: { markdown }, ip: "203.0.113.71" });
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body.clauses[0].included, ["user login", "checkout"]);
      assert.deepStrictEqual(res.body.clauses[1].excluded, ["mobile apps", "gift cards"]);
    });

    await scenario("A long SOW keeps its late exclusions and says what it left out", async () => {
      const sections = Array.from({ length: 8 }, (_, s) =>
        Array.from({ length: 8 }, (_, p) => `${s + 1}.${p + 1} Work package ${s + 1}.${p + 1}\nThe Supplier shall carry out this work package.`).join("\n\n"),
      ).join("\n\n");
      const markdown = `# Harbor & Pine\n\n${sections}\n\n## 9.1 Exclusions\nOut of scope: loyalty points programme, gift cards, multi-currency pricing.\n`;
      const parsed = await call(server, "/api/demo/sow", { body: { markdown }, ip: "203.0.113.72" });
      assert.strictEqual(parsed.status, 200);
      assert.strictEqual(parsed.body.clauses.length, 60);
      const exclusions = parsed.body.clauses.find((c: any) => c.clauseRef === "§9.1");
      assert.ok(exclusions, "§9.1 kept");
      assert.deepStrictEqual(exclusions.excluded, ["loyalty points programme", "gift cards", "multi-currency pricing"]);
      assert.ok(
        parsed.body.warnings.some((w: string) => w.includes("has 65, so 5 were left out")),
        JSON.stringify(parsed.body.warnings),
      );

      const checked = await call(server, "/api/demo/evaluate", {
        body: {
          scope: { title: parsed.body.title, clauses: parsed.body.clauses },
          pullRequest: { title: "Add loyalty points at checkout", files: [{ path: "src/loyalty/points.ts", status: "added" }] },
        },
        ip: "203.0.113.72",
      });
      assert.strictEqual(checked.status, 200);
      assert.strictEqual(checked.body.state, "CHANGE_REQUIRED");
      assert.strictEqual(checked.body.clause.clauseRef, "§9.1");
    });

    await scenario("Sections with items that don't fit are named in the warning", async () => {
      const markdown = Array.from({ length: 62 }, (_, i) => `## 1.${i + 1} Feature ${i + 1}\nIncludes widget number ${i + 1}.`).join("\n");
      const res = await call(server, "/api/demo/sow", { body: { markdown }, ip: "203.0.113.73" });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.clauses.length, 60);
      assert.ok(res.body.warnings.some((w: string) => w.includes("§1.61, §1.62")), JSON.stringify(res.body.warnings));
    });

    await scenario("A scope too large to check is refused at once, and a parsed scope always fits", async () => {
      const item = (i: number) => `excluded feature number ${i} with a long name`;
      const huge = {
        title: "Huge",
        clauses: Array.from({ length: 60 }, (_, c) => ({
          clauseRef: `§${c + 1}`,
          title: `Clause ${c + 1}`,
          included: [],
          excluded: Array.from({ length: 20 }, (_, i) => item(c * 20 + i)),
        })),
      };
      const started = Date.now();
      const refused = await call(server, "/api/demo/evaluate", {
        body: { scope: huge, pullRequest: { title: "x", files: [{ path: "src/a.ts" }] } },
        ip: "203.0.113.74",
      });
      assert.strictEqual(refused.status, 400);
      assert.ok(refused.body.error.includes("too large for the demo"), refused.body.error);
      assert.ok(Date.now() - started < 1000, "refused before any checking");

      // Twelve clauses of a hundred items each: more than the demo checks.
      const markdown = Array.from(
        { length: 12 },
        (_, c) => `## 1.${c + 1} Part ${c + 1}\nExcluding: ${Array.from({ length: 100 }, (_, i) => `item${c}x${i}`).join(", ")}.`,
      ).join("\n");
      const parsed = await call(server, "/api/demo/sow", { body: { markdown }, ip: "203.0.113.74" });
      assert.strictEqual(parsed.status, 200);
      const items = parsed.body.clauses.reduce((n: number, c: any) => n + c.included.length + c.excluded.length, 0);
      assert.strictEqual(items, 1000);
      assert.ok(parsed.body.warnings.some((w: string) => w.includes("200 were left out")), JSON.stringify(parsed.body.warnings));
      const checked = await call(server, "/api/demo/evaluate", {
        body: { scope: { title: parsed.body.title, clauses: parsed.body.clauses }, pullRequest: { title: "x", files: [{ path: "src/a.ts" }] } },
        ip: "203.0.113.74",
      });
      assert.strictEqual(checked.status, 200);
    });

    /** A fake GitHub serving a pull request with `total` changed files, 100 to a page. */
    function pagedPullRequest(total: number, failPage?: number) {
      const requested: number[] = [];
      setDemoGitHubFetch(async (url) => {
        const files = url.match(/\/files\?per_page=100(?:&page=(\d+))?$/);
        if (!files) return Response.json({ number: 7, title: "Big change", head: { ref: "big" }, changed_files: total });
        const page = Number(files[1] ?? 1);
        requested.push(page);
        if (page === failPage) return new Response("{}", { status: 500 });
        const count = Math.max(0, Math.min(100, total - (page - 1) * 100));
        return Response.json(Array.from({ length: count }, (_, i) => ({ filename: `src/f${(page - 1) * 100 + i}.ts`, status: "modified" })));
      });
      return requested;
    }

    await scenario("A public PR with more than 100 files is read in full", async () => {
      const requested = pagedPullRequest(250);
      const res = await call(server, `/api/demo/github-pr?url=${encodeURIComponent("https://github.com/harbor/store/pull/7")}`, {
        ip: "203.0.113.75",
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.files.length, 250);
      assert.strictEqual(res.body.files[249].path, "src/f249.ts");
      assert.strictEqual(res.body.totalFiles, 250);
      assert.deepStrictEqual(requested, [1, 2, 3]);
    });

    await scenario("A public PR with more files than a check takes reads the first 300 and gives the full count", async () => {
      const requested = pagedPullRequest(412);
      const res = await call(server, `/api/demo/github-pr?url=${encodeURIComponent("https://github.com/harbor/store/pull/8")}`, {
        ip: "203.0.113.75",
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.files.length, 300);
      assert.strictEqual(res.body.totalFiles, 412);
      assert.deepStrictEqual(requested, [1, 2, 3], "no page past what a check takes");

      const exact = pagedPullRequest(100);
      const hundred = await call(server, `/api/demo/github-pr?url=${encodeURIComponent("https://github.com/harbor/store/pull/10")}`, {
        ip: "203.0.113.75",
      });
      assert.strictEqual(hundred.body.files.length, 100);
      assert.deepStrictEqual(exact, [1], "no empty second page asked for");
    });

    await scenario("A later page of files that fails gives a clear error, not a partial list", async () => {
      pagedPullRequest(250, 2);
      const res = await call(server, `/api/demo/github-pr?url=${encodeURIComponent("https://github.com/harbor/store/pull/9")}`, {
        ip: "203.0.113.75",
      });
      assert.strictEqual(res.status, 502);
      assert.ok(res.body.error.includes("whole file list"), res.body.error);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(`\nDemo API: ${passed} passed, ${failures.length} failed`);
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
