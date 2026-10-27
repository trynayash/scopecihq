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
      assert.ok(res.body.comment.includes("CHANGE REQUIRED"));
      assert.ok(!res.body.comment.includes("Work Item"), "no fake linked-issue row without an issue");
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
