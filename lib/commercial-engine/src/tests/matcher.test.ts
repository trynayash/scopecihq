/**
 * Contract matching regression tests.
 *
 * Each block pins one way the matcher used to get a verdict wrong, next to
 * the true positives the fix must keep. Plain script: run it with tsx; it
 * exits non-zero when anything fails.
 */
import assert from "node:assert";
import { CapabilityExtractor } from "../capability-extractor.js";
import { composeChangeOrder, draftChangeOrder } from "../change-order.js";
import { matchContractPhrases, tokenize } from "../contract-matcher.js";
import { evaluateCommercialScope } from "../evaluator.js";
import { describeEstimate } from "../formatter.js";
import { baselineFromChecklist } from "../scope-checklist.js";
import type { ChangedFile, CommercialEvaluation, LinearIssue, PullRequest, ScopeBaseline } from "../types.js";
import { pullRequestAsWorkItem } from "../work-item.js";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Clause = { title?: string; included?: string[]; excluded?: string[] };

function scope(...clauses: Clause[]): ScopeBaseline {
  return baselineFromChecklist({
    title: "Statement of Work",
    clauses: clauses.map((c, i) => ({
      clauseRef: `§${i + 1}`,
      title: c.title ?? "Scope",
      included: c.included ?? [],
      excluded: c.excluded ?? [],
    })),
  });
}

/** The /try sample SOW, as its checklist reads after parsing. */
const STORE = scope({
  title: "Storefront and Checkout",
  included: ["product catalogue and search", "shopping cart", "stripe checkout"],
  excluded: ["loyalty points programme", "multi-currency pricing", "gift cards"],
});

/** Files as "path" (added) or ["path", status]. */
type FileSpec = string | [string, NonNullable<ChangedFile["status"]>];

function pr(title: string, files: FileSpec[], extra: { branch?: string; body?: string } = {}): PullRequest {
  const changedFiles = files.map((spec): ChangedFile => {
    const [path, status] = typeof spec === "string" ? [spec, "added" as const] : spec;
    return { path, status, module: path.split("/")[0] || "root", additions: 10, deletions: 0 };
  });
  return {
    id: "pr_test",
    number: 7,
    title,
    body: extra.body,
    branch: extra.branch,
    filesChanged: changedFiles.length,
    additions: 10 * changedFiles.length,
    deletions: 0,
    changedFiles,
  };
}

/** Evaluates as the webhook does for a pull request with no linked issue. */
function evaluate(baseline: ScopeBaseline, pullRequest: PullRequest, issue?: LinearIssue): CommercialEvaluation {
  return evaluateCommercialScope({
    baseline,
    pullRequest,
    issue: issue ?? pullRequestAsWorkItem(),
    policyMode: "REVIEW",
  });
}

function expectState(baseline: ScopeBaseline, pullRequest: PullRequest, expected: string, issue?: LinearIssue): void {
  const result = evaluate(baseline, pullRequest, issue);
  assert.strictEqual(result.state, expected, `"${pullRequest.title}": ${result.state}: ${result.detectedDelta.join(" | ")}`);
}

function expectNotExcluded(baseline: ScopeBaseline, pullRequest: PullRequest): void {
  const result = evaluate(baseline, pullRequest);
  assert.notStrictEqual(
    result.state,
    "CHANGE_REQUIRED",
    `"${pullRequest.title}" should not need a change order: ${result.detectedDelta.join(" | ")}`,
  );
  assert.strictEqual(draftChangeOrder({ evaluation: result, pullRequestTitle: pullRequest.title }), undefined);
}

function capabilitiesOf(...paths: string[]): string[] {
  const result = new CapabilityExtractor().extract({ pullRequest: pr("x", paths) });
  return result.capabilities.map((c) => c.name).sort();
}

function time(fn: () => void): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

console.log("\nScopeCI — contract matching\n");

/* ------------------------------------------------------------------ */
/* Object.prototype names in pull request text                          */
/* ------------------------------------------------------------------ */
console.log("▶ Object.prototype names are ordinary words");

