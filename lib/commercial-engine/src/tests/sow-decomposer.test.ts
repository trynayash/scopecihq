import assert from "node:assert";
import { SOWDecomposer, extractScopeBoundaries, extractStatedEffort } from "../sow-decomposer.js";
import { checklistFromBaseline, type ScopeChecklistClause } from "../scope-checklist.js";

/**
 * The SOW parser: what it reads as included and excluded, and that no text a
 * visitor can paste into the public demo makes it run for long.
 */

let passed = 0;
const failures: string[] = [];

function scenario(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err: any) {
    failures.push(`${name}: ${err.message}`);
    console.error(`  ✗ FAIL: ${name}`, err);
  }
}

function clauses(markdown: string): ScopeChecklistClause[] {
  return checklistFromBaseline(new SOWDecomposer().decompose(markdown).baseline).clauses;
}

/** Included and excluded items across every clause. */
function scope(markdown: string): { included: string[]; excluded: string[] } {
  const all = clauses(markdown);
  return { included: all.flatMap((c) => c.included), excluded: all.flatMap((c) => c.excluded) };
}

/** Texts that took from seconds to minutes before the patterns were made linear (40,000 characters at most, as the demo allows). */
const PATHOLOGICAL: Record<string, string> = {
  "60 headers then 25,000 spaces": "Excluding:".repeat(60) + "a" + " ".repeat(25_000) + "b",
  "39 lines of 998 spaces": Array.from({ length: 39 }, () => "a" + " ".repeat(998) + "b").join("\n"),
  "39 lines of 998 tabs": Array.from({ length: 39 }, () => "x" + "\t".repeat(998) + "y").join("\n"),
  "3,000 bullet lines that are each a header": "- Excluding:\n".repeat(3000),
  "3,900 headers on one line": "Excluding:".repeat(3900),
  "a budget followed by 39,000 spaces": "## Scope\nBudget:" + " ".repeat(39_000) + "x",
  "a bullet with 39,000 dots": "Excluding:\n- a" + ".".repeat(39_000) + "b",
  "a bullet with 39,000 colons": "Excluding:\n- a" + ":".repeat(39_000) + "b",
  "a clause number, 39,000 spaces and a lone carriage return": "## 1.1" + " ".repeat(39_000) + "\rx",
  "a heading, 39,000 spaces and a line separator": "## a" + " ".repeat(39_000) + " x",
  "runs of spaces before 'in'": (" ".repeat(1000) + "in").repeat(39),
  "'not' and 1,000 spaces before 'in scope:'": ("not" + " ".repeat(1000) + "in scope:").repeat(39),
  "'x is ' repeated": "x is ".repeat(8000),
  "a header followed by 39,000 spaces and a comma": "Excluding: a," + " ".repeat(39_000) + "b",
  "7,900 short bullets": "Exclusions:\n" + "- ab\n".repeat(7900),
  "2,400 scope headings": "## 1.1 A\n" + "## Out of Scope\n".repeat(2400),
};

