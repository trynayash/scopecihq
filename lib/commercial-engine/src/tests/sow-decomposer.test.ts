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
  "2,400 exceptions in one list": "## Scope\nExcluded: " + "a other than b, ".repeat(2400),
  "2,000 bracketed exceptions in one list": "## Scope\nExcluded: " + "x (other than y), ".repeat(2000),
  "'will' and 39,000 spaces before 'not include'": "## 1.1 A\nwill" + " ".repeat(39_000) + "not include x",
  "'as' and 39,000 spaces before 'well'": "Excluding: as" + " ".repeat(39_000) + "well",
  "a comma and 39,000 spaces before 'other than'": "Excluding: a," + " ".repeat(39_000) + "other than b",
  "a comma and 39,000 spaces before 'save for'": "Excluding: a," + " ".repeat(39_000) + "save for X",
  "2,000 unclosed brackets with exceptions": "## 1. Scope\nOut of scope: " + "ab (other than cd, ".repeat(2090),
  "4,990 'x, e.g.' in one list": "## 1.1 Scope\nOut of scope: " + "x, e.g. ".repeat(4990),
  "'e.g.' after 39,000 spaces": "## 1.1 Scope\nOut of scope: x," + " ".repeat(39_000) + "e.g. y",
  "'etc.' before 39,000 spaces": "## 1.1 Scope\nOut of scope: etc." + " ".repeat(39_000) + "x",
  "'Excludes x' and 13,000 '. x'": "## 1.1 Scope\nExcludes x" + ". x".repeat(13_000),
  "'excluded for' and 39,000 spaces": "## Scope\nexcluded for a" + " ".repeat(39_000) + "b",
  "'Out of scope (' and 39,000 letters": "## Scope\nout of scope (" + "x".repeat(39_000),
  "3,000 numbered lines under '4. Exclusions'": ("## 1.1 A\nIncludes a cart.\n4. Exclusions\n" + Array.from({ length: 3000 }, (_, i) => `4.${i + 1} Gift card item ${i}.`).join("\n")).slice(0, 40_000),
  "a numbered title of 39,000 spaces": "4. Exclusions\n4.1" + " ".repeat(39_000) + "x.",
  "a bullet of 2,480 exceptions": ("## 1.1 S\nExclusions:\n- " + "a other than b, ".repeat(2480)).slice(0, 40_000),
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

  scenario("An exception ends at the next comma, so the items listed after it stay exclusions", () => {
    assert.deepStrictEqual(
      scope("## Scope\nExplicitly excludes payment providers other than Stripe, native mobile apps and gift cards.").excluded,
      ["payment providers other than stripe", "native mobile apps", "gift cards"],
    );
    assert.deepStrictEqual(
      extractScopeBoundaries("Explicitly excludes payment providers other than Stripe, native mobile apps, loyalty points and gift cards.").exclusions,
      ["payment providers other than stripe", "native mobile apps", "loyalty points", "gift cards"],
    );
    assert.deepStrictEqual(
      extractScopeBoundaries("**Explicit Exclusions**: integrations other than Stripe, native mobile apps and single sign-on.").exclusions,
      ["integrations other than stripe", "native mobile apps", "single sign-on"],
    );
    assert.deepStrictEqual(
      extractScopeBoundaries("Payment providers other than Stripe, gift cards and native mobile apps are out of scope.").exclusions,
      ["payment providers other than stripe", "gift cards", "native mobile apps"],
    );
    assert.deepStrictEqual(
      extractScopeBoundaries("Excluded: all third-party integrations except Stripe, gift cards, loyalty points.").exclusions,
      ["all third-party integrations except stripe", "gift cards", "loyalty points"],
    );
  });

  scenario("An 'and' list after an exception is still the exception", () => {
    assert.deepStrictEqual(
      extractScopeBoundaries("Explicitly excludes integrations other than Stripe and SendGrid.").exclusions,
      ["integrations other than stripe and sendgrid"],
    );
    assert.deepStrictEqual(
      extractScopeBoundaries("Excluded: payment providers other than Stripe and PayPal, gift cards, analytics except Plausible and Fathom.").exclusions,
      ["payment providers other than stripe and paypal", "gift cards", "analytics except plausible and fathom"],
    );
  });

  scenario("A bracketed exception ends with its bracket and reads as one item", () => {
    assert.deepStrictEqual(scope("## Scope\nExcluded: third-party integrations (other than Stripe), gift cards.").excluded, [
      "third-party integrations (other than stripe)",
      "gift cards",
    ]);
    assert.deepStrictEqual(
      extractScopeBoundaries("Third-party integrations (other than Stripe), gift cards and loyalty points are out of scope.").exclusions,
      ["third-party integrations (other than stripe)", "gift cards", "loyalty points"],
    );
    assert.deepStrictEqual(extractScopeBoundaries("Excluded: integrations (other than Stripe, SendGrid), gift cards.").exclusions, [
      "integrations (other than stripe, sendgrid)",
      "gift cards",
    ]);
  });

  scenario("'Including but not limited to' is not an exception", () => {
    const parsed = extractScopeBoundaries("Excludes: CRM integrations including but not limited to Salesforce and HubSpot.").exclusions;
    assert.ok(parsed.includes("hubspot"), JSON.stringify(parsed));
    const restricted = extractScopeBoundaries("Excludes: CRM integrations including but not restricted to Salesforce and HubSpot.").exclusions;
    assert.ok(restricted.includes("hubspot"), JSON.stringify(restricted));
    const predicate = extractScopeBoundaries(
      "All other third-party integrations, including but not limited to Salesforce and HubSpot, are out of scope.",
    ).exclusions;
    assert.ok(predicate.includes("hubspot"), JSON.stringify(predicate));
    // A real "but not" still keeps its exception with the item.
    assert.deepStrictEqual(extractScopeBoundaries("Excluded: payment providers but not Stripe.").exclusions, [
      "payment providers but not stripe",
    ]);
  });

  scenario("Splitting a long list stays fast", () => {
    const started = Date.now();
    scope(`## Scope\nExcluded: ${"(".repeat(5_000)}${"a, ".repeat(5_000)} and b other than c.`);
    assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`);
  });

  scenario("An exception in brackets ends with its bracket", () => {
    assert.deepStrictEqual(
      scope("## Scope\nThird-party integrations (other than Stripe) and gift cards are out of scope.").excluded,
      ["third-party integrations (other than stripe)", "gift cards"],
    );
  });

  /* Contract wording read the way it is written: one scenario per confirmed wrong parse. */

  scenario("1. 'will not include', 'shall not include', 'won't' and 'doesn’t include' are exclusions, never inclusions", () => {
    assert.deepStrictEqual(extractScopeBoundaries("Phase 1 will not include gift cards or loyalty points."), {
      inclusions: [],
      exclusions: ["gift cards or loyalty points"],
    });
    assert.deepStrictEqual(extractScopeBoundaries("This SOW won’t include gift cards.").exclusions, ["gift cards"]);
    assert.deepStrictEqual(extractScopeBoundaries("This SOW doesn't include gift cards.").exclusions, ["gift cards"]);
    assert.deepStrictEqual(extractScopeBoundaries("The Services shall not include gift cards or loyalty points.").inclusions, []);
    // Requirements, not scope: neither included nor excluded.
    assert.deepStrictEqual(extractScopeBoundaries("Error pages should not include stack traces."), { inclusions: [], exclusions: [] });
    assert.deepStrictEqual(extractScopeBoundaries("Error pages must not include stack traces."), { inclusions: [], exclusions: [] });
  });

  scenario("2 and 15. 'e.g.', 'i.e.', 'etc.' and '2.1' end neither the list nor the sentence", () => {
    assert.deepStrictEqual(extractScopeBoundaries("Out of scope: CRM integrations (e.g. Salesforce), gift cards and loyalty points.").exclusions, [
      "crm integrations (salesforce)",
      "gift cards",
      "loyalty points",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Gift cards, loyalty points, etc. are out of scope.").exclusions, ["gift cards", "loyalty points", "etc"]);
    assert.deepStrictEqual(extractScopeBoundaries("Out of scope: social login, e.g. Google, Facebook, Apple.").exclusions, [
      "social login (google, facebook, apple)",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Excludes native mobile apps (i.e. iOS and Android), gift cards and loyalty points.").exclusions, [
      "native mobile apps (ios and android)",
      "gift cards",
      "loyalty points",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Excludes WCAG 2.1 AA compliance, gift cards and loyalty points.").exclusions, [
      "wcag 2.1 aa compliance",
      "gift cards",
      "loyalty points",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("WCAG 2.1 AA compliance and gift cards are out of scope.").exclusions, [
      "wcag 2.1 aa compliance",
      "gift cards",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Out of scope: v2.0 redesign, gift cards and loyalty points.").exclusions, [
      "v2.0 redesign",
      "gift cards",
      "loyalty points",
    ]);
  });

  scenario("3. ', except', ', other than', ', but not' and 'as well as' keep the list and the exception", () => {
    assert.deepStrictEqual(extractScopeBoundaries("Payment providers, other than Stripe, are out of scope.").exclusions, [
      "payment providers other than stripe",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Excludes payment providers, except for Stripe.").exclusions, ["payment providers except for stripe"]);
    assert.deepStrictEqual(extractScopeBoundaries("Out of scope: payment providers, except for Stripe, gift cards and loyalty points.").exclusions, [
      "payment providers except for stripe",
      "gift cards",
      "loyalty points",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Out of scope: native mobile apps, as well as gift cards and loyalty points.").exclusions, [
      "native mobile apps",
      "gift cards",
      "loyalty points",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Out of scope: hosting, as agreed with the Client.").exclusions, ["hosting"]);
    assert.deepStrictEqual(extractScopeBoundaries("Payment providers, save for Stripe, are excluded.").exclusions, [
      "payment providers except for stripe",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Out of scope: save for later, wishlists.").exclusions, ["save for later", "wishlists"]);
  });

  scenario("6. numbered legal sub-clauses keep their text", () => {
    assert.deepStrictEqual(
      clauses("## 1.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\n\n## 2. Exclusions\n2.1 Gift cards are out of scope.\n2.2 Loyalty points are excluded.\n").map(
        (c) => [c.clauseRef, c.excluded],
      ),
      [["§1.1", []], ["§2", []], ["§2.1", ["gift cards"]], ["§2.2", ["loyalty points"]]],
    );
    assert.deepStrictEqual(
      scope("Statement of Work\n\n3. Deliverables\n3.1 Storefront\nThe Agency will deliver a product catalogue, shopping cart and Stripe checkout.\n\n4. Exclusions\n4.1 Gift card functionality.\n4.2 Loyalty points programme.\n5. Fees and Payment\nFees are payable monthly.\n").excluded,
      ["gift card functionality", "loyalty points programme"],
    );
    assert.deepStrictEqual(scope("## 1.1 Storefront\nIncludes a cart.\n\n## 1.2 Out of scope\n1.2.1 Gift cards.\n1.2.2 Loyalty points.\n").excluded, [
      "gift cards",
      "loyalty points",
    ]);
    assert.deepStrictEqual(scope("## 1.1 Storefront\nIncludes a cart.\n1.2 The Services do not include gift cards or loyalty points.").excluded, [
      "gift cards or loyalty points",
    ]);
    assert.deepStrictEqual(scope("## 1.1 Storefront\nIncludes a cart.\nSection 1.2 Gift cards and loyalty points are out of scope.\n").excluded, [
      "gift cards",
      "loyalty points",
    ]);
  });

  scenario("7. what an included item leaves out is excluded", () => {
    assert.deepStrictEqual(extractScopeBoundaries("Includes payment by card via Stripe, excluding PayPal."), {
      inclusions: ["payment by card via stripe excluding paypal"],
      exclusions: ["paypal"],
    });
    assert.deepStrictEqual(extractScopeBoundaries("Includes email notifications, but not SMS notifications.").exclusions, ["sms notifications"]);
    assert.deepStrictEqual(extractScopeBoundaries("Includes integration with all payment providers other than PayPal.").exclusions, ["paypal"]);
    assert.deepStrictEqual(extractScopeBoundaries("Includes hosting setup, except as agreed in writing.").exclusions, []);
  });

  scenario("12. common exclusion headings and predicates are read", () => {
    assert.deepStrictEqual(scope("## 2.1 Exclusions\nThe following items are excluded from this SOW:\n- Gift cards").excluded, ["gift cards"]);
    assert.deepStrictEqual(
      clauses("## 2.1 Storefront\nIncludes a cart.\n## 3. Scope Exclusions\n- Gift cards").map((c) => [c.clauseRef, c.excluded]),
      [["§2.1", []], ["§3", ["gift cards"]]],
    );
    assert.deepStrictEqual(extractScopeBoundaries("Out of scope for Phase 1 (may be quoted separately): gift cards, loyalty points.").exclusions, [
      "gift cards",
      "loyalty points",
    ]);
    for (const heading of ["## Out-of-Scope Items", "**Out of Scope (Phase 2):**", "Out of scope -", "## What's not included", "## Excluded Services", "Not included in this SOW:"]) {
      assert.deepStrictEqual(scope(`${heading}\n- Gift cards`).excluded, ["gift cards"], heading);
    }
    for (const sentence of [
      "Gift cards are outside the scope of this SOW.",
      "Gift cards will not be included.",
      "Gift cards shall be excluded.",
      "Gift cards fall outside the scope of this engagement.",
    ]) {
      assert.deepStrictEqual(extractScopeBoundaries(sentence).exclusions, ["gift cards"], sentence);
    }
    // Product behaviour and assumptions are not exclusions.
    assert.deepStrictEqual(extractScopeBoundaries("Out-of-stock products will not be included in search results.").exclusions, []);
    assert.deepStrictEqual(extractScopeBoundaries("Draft orders shall be excluded from the sales report.").exclusions, []);
    assert.deepStrictEqual(scope("## Assumptions and Exclusions\n- The Client will supply Stripe API credentials").excluded, []);
  });

  scenario("16. ', including, but not limited to,' keeps its examples", () => {
    assert.deepStrictEqual(extractScopeBoundaries("Excludes CRM integrations, including, but not limited to, Salesforce and HubSpot.").exclusions, [
      "crm integrations",
      "salesforce",
      "hubspot",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Excludes CRM integrations, e.g. Salesforce and HubSpot.").exclusions, [
      "crm integrations (salesforce and hubspot)",
    ]);
  });

  scenario("18. a bracket that never closes reads as if it were not there", () => {
    assert.deepStrictEqual(extractScopeBoundaries("Out of scope: payment providers (other than Stripe, gift cards and loyalty points.").exclusions, [
      "payment providers other than stripe",
      "gift cards",
      "loyalty points",
    ]);
    assert.deepStrictEqual(extractScopeBoundaries("Excluded: integrations (other than Stripe, SendGrid), gift cards.").exclusions, [
      "integrations (other than stripe, sendgrid)",
      "gift cards",
    ]);
  });

  scenario("19. a typographic hyphen in a pasted item is saved as '-'", () => {
    assert.deepStrictEqual(scope("**Explicit Exclusions**:\n- Multi\u2011currency pricing\n- Two\u2010factor authentication").excluded, [
      "multi-currency pricing",
      "two-factor authentication",
    ]);
  });

  console.log(`\nSOW parser: ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

run();