test("tokenize reads constructor, __proto__ and toString as words", () => {
  const tokens = tokenize("constructor Constructor ConstructorArgs fix/constructor-args __proto__ toString valueOf hasOwnProperty");
  for (const token of tokens) assert.strictEqual(typeof token, "string", `token ${String(token)}`);
  assert.ok(tokens.has("constructor"));
  assert.ok(tokens.has("proto"));
});

test("a pull request about a constructor is evaluated, not crashed", () => {
  const pullRequest = pr("Fix CartService constructor", ["src/constructor.ts", "src/cart/CartService.ts"], {
    branch: "fix/constructor-args",
    body: "Moves the DB connection out of the CartService constructor. Also touches __proto__ and toString.",
  });
  expectState(STORE, pullRequest, "IN_SCOPE");
});

test("a scope item naming constructor or __proto__ is matched like any other", () => {
  const baseline = scope({ included: ["shopping cart"], excluded: ["constructor injection", "__proto__ pollution", "toString"] });
  expectState(baseline, pr("Constructor injection for services", ["src/di/constructor-injection.ts"]), "CHANGE_REQUIRED");
  expectState(baseline, pr("Fix cart totals", ["src/cart/totals.ts"]), "IN_SCOPE");
});

/* ------------------------------------------------------------------ */
/* Capabilities are read from whole words of a path                     */
/* ------------------------------------------------------------------ */
console.log("\n▶ Capabilities come from whole words, not substrings");

test("processor, association, lesson and reset.css name no capability", () => {
  assert.deepStrictEqual(capabilitiesOf("src/checkout/payment-processor.ts"), []);
  assert.deepStrictEqual(capabilitiesOf("src/images/image-processor.ts"), []);
  assert.deepStrictEqual(capabilitiesOf("src/cart/associations.ts"), []);
  assert.deepStrictEqual(capabilitiesOf("src/courses/lesson.ts"), []);
  assert.deepStrictEqual(capabilitiesOf("src/styles/reset.css"), []);
  assert.deepStrictEqual(capabilitiesOf("src/presets/preset.ts"), []);
  assert.deepStrictEqual(capabilitiesOf("src/checkout/create-session.ts"), []);
  assert.deepStrictEqual(capabilitiesOf("src/catalog/CatalogIndex.tsx"), []);
  assert.deepStrictEqual(capabilitiesOf("src/blog/BlogIndex.tsx"), []);
  assert.deepStrictEqual(capabilitiesOf("docs/design-instructions.md"), []);
});

test("real auth, reset, SSO, RBAC and invitation paths still name their capability", () => {
  assert.deepStrictEqual(capabilitiesOf("src/auth/session.ts"), ["authentication"]);
  assert.deepStrictEqual(capabilitiesOf("src/components/SignInForm.tsx"), ["authentication"]);
  assert.deepStrictEqual(capabilitiesOf("src/routes/login.ts"), ["authentication"]);
  assert.ok(capabilitiesOf("src/routes/auth/reset.ts").includes("password_reset"));
  assert.ok(capabilitiesOf("src/views/reset-password.tsx").includes("password_reset"));
  assert.ok(capabilitiesOf("src/auth/forgot-password.ts").includes("password_reset"));
  assert.deepStrictEqual(capabilitiesOf("src/auth/saml-parser.ts"), ["enterprise_sso_saml"]);
  assert.deepStrictEqual(capabilitiesOf("src/routes/sso.ts"), ["enterprise_sso_saml"]);
  assert.deepStrictEqual(capabilitiesOf("src/auth/SSOProvider.tsx"), ["enterprise_sso_saml"]);
  assert.deepStrictEqual(capabilitiesOf("src/db/migrations/20260905_memberships.sql"), ["organization_rbac"]);
  assert.deepStrictEqual(capabilitiesOf("src/db/migrations/004_tenant_tables.sql"), ["organization_rbac"]);
  assert.deepStrictEqual(capabilitiesOf("src/db/schema/organizations.ts"), ["organization_rbac"]);
  assert.deepStrictEqual(capabilitiesOf("src/auth/permissions.ts"), ["organization_rbac"]);
  assert.deepStrictEqual(capabilitiesOf("src/routes/invitations.ts"), ["team_invitations"]);
  assert.deepStrictEqual(capabilitiesOf("src/team/invite-email.ts"), ["team_invitations"]);
});