function run() {
  console.log("\nScopeCI — SOW parser\n");

  // Warm up once, so the timings below measure parsing rather than start-up.
  new SOWDecomposer().decompose("## 1.1 Warm up\nIncludes a cart.\n\nOut of scope:\n- Gift cards");

  for (const [name, text] of Object.entries(PATHOLOGICAL)) {
    scenario(`Parses ${name} in under 200 ms`, () => {
      assert.ok(text.length <= 40_000, `${text.length} characters`);
      const started = performance.now();
      try {
        new SOWDecomposer().decompose(text);
      } catch {
        // Some of these hold no clause; only the time matters here.
      }
      const elapsed = performance.now() - started;
      assert.ok(elapsed < 200, `took ${Math.round(elapsed)} ms`);
    });
  }

  scenario("Reads one long sentence of spaces in under 200 ms", () => {
    const started = performance.now();
    extractScopeBoundaries("x" + " ".repeat(998) + "y is out of scope");
    extractStatedEffort("Budget:" + " ".repeat(39_000) + "x");
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 200, `took ${Math.round(elapsed)} ms`);
  });

  scenario('"Not in scope:" lists exclusions, not inclusions', () => {
    const result = scope("In scope:\n- Product catalog\n- Shopping cart\n\nNot in scope:\n- Gift cards\n- Mobile apps");
    assert.deepStrictEqual(result.included, ["product catalog", "shopping cart"]);
    assert.deepStrictEqual(result.excluded, ["gift cards", "mobile apps"]);
  });

  scenario('"Not in scope:" with the items on the same line', () => {
    assert.deepStrictEqual(scope("Not in scope: gift cards, mobile apps."), { included: [], excluded: ["gift cards", "mobile apps"] });
    assert.deepStrictEqual(scope("NOT IN SCOPE:\n- Gift cards"), { included: [], excluded: ["gift cards"] });
  });

  scenario('"Outside the scope:", "Outside scope:" and "Out-of-scope:" list exclusions', () => {
    for (const header of ["Outside the scope:", "Outside scope:", "Out-of-scope:"]) {
      assert.deepStrictEqual(scope(`${header}\n- Gift cards`), { included: [], excluded: ["gift cards"] }, header);
    }
  });

  scenario('"Not included:" is not also read as "included:"', () => {
    assert.deepStrictEqual(scope("Included:\n- Checkout\n\nNot included:\n- Gift cards"), {
      included: ["checkout"],
      excluded: ["gift cards"],
    });
  });

  scenario('"## In Scope" and "## Out of Scope" headings list their bullets', () => {
    const result = clauses("## In Scope\n- User login\n- Checkout\n## Out of Scope\n- Mobile apps\n- Gift cards");
    assert.deepStrictEqual(
      result.map((c) => [c.title, c.included, c.excluded]),
      [
        ["In Scope", ["user login", "checkout"], []],
        ["Out of Scope", [], ["mobile apps", "gift cards"]],
      ],
    );
  });

  scenario('"## 3. Out of Scope" after numbered clauses is its own clause', () => {
    const result = clauses(
      "## 2.1 Storefront\nIncludes product catalogue.\n## 2.2 Payments\nIncludes Stripe checkout.\n## 3. Out of Scope\n- Mobile apps\n- Gift cards",
    );
    assert.deepStrictEqual(
      result.map((c) => [c.clauseRef, c.included, c.excluded]),
      [
        ["§2.1", ["product catalogue"], []],
        ["§2.2", ["stripe checkout"], []],
        ["§3", [], ["mobile apps", "gift cards"]],
      ],
    );
  });

  scenario('An unnumbered "## Out of Scope" inside a numbered SOW keeps its exclusions', () => {
    const result = scope("## 2.1 Storefront\nIncludes product catalogue.\n## Out of Scope\n- Mobile apps");
    assert.deepStrictEqual(result.excluded, ["mobile apps"]);
  });

  scenario('"**Not included**", "## Out of Scope:" and "## Exclusions" headings are read', () => {
    assert.deepStrictEqual(scope("**Not included**\n- Mobile apps").excluded, ["mobile apps"]);
    assert.deepStrictEqual(scope("## Out of Scope:\n- Mobile apps").excluded, ["mobile apps"]);
    assert.deepStrictEqual(scope("## Scope\nWe build it.\n\n## Exclusions\n\n- Hosting\n- Email").excluded, ["hosting", "email"]);
  });

  scenario("A second list header after a blank line still reads its own bullets", () => {
    assert.deepStrictEqual(scope("Exclusions:\n\n- Gift cards\n\nOut of scope:\n\n- Mobile apps").excluded, [
      "gift cards",
      "mobile apps",
    ]);
  });

  scenario("Existing wording reads as before", () => {
    const result = clauses(
      "# SOW\n\n## §3.1 Storefront and Checkout\nProduct catalogue and Stripe checkout.\n\n**Explicit Inclusions**:\n- Product catalogue and search\n- Shopping cart\n\n**Explicit Exclusions**:\n- Loyalty points programme\n- Gift cards\n\nMulti-currency pricing and SMS alerts are explicitly out of scope.",
    );
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].included, ["product catalogue and search", "shopping cart"]);
    assert.deepStrictEqual(result[0].excluded, ["loyalty points programme", "gift cards", "multi-currency pricing", "sms alerts"]);
    assert.deepStrictEqual(scope("## Scope\nThe portal explicitly excludes native mobile apps.").excluded, ["native mobile apps"]);
  });

  scenario("Stated budgets and hours are read with or without a currency", () => {
    assert.strictEqual(extractStatedEffort("Budget: $7,500").budgetAllocated, 7500);
    assert.strictEqual(extractStatedEffort("Fee: USD 1,200").budgetAllocated, 1200);
    assert.strictEqual(extractStatedEffort("Budget: € 900").budgetAllocated, 900);
    assert.strictEqual(extractStatedEffort("Budget: 450").budgetAllocated, 450);
    assert.deepStrictEqual(extractStatedEffort("Estimated hours: 40-60").estimatedHours, { min: 40, max: 60 });
  });

  scenario("An exception stays with its item, and bracketed examples aren't split off", () => {
    assert.deepStrictEqual(
      scope("## Scope\nThird-party integrations other than Stripe and SendGrid are out of scope.").excluded,
      ["third-party integrations other than stripe and sendgrid"],
    );
    assert.deepStrictEqual(
      scope("## Scope\nExcluded: social login (Google, Facebook), native apps.").excluded,
      ["social login (google, facebook)", "native apps"],
    );
    assert.deepStrictEqual(
      scope("## Scope\nExcluded: payment providers except PayPal; SMS alerts and push notifications.").excluded,
      ["payment providers except paypal", "sms alerts", "push notifications"],
    );
  });

  scenario("Splitting a long list stays fast", () => {
    const started = Date.now();
    scope(`## Scope\nExcluded: ${"(".repeat(5_000)}${"a, ".repeat(5_000)} and b other than c.`);
    assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`);
  });

  console.log(`\nSOW parser: ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

run();