test("the /try sample: checkout sessions, payment processors and reset.css stay in scope", () => {
  expectState(STORE, pr("Create Stripe checkout session", ["src/checkout/create-session.ts"]), "IN_SCOPE");
  expectState(STORE, pr("Payment processor retries for Stripe checkout", ["src/checkout/payment-processor.ts"]), "IN_SCOPE");
  expectState(STORE, pr("Fix cart quantity rounding", ["src/checkout/cart.ts", ["src/styles/reset.css", "modified"]]), "IN_SCOPE");
  expectState(STORE, pr("Product catalogue index page", ["src/catalog/CatalogIndex.tsx"]), "IN_SCOPE");
});

test("with SSO excluded, image processors and associations are not SSO work", () => {
  const baseline = scope({ included: ["product catalogue", "shopping cart"], excluded: ["single sign-on (sso)"] });
  expectNotExcluded(baseline, pr("Resize product images", ["src/catalog/image-processor.ts"]));
  expectNotExcluded(baseline, pr("Cart item associations", ["src/cart/associations.ts"]));
  // True positive kept: real SSO code is still excluded.
  expectState(baseline, pr("Add SAML login", ["src/auth/saml.ts"]), "CHANGE_REQUIRED");
  expectState(baseline, pr("Okta sign-in", ["src/auth/sso/okta.ts"]), "CHANGE_REQUIRED");
});

test("issue text: 'processor' is not SSO and 'organizational' is not RBAC", () => {
  const baseline = scope({ included: ["shopping cart"], excluded: ["enterprise sso", "organization rbac"] });
  const issue: LinearIssue = {
    id: "HP-1",
    title: "Retry failed charges in the payment processor",
    description: "An organizational note: lessons learned from the cart.",
    status: "Open",
  };
  const result = evaluate(baseline, pr("Retry failed cart charges", ["src/cart/charges.ts"]), issue);
  assert.notStrictEqual(result.state, "CHANGE_REQUIRED", result.detectedDelta.join(" | "));
  const ssoIssue: LinearIssue = { id: "HP-2", title: "Add SAML single sign-on", status: "Open" };
  assert.strictEqual(evaluate(baseline, pr("Cart SAML hook", ["src/cart/hook.ts"]), ssoIssue).state, "CHANGE_REQUIRED");
});

/* ------------------------------------------------------------------ */
/* An exclusion only names a capability with all of its words           */
/* ------------------------------------------------------------------ */
console.log("\n▶ Exclusions name a capability only with all their words");

const AUTH = scope({
  title: "Accounts",
  included: ["email and password login", "password reset", "team invitations"],
  excluded: ["two-factor authentication", "invitations via sms"],
});

test("excluding two-factor authentication leaves login, reset and sessions in scope", () => {
  expectState(AUTH, pr("Fix login validation", ["src/auth/login.ts"]), "IN_SCOPE");
  expectState(AUTH, pr("Password reset email", ["src/auth/password-reset.ts"]), "IN_SCOPE");
  expectNotExcluded(AUTH, pr("Session expiry", ["src/session/expiry.ts"]));
});

test("excluding invitations via SMS leaves email invitations in scope", () => {
  expectState(AUTH, pr("Email invites for team members", ["src/team/invite-email.ts"]), "IN_SCOPE");
});

test("the excluded variants themselves are still excluded", () => {
  expectState(AUTH, pr("Add TOTP two-factor", ["src/auth/two-factor.ts"]), "CHANGE_REQUIRED");
  expectState(AUTH, pr("SMS invites", ["src/invitations/sms.ts"]), "CHANGE_REQUIRED");
});

test("exclusions written around a capability still catch it", () => {
  const cases: Array<[string, string, string]> = [
    ["saml-based single sign-on", "Add SAML", "src/auth/saml/sso.ts"],
    ["multi-tenant organization rbac", "Org permissions", "src/organization/permissions.ts"],
    ["role-based access control (rbac)", "Roles", "src/rbac/roles.ts"],
    ["enterprise sso", "SSO", "src/auth/sso.ts"],
    ["organization rbac", "Roles", "src/organization/roles.ts"],
    ["team invitations", "Invites", "src/routes/invitations.ts"],
  ];
  for (const [exclusion, title, path] of cases) {
    expectState(scope({ included: ["shopping cart"], excluded: [exclusion] }), pr(title, [path]), "CHANGE_REQUIRED");
  }
});

/* ------------------------------------------------------------------ */
/* Qualifiers belong to an exclusion                                    */
/* ------------------------------------------------------------------ */
console.log("\n▶ Qualifiers (multi, advanced, custom, enterprise) are part of an exclusion");

test("single-currency price work is not multi-currency pricing", () => {
  expectState(STORE, pr("Fix GBP price rounding on product pages", ["src/pricing/currency.ts"]), "IN_SCOPE");
  expectNotExcluded(STORE, pr("Show prices with currency symbol", ["src/catalogue/price-label.tsx"]));
  expectNotExcluded(STORE, pr("Format GBP prices", ["src/lib/formatCurrency.ts"]));
  expectState(STORE, pr("Add multi-currency pricing", ["src/pricing/multi-currency.ts"]), "CHANGE_REQUIRED");
});

test("basic search is not advanced search; standard reports are not custom reports", () => {
  const search = scope({ included: ["basic keyword search"], excluded: ["advanced search"] });
  expectState(search, pr("Fix keyword search pagination", ["src/search/keyword.ts"]), "IN_SCOPE");
  expectState(search, pr("Advanced search filters", ["src/search/advanced-filters.ts"]), "CHANGE_REQUIRED");

  const reports = scope({ included: ["standard sales reports"], excluded: ["custom reports"] });
  expectState(reports, pr("Fix date range on monthly sales report", ["src/reports/sales.ts"]), "IN_SCOPE");
  expectState(reports, pr("Custom report builder", ["src/reports/custom-builder.ts"]), "CHANGE_REQUIRED");
});

test("enterprise reporting is not the reporting the SOW includes", () => {
  const baseline = scope({ included: ["reporting dashboard"], excluded: ["enterprise reporting"] });
  expectState(baseline, pr("Fix reporting date filter", ["src/reporting/filters.ts"]), "IN_SCOPE");
  expectState(baseline, pr("Enterprise reporting exports", ["src/reporting/enterprise.ts"]), "CHANGE_REQUIRED");
});

test("a qualifier on its own never decides an exclusion", () => {
  const baseline = scope({ included: ["shopping cart"], excluded: ["custom integrations"] });
  expectState(baseline, pr("Add custom styling to cart", ["src/cart/custom-styles.ts"]), "IN_SCOPE");
  expectState(baseline, pr("Custom integrations for Slack", ["src/slack/hook.ts"]), "CHANGE_REQUIRED");
});

/* ------------------------------------------------------------------ */
/* Exceptions inside an item                                            */
/* ------------------------------------------------------------------ */
console.log("\n▶ Exceptions (other than, except, examples in brackets)");

test("'payment providers other than stripe' does not exclude Stripe work", () => {
  const baseline = scope({ included: ["stripe checkout", "payment webhooks"], excluded: ["payment providers other than stripe"] });
  expectState(baseline, pr("Retry failed Stripe payment webhooks", ["src/payments/stripe-webhook.ts"]), "IN_SCOPE");
  expectNotExcluded(baseline, pr("Stripe provider config", ["src/payments/providers/stripe.ts"]));
  expectState(baseline, pr("Add PayPal payment provider", ["src/payments/paypal-provider.ts"]), "CHANGE_REQUIRED");
});

test("'third-party integrations other than stripe and sendgrid' does not exclude SendGrid", () => {
  const baseline = scope({
    included: ["sendgrid transactional email"],
    excluded: ["third-party integrations other than stripe and sendgrid"],
  });
  expectState(baseline, pr("Send order receipts via SendGrid", ["src/email/sendgrid-receipts.ts"]), "IN_SCOPE");
  expectState(baseline, pr("Add third-party Mailchimp integration", ["src/integrations/third-party/mailchimp.ts"]), "CHANGE_REQUIRED");
});

test("'except' and 'apart from' cut the exception off", () => {
  const baseline = scope({ included: ["stripe checkout"], excluded: ["payment gateways except stripe", "analytics apart from plausible"] });
  expectNotExcluded(baseline, pr("Stripe gateway timeout fix", ["src/payments/stripe-gateway.ts"]));
  expectNotExcluded(baseline, pr("Plausible analytics script", ["src/analytics/plausible.ts"]));
  expectState(baseline, pr("Add Adyen payment gateway", ["src/payments/adyen-gateway.ts"]), "CHANGE_REQUIRED");
});

test("bracketed examples need the word they qualify", () => {
  const baseline = scope({ included: ["email login"], excluded: ["social login (google, facebook)", "gift cards"] });
  expectNotExcluded(baseline, pr("Add Google Analytics tag", ["src/analytics/google-analytics.ts"]));
  expectState(baseline, pr("Add Facebook login button", ["src/auth/facebook-login.ts"]), "CHANGE_REQUIRED");
  expectState(baseline, pr("Add gift card redemption", ["src/giftcards/redeem.ts"]), "CHANGE_REQUIRED");
});

test("included examples and exceptions work the same way", () => {
  const social = scope({ included: ["social login (google, facebook)"] });
  expectState(social, pr("Fix Google login redirect", ["src/social/google.ts"]), "IN_SCOPE");
  expectState(social, pr("Add Google Analytics tag", ["src/analytics/google-analytics.ts"]), "REVIEW_REQUIRED");
  const providers = scope({ included: ["payment providers except paypal"] });
  expectState(providers, pr("Adyen payment provider", ["src/payments/adyen-provider.ts"]), "IN_SCOPE");
  expectState(providers, pr("Add PayPal payment provider", ["src/payments/paypal-provider.ts"]), "REVIEW_REQUIRED");
});

test("a bracketed abbreviation stands on its own", () => {
  const baseline = scope({ included: ["shopping cart"], excluded: ["search engine optimisation (seo)"] });
  expectState(baseline, pr("SEO meta tags", ["src/seo/meta.ts"]), "CHANGE_REQUIRED");
});

/* ------------------------------------------------------------------ */
/* An exclusion's words must be found together                          */
/* ------------------------------------------------------------------ */
console.log("\n▶ An exclusion's words are found together, not across unrelated files");

test("gift wrapping plus a card payment form is not gift cards", () => {
  expectNotExcluded(
    STORE,
    pr("Add gift wrapping option to Stripe checkout", ["src/checkout/gift-wrap.tsx", "src/checkout/card-payment-form.tsx"]),
  );
  expectNotExcluded(STORE, pr("Gift wrapping", ["src/components/CardInput.tsx"]));
});

test("store-locator points plus a loyalty terms link is not a loyalty programme", () => {
  expectNotExcluded(
    STORE,
    pr("Fix cart totals", ["src/store-locator/points.ts", "src/legal/loyalty-terms-link.tsx", "src/checkout/cart.ts"]),
  );
});

test("a spread match is a question for a person, and says why", () => {
  const result = evaluate(
    STORE,
    pr("Add gift wrapping option", ["src/checkout/gift-wrap.tsx", "src/checkout/card-payment-form.tsx"]),
  );
  assert.strictEqual(result.state, "REVIEW_REQUIRED", result.detectedDelta.join(" | "));
  assert.ok(
    result.detectedDelta.some((d) => d.includes("separate places")),
    result.detectedDelta.join(" | "),
  );
});

test("gift cards and loyalty work named in one file or the title is still excluded", () => {
  expectState(STORE, pr("Gift card redemption", ["src/giftcards/redeem.ts"]), "CHANGE_REQUIRED");
  expectState(STORE, pr("Loyalty points", ["src/loyalty/points.ts"]), "CHANGE_REQUIRED");
  expectState(STORE, pr("Gift cards", ["src/checkout/summary.tsx"]), "CHANGE_REQUIRED");
  expectState(STORE, pr("Checkout tweaks", ["src/checkout/summary.tsx"], { branch: "feat/gift-cards" }), "CHANGE_REQUIRED");
});

/* ------------------------------------------------------------------ */
/* Exclusions made only of generic words                                */
/* ------------------------------------------------------------------ */
console.log("\n▶ Exclusions made of generic words are matched as phrases");

const MIGRATION = scope({
  included: ["product catalog", "shopping cart"],
  excluded: ["data migration", "user management", "integrations"],
});

test("data migration and user management work is excluded", () => {
  expectState(
    MIGRATION,
    pr("Data migration: import legacy product catalog", [
      "scripts/data-migration/import-catalog.ts",
      "src/migrations/0007_import_legacy_products.sql",
    ]),
    "CHANGE_REQUIRED",
  );
  expectState(MIGRATION, pr("User management screen", ["src/users/user-management.tsx"]), "CHANGE_REQUIRED");
  expectState(MIGRATION, pr("Admin screens", ["src/admin/UserManagement.tsx"]), "CHANGE_REQUIRED");
  expectState(MIGRATION, pr("Catalog import", ["src/catalog/import.ts"], { branch: "feat/data-migration" }), "CHANGE_REQUIRED");
});

test("the same words apart are not that work", () => {
  expectNotExcluded(MIGRATION, pr("Shopping cart table", ["src/db/migrations/0012_cart.sql", "src/data/cart.ts"]));
  expectNotExcluded(MIGRATION, pr("Shopping cart: show the signed-in user", ["src/state/user-store.ts", "src/cart/management.ts"]));
  expectNotExcluded(MIGRATION, pr("Shopping cart integration tests", ["tests/integration/cart.test.ts"]));
  expectNotExcluded(MIGRATION, pr("Fix cart data loading after migration", ["src/cart/load.ts"]));
  expectNotExcluded(MIGRATION, pr("Shopping cart schema", ["src/data/migrations/0003_cart.sql"]));
});

/* ------------------------------------------------------------------ */
/* Docs-only pull requests and removals                                 */
/* ------------------------------------------------------------------ */
console.log("\n▶ Docs-only pull requests and pull requests that remove work");

test("a docs-only or test-only pull request is a question, not a change order", () => {
  expectState(STORE, pr("Document why gift cards are out of scope", ["docs/decisions/gift-cards.md"]), "REVIEW_REQUIRED");
  expectState(STORE, pr("Loyalty tests", ["src/loyalty/points.test.ts"]), "REVIEW_REQUIRED");
  const sso = scope({ included: ["shopping cart"], excluded: ["single sign-on (sso)"] });
  expectState(sso, pr("SSO notes", ["docs/sso.md"]), "REVIEW_REQUIRED");
});

test("removing or reverting excluded work is not excluded work", () => {
  expectNotExcluded(
    STORE,
    pr("Remove gift cards prototype", [["src/giftcards/redeem.ts", "deleted"], ["src/store/nav.tsx", "modified"]]),
  );
  expectNotExcluded(
    STORE,
    pr(
      'Revert "Add loyalty points at checkout"',
      [["src/loyalty/points.ts", "deleted"], ["src/loyalty/rewards-page.tsx", "deleted"], ["src/checkout/cart.ts", "modified"]],
      { branch: "revert-41-feat/hp-12-loyalty-points" },
    ),
  );
  expectNotExcluded(STORE, pr("chore(cart): drop gift cards", [["src/store/nav.tsx", "modified"]]));
  expectNotExcluded(STORE, pr("Removes the loyalty points banner", [["src/checkout/cart.ts", "modified"]]));
});

test("a drop-down is not a removal", () => {
  expectState(STORE, pr("Drop-down to pick gift cards", [["src/checkout/summary.tsx", "modified"]]), "CHANGE_REQUIRED");
});

test("building excluded work is still excluded, including by title alone", () => {
  expectState(
    STORE,
    pr("Add loyalty points at checkout", ["src/loyalty/points.ts", ["src/checkout/cart.ts", "modified"]], {
      branch: "feat/loyalty-points",
    }),
    "CHANGE_REQUIRED",
  );
  expectState(
    STORE,
    pr("Add loyalty points at checkout", [["src/checkout/cart.ts", "modified"]], { branch: "feat/loyalty-points" }),
    "CHANGE_REQUIRED",
  );
});

/* ------------------------------------------------------------------ */
/* Clause titles and capability names                                   */
/* ------------------------------------------------------------------ */
console.log("\n▶ A clause title has to name the whole capability");

test("a title word that is part of a capability name puts nothing in scope", () => {
  const dashboard = scope({ title: "Team Dashboard", included: ["activity feed", "usage charts"] });
  expectState(dashboard, pr("Send invites by email", ["src/invitations/send.ts"]), "REVIEW_REQUIRED");
  const reporting = scope({ title: "Enterprise Reporting", included: ["sales charts"] });
  expectState(reporting, pr("SAML login", ["src/sso/saml.ts"]), "REVIEW_REQUIRED");
  const profile = scope({ title: "Organization Profile", included: ["company logo"] });
  expectState(profile, pr("Roles", ["src/rbac/roles.ts"]), "REVIEW_REQUIRED");
});

test("a title that names the whole capability still puts it in scope", () => {
  const cases: Array<[string, string]> = [
    ["Audit Logging", "src/audit/log.ts"],
    ["Team Invitations", "src/invitations/send.ts"],
    ["Password Reset", "src/password-reset/send.ts"],
    ["Authentication", "src/auth/login.ts"],
  ];
  for (const [title, path] of cases) {
    expectState(scope({ title }), pr("Work", [path]), "IN_SCOPE");
  }
});

/* ------------------------------------------------------------------ */
/* Large inputs                                                         */
/* ------------------------------------------------------------------ */
console.log("\n▶ Large inputs stay fast");

/** Distinct four-letter consonant words: none are stop words or generic. */
function words(count: number, salt: number): string[] {
  const letters = "bcdfghjklmnpqrstvwxz";
  return Array.from({ length: count }, (_, i) => {
    const n = i * 7919 + salt * 104729;
    return [0, 1, 2, 3].map((k) => letters[Math.floor(n / 20 ** k) % 20]).join("");
  });
}

test("a scope of long comma lists against 300 long paths evaluates in well under a second", () => {
  const items = (salt: number) => Array.from({ length: 100 }, (_, i) => words(60, salt * 1000 + i).join(","));
  const baseline = scope({ included: items(1), excluded: items(2) });
  const files = Array.from({ length: 300 }, (_, i) => `src/${words(78, 5000 + i).join("/")}.ts`);
  const elapsed = time(() => evaluate(baseline, pr("Update", files)));
  assert.ok(elapsed < 1500, `took ${Math.round(elapsed)} ms`);
});

test("a scope whose every part matches the pull request evaluates in well under a second", () => {
  // Every SOW word is in every file and the title, so every part matches.
  const shared = words(70, 7);
  const items = (shift: number) =>
    Array.from({ length: 100 }, (_, i) => shared.slice(0, 60).map((w, k) => `${w} ${shared[(k + i + shift) % 70]}`).join(","));
  const baseline = scope({ included: items(0), excluded: items(35) });
  const files = Array.from({ length: 300 }, (_, i) => `src/${shared.join("/")}/f${i}.ts`);
  const elapsed = time(() => evaluate(baseline, pr(shared.join(" "), files)));
  assert.ok(elapsed < 1500, `took ${Math.round(elapsed)} ms`);
});

test("a body that is one 65,536-character run of capitals tokenizes in linear time", () => {
  const elapsed = time(() => tokenize("A".repeat(65_536)));
  assert.ok(elapsed < 200, `took ${Math.round(elapsed)} ms`);
  const body = time(() => evaluate(STORE, pr("Fix cart", ["src/cart/cart.ts"], { body: "A".repeat(65_536) })));
  assert.ok(body < 500, `evaluation took ${Math.round(body)} ms`);
});

test("camelCase splitting is unchanged", () => {
  assert.deepStrictEqual([...tokenize("XMLParser")].sort(), ["parser", "xml", "xmlparser"]);
  assert.deepStrictEqual([...tokenize("getHTTPResponse")].sort(), ["get", "gethttprespons", "http", "respons"]);
  assert.ok(tokenize("ABCdef").has("abcdef"));
  assert.ok(tokenize("APIs").has("apis") || tokenize("APIs").has("api"));
});

test("matches come back one per SOW item, with evidence for the best part", () => {
  const matches = matchContractPhrases({
    baseline: STORE,
    pullRequest: pr("Gift card redemption", ["src/giftcards/redeem.ts"]),
  });
  const gift = matches.find((m) => m.phrase === "gift cards");
  assert.ok(gift && gift.strong && gift.kind === "exclusion");
  assert.ok(gift.evidence.some((e) => e.location === "src/giftcards/redeem.ts"));
});

/* ------------------------------------------------------------------ */
/* Money and hours in client-facing text                                */
/* ------------------------------------------------------------------ */
console.log("\n▶ Money and hours read the way a client expects");

const ITEMS = [{ item: "Gift cards", clauseRef: "§3.1", clauseTitle: "Storefront" }];

test("one hour is '1 hour'", () => {
  const { body } = composeChangeOrder({ items: ITEMS, pullRequestTitle: "Gift cards", hours: 1, hourlyRate: 150 });
  assert.ok(body.includes("We estimate 1 hour for this, which is $150 at our rate of $150 an hour."), body);
  const noRate = composeChangeOrder({ items: ITEMS, pullRequestTitle: "Gift cards", hours: 1 }).body;
  assert.ok(noRate.includes("We estimate 1 hour for this."), noRate);
  const many = composeChangeOrder({ items: ITEMS, pullRequestTitle: "Gift cards", hours: 12, hourlyRate: 120 }).body;
  assert.ok(many.includes("We estimate 12 hours for this, which is $1,440 at our rate of $120 an hour."), many);
});

test("money is rounded to cents, never fractions of a cent", () => {
  const { body } = composeChangeOrder({ items: ITEMS, pullRequestTitle: "Gift cards", hours: 1.25, hourlyRate: 82.5 });
  assert.ok(body.includes("We estimate 1.25 hours for this, which is $103.13 at our rate of $82.50 an hour."), body);
});

test("the estimate line says '1 hour' and rounds money", () => {
  const base = evaluate(STORE, pr("Gift card redemption", ["src/giftcards/redeem.ts"]), pullRequestAsWorkItem(1));
  const one: CommercialEvaluation = {
    ...base,
    commercialValue: { currency: "USD", min: 103.125, max: 103.125, status: "available" },
  };
  const line = describeEstimate(one) ?? "";
  assert.ok(line.startsWith("1 hour, "), line);
  assert.ok(line.includes("$103.13 USD"), line);
});

/* ------------------------------------------------------------------ */

console.log(`\nMATCHER TESTS: ${passed} PASSED / ${failures.length} FAILED\n`);
if (failures.length > 0) {
  for (const name of failures) console.error(`  - ${name}`);
  process.exitCode = 1;
}
