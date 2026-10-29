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
import { baselineFromChecklist, checklistFromBaseline } from "../scope-checklist.js";
import { SOWDecomposer } from "../sow-decomposer.js";
import type { ChangedFile, CommercialEvaluation, LinearIssue, PullRequest, ScopeBaseline } from "../types.js";
import { VOCABULARY, vocabularyWords } from "../vocabulary.js";
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

/** A question for a person: never in scope, never a change order. Returns the evaluation for further checks. */
function expectReview(baseline: ScopeBaseline, pullRequest: PullRequest): CommercialEvaluation {
  expectNotExcluded(baseline, pullRequest);
  const result = evaluate(baseline, pullRequest);
  assert.strictEqual(result.state, "REVIEW_REQUIRED", `"${pullRequest.title}": ${result.state}: ${result.detectedDelta.join(" | ")}`);
  return result;
}

/** A pasted SOW, read the way /demo/sow and the app's scope section read it, then saved as a checklist. */
function scopeFromSow(markdown: string): ScopeBaseline {
  return baselineFromChecklist(checklistFromBaseline(new SOWDecomposer().decompose(markdown).baseline));
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
  // Currency pricing work that never says "multi" is a question for a person,
  // not a change order: the words can't tell GBP rounding from a EUR/USD
  // switcher, and the sample SOW includes no plain "pricing" to settle it.
  expectReview(STORE, pr("Fix GBP price rounding on product pages", ["src/pricing/currency.ts"]));
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
  expectState(baseline, pr("Fix reporting dashboard date filter", ["src/reporting/dashboard/filters.ts"]), "IN_SCOPE");
  // "Reporting dashboard" is narrower than reporting: work that never names
  // the dashboard may be the enterprise kind. A question, never a change order.
  expectReview(baseline, pr("Fix reporting date filter", ["src/reporting/filters.ts"]));
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
/* Excluded work must not pass as in scope                              */
/* ------------------------------------------------------------------ */
console.log("\n▶ Excluded work listed after an exception is still excluded");

const GIFT_CARDS_PR = (): PullRequest =>
  pr("Add gift cards", ["src/giftcards/redeem.ts", ["src/checkout/cart.ts", "modified"]], { branch: "feat/gift-cards" });

test("'excludes payment providers other than Stripe, native mobile apps, loyalty points and gift cards' excludes gift cards", () => {
  const baseline = scopeFromSow(
    "# SOW\n## 2.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\nExplicitly excludes payment providers other than Stripe, native mobile apps, loyalty points and gift cards.\n",
  );
  expectState(baseline, GIFT_CARDS_PR(), "CHANGE_REQUIRED");
  expectState(
    baseline,
    pr("Add loyalty points at checkout", ["src/loyalty/points.ts", ["src/checkout/cart.ts", "modified"]], { branch: "feat/loyalty-points" }),
    "CHANGE_REQUIRED",
  );
  expectState(
    baseline,
    pr("Native mobile app shell", ["mobile/native/App.tsx", "mobile/native/screens/CartScreen.tsx"], { branch: "feat/mobile-app" }),
    "CHANGE_REQUIRED",
  );
  // The exception itself is still allowed.
  expectState(baseline, pr("Retry failed Stripe checkout payments", ["src/checkout/stripe-retry.ts"]), "IN_SCOPE");
});

test("'except Stripe, gift cards' and '(other than Stripe), gift cards' exclude gift cards", () => {
  const except = scopeFromSow(
    "# SOW\n## 2.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\nExcluded: all third-party integrations except Stripe, gift cards, loyalty points.\n",
  );
  expectState(except, GIFT_CARDS_PR(), "CHANGE_REQUIRED");
  const bracketed = scopeFromSow(
    "# SOW\n## 2.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\nThird-party integrations (other than Stripe), gift cards and loyalty points are out of scope.\n",
  );
  expectState(bracketed, GIFT_CARDS_PR(), "CHANGE_REQUIRED");
  const outOfScope = scopeFromSow(
    "# SOW\n## 2.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\nPayment providers other than Stripe, gift cards and native mobile apps are out of scope.\n",
  );
  expectState(outOfScope, GIFT_CARDS_PR(), "CHANGE_REQUIRED");
});

console.log("\n▶ A bracketed example named without its head is a question, not in scope");

const PAYMENTS = scope({
  included: ["shopping cart"],
  excluded: ["additional payment providers (paypal, klarna, apple pay)"],
});

test("'Add PayPal to checkout' against excluded 'additional payment providers (paypal, …)' is REVIEW_REQUIRED", () => {
  const result = expectReview(
    PAYMENTS,
    pr("Add PayPal to checkout", ["src/checkout/paypal.ts", ["src/checkout/cart.ts", "modified"]], { branch: "feat/paypal" }),
  );
  assert.ok(
    result.detectedDelta.some((d) => d.includes("as an example of")),
    `the reason should say it is an example: ${result.detectedDelta.join(" | ")}`,
  );
});

test("vendor-only PRs against bracketed exclusions (Salesforce, Mixpanel, i18n, WCAG) are REVIEW_REQUIRED", () => {
  const brackets = scopeFromSow(
    "# SOW\n\n## 1. Storefront\n**Explicit Inclusions**:\n- Product catalogue and search\n- Shopping cart\n- Stripe checkout\n\n**Explicit Exclusions**:\n- Additional payment providers (PayPal, Klarna, Apple Pay)\n- Multi-language support (i18n)\n- Accessibility compliance (WCAG 2.1 AA)\n- Native mobile apps (iOS, Android)\n- Third-party integrations (Salesforce, HubSpot)\n",
  );
  expectReview(
    brackets,
    pr("Add PayPal to checkout", ["src/checkout/paypal.ts", ["src/checkout/cart.ts", "modified"]], { branch: "feat/paypal" }),
  );
  expectReview(
    brackets,
    pr("Sync orders to Salesforce", ["src/crm/salesforce.ts", ["src/checkout/cart.ts", "modified"]], { branch: "feat/salesforce-sync" }),
  );
  expectReview(
    brackets,
    pr("Add French translations for the product catalogue", ["src/i18n/fr.json", ["src/catalog/ProductPage.tsx", "modified"]], {
      branch: "feat/i18n-fr",
    }),
  );
  expectReview(
    brackets,
    pr("WCAG contrast fixes on product pages", [["src/catalog/ProductPage.tsx", "modified"]], { branch: "fix/wcag-contrast" }),
  );
  const analytics = scope({ included: ["product catalogue", "shopping cart"], excluded: ["analytics (google analytics, mixpanel)"] });
  expectReview(
    analytics,
    pr("Track add-to-cart in Mixpanel", ["src/tracking/mixpanel.ts", ["src/checkout/cart.ts", "modified"]], { branch: "feat/mixpanel" }),
  );
  const crm = scope({ included: ["product catalogue", "shopping cart"], excluded: ["crm integration (salesforce, hubspot)"] });
  expectReview(
    crm,
    pr("Sync orders to Salesforce", ["src/orders/salesforce-sync.ts", ["src/checkout/cart.ts", "modified"]], { branch: "feat/salesforce" }),
  );
});

test("an example found next to its head is still excluded; one the PR names as an exception is not asked about", () => {
  expectState(
    PAYMENTS,
    pr("Add PayPal payment provider", ["src/payments/paypal-provider.ts", ["src/checkout/cart.ts", "modified"]]),
    "CHANGE_REQUIRED",
  );
  const withException = scope({
    included: ["shopping cart"],
    excluded: ["analytics (mixpanel, segment) other than plausible"],
  });
  expectState(withException, pr("Send cart events to Mixpanel and Plausible", ["src/cart/mixpanel-plausible.ts"]), "IN_SCOPE");
});

console.log("\n▶ 'Including but not limited to' is not an exception");

const HUBSPOT_PR = (): PullRequest =>
  pr("Sync new customers to HubSpot", ["src/crm/hubspot.ts", ["src/checkout/cart.ts", "modified"]], { branch: "feat/hubspot-sync" });

test("'crm integrations, including but not limited to salesforce and hubspot' excludes HubSpot work", () => {
  const typed = scope({ included: ["shopping cart"], excluded: ["crm integrations, including but not limited to salesforce and hubspot"] });
  expectState(typed, HUBSPOT_PR(), "CHANGE_REQUIRED");
  const restricted = scope({ included: ["shopping cart"], excluded: ["crm integrations, including but not restricted to salesforce and hubspot"] });
  expectState(restricted, HUBSPOT_PR(), "CHANGE_REQUIRED");
  const parsed = scopeFromSow(
    "# SOW\n## 1.1 Store\nIncludes product catalogue, shopping cart and Stripe checkout.\nExcludes: CRM integrations including but not limited to Salesforce and HubSpot.\n",
  );
  expectState(parsed, HUBSPOT_PR(), "CHANGE_REQUIRED");
  const predicate = scopeFromSow(
    "# SOW\n## 1.1 Integrations\nThe following integrations are in scope: Stripe, Mailchimp.\nAll other third-party integrations, including but not limited to Salesforce and HubSpot, are out of scope.\n",
  );
  expectState(predicate, pr("Sync new customers to HubSpot", ["src/crm/hubspot.ts"], { branch: "feat/hubspot-sync" }), "CHANGE_REQUIRED");
});

test("the first example after 'including but not limited to' is excluded too", () => {
  const parsed = scopeFromSow(
    "# SOW\n## 1.1 Store\nIncludes product catalogue, shopping cart and Stripe checkout.\nExcludes: CRM integrations including but not limited to Salesforce and HubSpot.\n",
  );
  expectState(
    parsed,
    pr("Sync orders to Salesforce", ["src/crm/salesforce.ts", ["src/checkout/cart.ts", "modified"]], { branch: "feat/salesforce" }),
    "CHANGE_REQUIRED",
  );
  // Without "crm" anywhere in the pull request: Salesforce is its own excluded example.
  expectState(
    parsed,
    pr("Sync orders to Salesforce", ["src/integrations/salesforce/client.ts", ["src/checkout/cart.ts", "modified"]]),
    "CHANGE_REQUIRED",
  );
});

test("a real 'but not' exception still works", () => {
  const baseline = scope({ included: ["stripe checkout"], excluded: ["payment providers but not stripe"] });
  expectNotExcluded(baseline, pr("Stripe provider config", [["src/payments/providers/stripe.ts", "modified"]]));
  expectState(baseline, pr("Add PayPal payment provider", ["src/payments/paypal-provider.ts"]), "CHANGE_REQUIRED");
});

console.log("\n▶ Excluded work described without its qualifier is a question, not in scope");

const SOW6 = scopeFromSow(
  "# SOW\n## 2.1 Storefront\n**Explicit Inclusions**:\n- Product catalogue and search\n- Shopping cart\n- Stripe checkout\n\n**Explicit Exclusions**:\n- Multi-language support\n- Multi-currency pricing\n- Advanced search\n- Custom reports\n",
);

test("'Currency switcher (EUR, USD)' against excluded 'Multi-currency pricing' is REVIEW_REQUIRED", () => {
  const switcher = pr("Currency switcher (EUR, USD) on product pages", ["src/catalog/CurrencySwitcher.tsx", ["src/catalog/ProductPrice.tsx", "modified"]], {
    branch: "feat/currency-switcher",
  });
  const result = expectReview(STORE, switcher);
  assert.ok(
    result.detectedDelta.some((d) => d.includes('"multi"')),
    `the reason should name the missing qualifier: ${result.detectedDelta.join(" | ")}`,
  );
  expectReview(SOW6, switcher);
});

test("language switcher, faceted search and report builder are REVIEW_REQUIRED, not IN_SCOPE", () => {
  expectReview(
    SOW6,
    pr("Add language switcher to product pages", ["src/catalog/LanguageSwitcher.tsx", "src/i18n/fr.json", ["src/catalog/ProductPage.tsx", "modified"]], {
      branch: "feat/language-switcher",
    }),
  );
  expectReview(SOW6, pr("Report builder for sales", ["src/catalog/reports/ReportBuilder.tsx"], { branch: "feat/report-builder" }));
  const facets = pr("Faceted search filters", ["src/search/facets.ts", ["src/search/SearchPage.tsx", "modified"]], { branch: "feat/search-facets" });
  expectReview(scope({ included: ["shopping cart"], excluded: ["advanced search"] }), facets);
  // SOW6 also includes plain "search", which this pull request matches: no
  // word says it is the advanced kind, so it reads as the included search.
  expectNotExcluded(SOW6, facets);
});

test("work the SOW includes in its plain form stays in scope; the qualified form is still excluded", () => {
  const search = scope({ included: ["basic keyword search"], excluded: ["advanced search"] });
  expectState(search, pr("Fix keyword search pagination", ["src/search/keyword.ts"]), "IN_SCOPE");
  const reporting = scope({ included: ["reporting dashboard"], excluded: ["enterprise reporting"] });
  expectState(reporting, pr("Fix reporting dashboard date filter", ["src/reporting/dashboard/filters.ts"]), "IN_SCOPE");
  expectState(STORE, pr("Add multi-currency pricing", ["src/pricing/multi-currency.ts"]), "CHANGE_REQUIRED");
  // Only described, never built: nothing to ask about.
  expectState(STORE, pr("Fix cart totals", ["src/checkout/cart.ts"], { body: "Unrelated to currency pricing." }), "IN_SCOPE");
});

console.log("\n▶ Capabilities in digit-suffixed and inflected paths");

const ACCOUNTS = (excluded: string): ScopeBaseline =>
  scope({ title: "Accounts", included: ["email and password login", "password reset", "user profile pages"], excluded: [excluded] });

test("saml2 paths name enterprise SSO, invitee paths name team invitations", () => {
  assert.deepStrictEqual(capabilitiesOf("src/main/java/com/acme/security/saml2/Saml2Config.java"), ["enterprise_sso_saml"]);
  assert.deepStrictEqual(capabilitiesOf("config/saml2_settings.php"), ["enterprise_sso_saml"]);
  assert.deepStrictEqual(capabilitiesOf("app/Http/Controllers/Saml2Controller.php"), ["enterprise_sso_saml"]);
  assert.deepStrictEqual(capabilitiesOf("accounts/saml2_config.py"), ["enterprise_sso_saml"]);
  assert.deepStrictEqual(capabilitiesOf("src/team/invitees.ts"), ["team_invitations"]);
  assert.deepStrictEqual(capabilitiesOf("src/team/PendingInvitees.tsx"), ["team_invitations"]);
  assert.deepStrictEqual(capabilitiesOf("src/team/inviter.ts"), ["team_invitations"]);
  // Splitting digits off doesn't invent words.
  assert.deepStrictEqual(capabilitiesOf("src/oauth2/client.ts"), []);
  assert.deepStrictEqual(capabilitiesOf("src/s3/upload-v2.ts"), []);
});

test("SAML2 and invitee PRs against excluded SSO and team invitations are CHANGE_REQUIRED", () => {
  expectState(
    ACCOUNTS("single sign-on (saml)"),
    pr(
      "Acme staff login via SAML2",
      ["src/main/java/com/acme/security/saml2/Saml2Config.java", ["src/main/java/com/acme/security/LoginController.java", "modified"]],
      { branch: "feat/acme-saml2" },
    ),
    "CHANGE_REQUIRED",
  );
  expectState(
    ACCOUNTS("enterprise sso (saml, okta)"),
    pr("Okta login for Acme", ["config/saml2_settings.php", "app/Http/Controllers/Saml2Controller.php"], { branch: "feat/okta-login" }),
    "CHANGE_REQUIRED",
  );
  expectState(ACCOUNTS("team invitations"), pr("Pending invitees list", ["src/team/invitees.ts"]), "CHANGE_REQUIRED");
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

/**
 * The public demo's largest scope (40,000 characters of items of at most 300)
 * against 300 paths that each hold every part word: items of `parts` words,
 * `head` words before a bracket, and `exceptions` words after "other than".
 */
function adversarialScope(parts: number, exceptions: number, head: number): { baseline: ScopeBaseline; pullRequest: PullRequest } {
  let n = 0;
  const unique = () => {
    const s = (n++).toString(26).padStart(3, "0").split("").map((c) => String.fromCharCode(97 + parseInt(c, 26))).join("");
    return "k" + s.slice(-2);
  };
  const partWords = Array.from({ length: 90 }, (_, i) => "p" + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)));
  const files = Array.from({ length: 300 }, (_, i) => [...partWords, "hhh"].join("/").slice(0, 380) + "/f" + i);
  const items: string[] = [];
  let total = 0;
  for (let i = 0; ; i++) {
    const listed = Array.from({ length: parts }, (_, j) => partWords[(i + j) % partWords.length]);
    const except = Array.from({ length: exceptions }, unique);
    const heads = Array.from({ length: head }, unique);
    const item = (
      head > 0
        ? `${heads.join(" ")} hhh (${listed.join(", ")})${exceptions ? " other than " + except.join(", ") : ""}`
        : `${listed.join(", ")} other than ${except.join(", ")}`
    ).slice(0, 300);
    if (total + item.length > 40_000) break;
    items.push(item);
    total += item.length;
  }
  const clauses: Clause[] = [];
  for (let i = 0; i < items.length; i += 100) clauses.push({ excluded: items.slice(i, i + 100) });
  return { baseline: scope(...clauses), pullRequest: pr("x", files) };
}

test("the demo's largest scope of exceptions and bracketed examples evaluates in well under a second", () => {
  for (const [parts, exceptions, head] of [
    [30, 30, 0],
    [25, 15, 10],
    [30, 0, 30],
    [40, 20, 0],
  ]) {
    const { baseline, pullRequest } = adversarialScope(parts, exceptions, head);
    const elapsed = time(() => evaluate(baseline, pullRequest));
    assert.ok(elapsed < 1000, `parts ${parts}, exceptions ${exceptions}, head ${head}: took ${Math.round(elapsed)} ms`);
  }
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

console.log("\n▶ A bracket next to an exception keeps the excluded work excluded");

const CHECKOUT = { included: ["product catalogue", "shopping cart", "stripe checkout"] };

test("'payment providers other than stripe (paypal, klarna, apple pay)': the examples aren't exceptions", () => {
  const baseline = scope({ ...CHECKOUT, excluded: ["payment providers other than stripe (paypal, klarna, apple pay)"] });
  expectState(baseline, pr("Add Klarna payment provider", ["src/payments/klarna-provider.ts", ["src/checkout/cart.ts", "modified"]]), "CHANGE_REQUIRED");
  // The bracket may name excluded examples or excepted ones: a question, never in scope.
  expectReview(baseline, pr("Add PayPal to checkout", ["src/checkout/paypal.ts", ["src/checkout/cart.ts", "modified"]]));
  expectNotExcluded(baseline, pr("Stripe checkout retries", [["src/checkout/stripe.ts", "modified"]]));
});

test("'third-party integrations (other than stripe) and gift cards': the exception ends with its bracket", () => {
  const parsed = scopeFromSow(
    "# SOW\n## 1.1 Store\nIncludes product catalogue, shopping cart and Stripe checkout.\nThird-party integrations (other than Stripe) and gift cards are out of scope.\n",
  );
  expectState(parsed, pr("Add gift cards", ["src/giftcards/redeem.ts", ["src/checkout/cart.ts", "modified"]]), "CHANGE_REQUIRED");
  const typed = scope({ ...CHECKOUT, excluded: ["third-party integrations (other than stripe and sendgrid) and native mobile apps"] });
  expectState(typed, pr("Native mobile app shell", ["mobile/app/App.tsx", "mobile/app/screens/Home.tsx"]), "CHANGE_REQUIRED");
});

console.log("\n▶ An included plain variant clears only its own qualifier question");

const VARIANTS = scope({
  included: ["single-currency pricing (gbp)", "basic search", "standard sales reports", "product catalogue"],
  excluded: ["multi-currency pricing", "advanced search", "custom reports"],
});

test("a qualified inclusion doesn't clear excluded work built without the qualifier word", () => {
  expectReview(VARIANTS, pr("Currency switcher (EUR, USD) on product pages", ["src/pricing/CurrencySwitcher.tsx", ["src/pricing/ProductPrice.tsx", "modified"]]));
  expectReview(VARIANTS, pr("Faceted search with price and brand filters", ["src/search/facets.ts"]));
  expectReview(VARIANTS, pr("Report builder: pick columns and date ranges", ["src/reports/ReportBuilder.tsx"]));
});

test("a plain inclusion still keeps its own work in scope", () => {
  const plain = scope({ included: ["basic keyword search"], excluded: ["advanced search"] });
  expectNotExcluded(plain, pr("Keyword search results page", ["src/search/keyword-results.tsx"]));
});

/* ------------------------------------------------------------------ */
/* Contract wording read the way it is written                          */
/* ------------------------------------------------------------------ */
// One test per confirmed wrong verdict from the wording sweep, with the
// reproduction it was confirmed on and the false change orders its fix must
// not cause.

const M = (path: string): FileSpec => [path, "modified"];
const LOYALTY_PR = (): PullRequest => pr("Loyalty points on orders", ["src/loyalty/points.ts", M("src/checkout/cart.ts")]);
const STORE_INCLUDED = ["product catalogue", "shopping cart", "stripe checkout"];

console.log("\n▶ Contract wording read the way it is written");

test("1. 'will not include', 'shall not include', 'won't include' and 'doesn’t include' exclude, never include", () => {
  const sow = (line: string) =>
    scopeFromSow(`# Statement of Work: Acme Shop\n\n## 1.1 Storefront\nThe project includes product catalogue, shopping cart and Stripe checkout.\n${line}\n`);
  expectState(sow("Phase 1 will not include gift cards, loyalty points or a native mobile app."), GIFT_CARDS_PR(), "CHANGE_REQUIRED");
  expectState(sow("This SOW doesn’t include gift cards or loyalty points."), LOYALTY_PR(), "CHANGE_REQUIRED");
  const ownClause = scopeFromSow(
    "# SOW\n\n## 1.1 Storefront\nThe project includes product catalogue, shopping cart and Stripe checkout.\n\n## 2.1 Exclusions\nThe project will not include gift cards or loyalty points.\n",
  );
  expectState(ownClause, GIFT_CARDS_PR(), "CHANGE_REQUIRED");
  // The words are only in separate places: a question, no longer "included".
  expectReview(sow("The project will not include native mobile apps."), pr("React Native app: cart screen", ["apps/mobile/src/screens/CartScreen.tsx"]));
  expectState(sow("The Services shall not include gift cards or loyalty points."), GIFT_CARDS_PR(), "CHANGE_REQUIRED");
  expectState(sow("The project won't include gift cards or loyalty points."), GIFT_CARDS_PR(), "CHANGE_REQUIRED");
  expectState(
    sow("Phase 1 will not include gift cards, loyalty points or a native mobile app."),
    pr("Shopping cart quantity update", [M("src/checkout/cart.ts")]),
    "IN_SCOPE",
  );
  // "Should not" and "must not" state requirements, not scope.
  const stackTraces = pr("Hide stack traces on error pages", [M("src/errors/ErrorPage.tsx")]);
  expectNotExcluded(sow("Error pages should not include stack traces."), stackTraces);
  expectNotExcluded(sow("Error pages must not include stack traces."), stackTraces);
});

test("2. 'e.g.', 'i.e.' and 'etc.' end neither the sentence nor the list", () => {
  const sow = (line: string) =>
    scopeFromSow(
      `# Acme Storefront SOW\n\n## 1.1 Storefront and Checkout\nThe Supplier shall deliver a product catalogue and search, a shopping cart, Stripe checkout and email and password login.\n${line}\n`,
    );
  const gift = pr("Add gift cards", ["src/giftcards/redeem.ts", M("src/checkout/cart.ts")]);
  expectState(sow("Out of scope: CRM integrations (e.g. Salesforce), gift cards and loyalty points."), gift, "CHANGE_REQUIRED");
  expectState(sow("Explicitly excludes payment providers other than Stripe (e.g. PayPal), gift cards and loyalty points."), LOYALTY_PR(), "CHANGE_REQUIRED");
  expectState(sow("Gift cards, loyalty points, etc. are out of scope."), gift, "CHANGE_REQUIRED");
  expectState(sow("Explicitly excludes native mobile apps (i.e. iOS and Android), gift cards and loyalty points."), gift, "CHANGE_REQUIRED");
  expectState(sow("Out of scope: CRM integrations (Salesforce, HubSpot, etc.), gift cards and loyalty points."), gift, "CHANGE_REQUIRED");
  const social = sow("Out of scope: social login, e.g. Google, Facebook, Apple.");
  expectState(social, pr("Google login", ["src/auth/google-oauth.ts", M("src/auth/login.ts")]), "CHANGE_REQUIRED");
  // Trailing examples need a word of what they are examples of, as bracketed ones do.
  expectReview(social, pr("Facebook pixel on product pages", ["src/catalog/facebook-pixel.ts"]));
  expectReview(social, pr("Add home screen icons", ["public/apple-touch-icon.png"]));
  // "etc" is no item: an etc/ directory is not excluded work.
  const phpIni = pr("Raise PHP memory limit for cart", [M("etc/php/php.ini"), M("src/checkout/cart.ts")]);
  expectNotExcluded(sow("Gift cards, loyalty points, etc. are out of scope."), phpIni);
  expectNotExcluded(sow("Out of scope: gift cards, loyalty points, etc."), phpIni);
});

test("3. ', except Stripe,', ', other than Stripe,' and ', as well as' keep the list and the exception", () => {
  const sow = (line: string) =>
    scopeFromSow(`# Statement of Work\n\n## 1. Storefront and Checkout\n\nIncluded: product catalogue and search, shopping cart, Stripe checkout.\n\n${line}\n`);
  const stripe = pr("Stripe payment provider: 3D Secure", [M("src/payments/providers/stripe.ts"), M("src/checkout/cart.ts")], {
    branch: "feature/stripe-3ds",
  });
  const gift = pr("Add gift cards", ["src/giftcards/redeem.ts", M("src/checkout/cart.ts")], { branch: "feature/gift-cards" });
  const exceptFor = sow("Out of scope: payment providers, except for Stripe, gift cards and loyalty points.");
  expectState(exceptFor, gift, "CHANGE_REQUIRED");
  expectState(exceptFor, stripe, "IN_SCOPE");
  expectState(sow("Out of scope: native mobile apps, as well as gift cards and loyalty points."), LOYALTY_PR(), "CHANGE_REQUIRED");
  expectState(sow("Gift cards, as well as loyalty points, are out of scope."), LOYALTY_PR(), "CHANGE_REQUIRED");
  expectState(sow("Excludes gift cards, as well as loyalty points."), LOYALTY_PR(), "CHANGE_REQUIRED");
  const commaSet = sow("Payment providers, other than Stripe, are out of scope.");
  expectState(commaSet, stripe, "IN_SCOPE");
  expectState(commaSet, pr("Add PayPal payment provider", ["src/payments/providers/paypal.ts", M("src/checkout/cart.ts")]), "CHANGE_REQUIRED");
  expectState(sow("Payment providers, except Stripe, are out of scope."), stripe, "IN_SCOPE");
  expectState(
    sow("Out of scope: third-party integrations, including, but not limited to, Salesforce and HubSpot."),
    pr("Sync orders to Salesforce", ["src/integrations/salesforce/client.ts", M("src/checkout/cart.ts")]),
    "CHANGE_REQUIRED",
  );
  // Commentary after the list is still not an item.
  expectState(sow("Out of scope: hosting, as agreed with the Client."), pr("Production hosting on AWS", ["infra/hosting/aws.tf"]), "CHANGE_REQUIRED");
});

test("4. 'with the exception of', 'excluding' and 'not including' are exceptions; 'save for later' and 'excluding VAT' are not", () => {
  const sow = (line: string) =>
    scopeFromSow(`# Statement of Work\n\n## 1. Storefront\n\n### 1.1 Checkout\n\nThe Supplier will build the product catalogue, shopping cart and checkout. ${line}\n`);
  const gateways = sow("Out of scope: all payment gateways with the exception of Stripe.");
  expectState(gateways, pr("Add PayPal payment gateway", ["src/payments/gateways/paypal.ts", M("src/checkout/cart.ts")], { branch: "feat/paypal" }), "CHANGE_REQUIRED");
  expectState(gateways, pr("Add Adyen gateway", ["src/payments/gateways/adyen.ts", M("src/checkout/payment-step.tsx")]), "CHANGE_REQUIRED");
  const retries = pr("Stripe gateway retries", [M("src/payments/gateways/stripe.ts")]);
  expectNotExcluded(sow("All payment gateways, with the exception of Stripe, are out of scope."), retries);
  const checkout = { included: ["product catalogue", "shopping cart", "checkout"] };
  expectNotExcluded(scope({ ...checkout, excluded: ["payment gateways with the exception of stripe"] }), retries);
  const refunds = pr("Stripe webhooks for refunds", ["src/payments/stripe/webhooks.ts", M("src/checkout/cart.ts")], { branch: "feat/stripe-refunds" });
  expectNotExcluded(sow("Payment providers (excluding Stripe) are out of scope."), refunds);
  const typed = scope({ ...checkout, excluded: ["payment providers (excluding stripe)"] });
  expectNotExcluded(typed, refunds);
  expectState(typed, pr("Add Klarna payment provider", ["src/payments/providers/klarna.ts", M("src/checkout/cart.ts")]), "CHANGE_REQUIRED");
  expectNotExcluded(sow("Payment providers, not including Stripe, are out of scope."), refunds);
  expectNotExcluded(
    sow("Payment providers, save for Stripe, are excluded."),
    pr("Stripe payment provider: 3D Secure", [M("src/payments/providers/stripe.ts"), M("src/checkout/cart.ts")]),
  );
  // Features and prices that only use the words are still excluded.
  const saveForLater = pr("Add save for later to cart", ["src/cart/save-for-later.ts", M("src/checkout/cart.ts")], { branch: "feat/save-for-later" });
  const features = scope({ included: ["shopping cart"], excluded: ["save for later", "wishlists", "b2b prices excluding vat"] });
  expectState(features, saveForLater, "CHANGE_REQUIRED");
  expectState(features, pr("Show B2B prices excluding VAT", ["src/pricing/b2b-ex-vat.ts", M("src/checkout/cart.ts")]), "CHANGE_REQUIRED");
  const parsed = scopeFromSow(
    "# SOW\n\n## 1.1 Store\nIncludes product catalogue and shopping cart.\n**Out of scope:** save for later, wishlists and product reviews.\n",
  );
  expectState(parsed, saveForLater, "CHANGE_REQUIRED");
});

test("5. the first example after 'such as', 'including' or 'for example' is excluded next to its head", () => {
  const sow = (line: string) =>
    scopeFromSow(`# SOW\n## 1.1 Store\nIncludes product catalogue, shopping cart, email and password login and Stripe checkout.\n${line}\n`);
  const salesforce = pr("Sync orders to Salesforce", ["src/integrations/salesforce/client.ts", M("src/checkout/cart.ts")], { branch: "feat/salesforce" });
  expectState(sow("Third-party integrations such as Salesforce and HubSpot are out of scope."), salesforce, "CHANGE_REQUIRED");
  expectState(scope({ included: STORE_INCLUDED, excluded: ["third-party integrations such as salesforce and hubspot"] }), salesforce, "CHANGE_REQUIRED");
  expectState(sow("Out of scope: CRM integrations including Salesforce and HubSpot."), salesforce, "CHANGE_REQUIRED");
  const google = pr("Google login", ["src/auth/google-oauth.ts", M("src/auth/login.ts")]);
  expectState(sow("Out of scope: social login (for example Google or Facebook)."), google, "CHANGE_REQUIRED");
  expectState(scope({ included: STORE_INCLUDED, excluded: ["third-party integrations (for instance salesforce, hubspot)"] }), salesforce, "CHANGE_REQUIRED");
  // Named without anything it is an example of: a question, as a bracketed example is.
  expectReview(
    scope({ included: STORE_INCLUDED, excluded: ["payment providers such as paypal and klarna"] }),
    pr("Add PayPal to checkout", ["src/checkout/paypal.ts", M("src/checkout/cart.ts")]),
  );
  expectReview(sow("Excludes: additional payment providers such as PayPal and Klarna."), pr("Add PayPal", ["src/checkout/paypal.ts"], { branch: "feat/paypal" }));
  expectNotExcluded(
    scope({ included: ["shopping cart"], excluded: ["social login such as google"] }),
    pr("Add Google Analytics events to cart", ["src/analytics/google-analytics.ts", M("src/checkout/cart.ts")]),
  );
  // The whole item still counts as it did.
  expectState(scope({ included: ["shopping cart"], excluded: ["integrations such as salesforce and hubspot"] }), salesforce, "CHANGE_REQUIRED");
  expectState(
    scope({ included: ["shopping cart"], excluded: ["payment providers like paypal or klarna"] }),
    pr("Add Klarna payment provider", ["src/payments/klarna-provider.ts"]),
    "CHANGE_REQUIRED",
  );
});

test("6. numbered legal sub-clauses keep their text", () => {
  const gift = pr("Add gift cards", ["src/giftcards/redeem.ts", M("src/cart.ts")]);
  const sentences = scopeFromSow(
    "## 1.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\n\n## 2. Exclusions\n2.1 Gift cards are out of scope.\n2.2 Loyalty points are excluded.\n",
  );
  expectState(sentences, gift, "CHANGE_REQUIRED");
  expectState(sentences, pr("Loyalty points on orders", ["src/loyalty/points.ts", M("src/cart.ts")]), "CHANGE_REQUIRED");
  const redeem = pr("Add gift card redemption", ["src/giftcards/redeem.ts", M("src/cart/cart.ts")], { branch: "feature/gift-cards" });
  const wordExport = scopeFromSow(
    "Statement of Work - Acme Storefront\n\n3. Deliverables\n3.1 Storefront\nThe Agency will deliver a product catalogue, shopping cart and Stripe checkout.\n\n4. Exclusions\n4.1 Gift card functionality.\n4.2 Loyalty points programme.\n",
  );
  expectState(wordExport, redeem, "CHANGE_REQUIRED");
  expectState(wordExport, pr("Shopping cart quantity fix", [M("src/cart/cart.ts")]), "IN_SCOPE");
  const storefront = "## 1.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\n\n";
  expectState(scopeFromSow(`${storefront}## 1.2 Out of scope\n1.2.1 Gift cards.\n1.2.2 Loyalty points.\n`), redeem, "CHANGE_REQUIRED");
  expectState(
    scopeFromSow(`${storefront}## 5. Assumptions and Exclusions\n5.1 The Client will supply all product photography.\n5.2 Gift cards and loyalty points are not included.\n`),
    redeem,
    "CHANGE_REQUIRED",
  );
  const services = "## 1.1 Storefront\nThe Services include a product catalogue, shopping cart and Stripe checkout.\n\n";
  expectState(scopeFromSow(`${services}## 1.2 Other\nThe Services do not include gift cards or loyalty points.`), redeem, "CHANGE_REQUIRED");
  expectState(scopeFromSow(`${services}1.2 The Services do not include gift cards or loyalty points.`), redeem, "CHANGE_REQUIRED");
  expectState(
    scopeFromSow(`${storefront}## 2. Exclusions\n2.1 The following are excluded: gift cards, loyalty points.\n`),
    pr("Loyalty points on orders", ["src/loyalty/points.ts", M("src/cart.ts")]),
    "CHANGE_REQUIRED",
  );
  expectState(
    scopeFromSow("## 1.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\nSection 1.2 Gift cards and loyalty points are out of scope.\n"),
    gift,
    "CHANGE_REQUIRED",
  );
  // The heading after the list is not one of its items.
  const fees = scopeFromSow(
    "Statement of Work\n\n3. Deliverables\n3.1 Storefront\nThe Agency will deliver a product catalogue, shopping cart and Stripe checkout.\n\n4. Exclusions\n4.1 Gift card functionality.\n4.2 Loyalty points programme.\n5. Fees and Payment\nFees are payable monthly.\n",
  );
  expectState(fees, pr("Stripe payment retries", [M("src/payments/stripe.ts"), M("src/checkout/cart.ts")]), "IN_SCOPE");
});

test("7. what an included item leaves out is excluded", () => {
  const sow = (line: string) => scopeFromSow(`# Storefront SOW\n\n## 1.1 Storefront\nThe Agency shall deliver a product catalogue and shopping cart.\n${line}\n`);
  const card = sow("Includes payment by card via Stripe, excluding PayPal.");
  expectState(card, pr("Add PayPal payments", ["src/payments/paypal.ts"], { branch: "feature/paypal" }), "CHANGE_REQUIRED");
  expectState(card, pr("Add PayPal to checkout", ["src/checkout/paypal.ts", M("src/checkout/cart.ts")]), "CHANGE_REQUIRED");
  expectState(sow("Includes social login with Google and Facebook, excluding Apple."), pr("Sign in with Apple", ["src/auth/apple-signin.ts", M("src/auth/login.ts")]), "CHANGE_REQUIRED");
  const email = sow("Includes email notifications, but not SMS notifications.");
  expectState(email, pr("SMS order updates via Twilio", ["src/notifications/sms/twilio.ts", M("src/notifications/order-status.ts")]), "CHANGE_REQUIRED");
  expectState(email, pr("Order shipped email notification", ["src/notifications/email/shipped.ts"]), "IN_SCOPE");
  expectState(sow("Includes integration with all payment providers other than PayPal."), pr("Add PayPal to checkout", ["src/checkout/paypal.ts", M("src/checkout/cart.ts")]), "CHANGE_REQUIRED");
  expectState(sow("Includes English-language content only, excluding translations."), pr("Add French translations", ["src/i18n/fr.json", M("src/catalog/ProductPage.tsx")]), "CHANGE_REQUIRED");
  expectReview(sow("Includes a responsive web storefront, excluding native mobile apps."), pr("React Native app shell", ["mobile/App.tsx", "mobile/src/screens/Catalogue.tsx"]));
  expectState(
    scopeFromSow("# SOW\n\n### In Scope\n- Product catalogue\n- Payment by card via Stripe, excluding PayPal\n"),
    pr("Add PayPal payments", ["src/payments/paypal.ts"], { branch: "feature/paypal" }),
    "CHANGE_REQUIRED",
  );
  // An exception to an exclusion is allowed work, not a change order.
  expectNotExcluded(
    scopeFromSow("# SOW\n\n### In Scope\n- Product catalogue\n- Stripe checkout\n\n### Out of Scope\n- Third-party integrations, excluding Stripe\n"),
    pr("Stripe checkout", ["src/payments/stripe.ts", M("src/checkout/cart.ts")]),
  );
  expectNotExcluded(sow("Out of scope: ongoing hosting, excluding initial setup."), pr("Initial hosting setup on AWS", ["infra/aws/setup.tf", "infra/aws/hosting.tf"]));
});

const BULLET_SOW = (bullet: string): ScopeBaseline =>
  scopeFromSow(
    `# SOW\n## 2.1 Storefront\n**Explicit Inclusions**:\n- Product catalogue and search\n- Shopping cart\n- Stripe checkout\n\n**Explicit Exclusions**:\n- ${bullet}\n`,
  );

test("8. after an exception's comma or semicolon in a bullet or typed item, later items are never in scope", () => {
  const listed = BULLET_SOW("Payment providers other than Stripe, gift cards and loyalty points");
  expectReview(listed, GIFT_CARDS_PR());
  expectReview(listed, pr("Add loyalty points at checkout", ["src/loyalty/points.ts", M("src/checkout/cart.ts")]));
  expectState(listed, pr("Stripe payment provider: 3D Secure", [M("src/payments/providers/stripe.ts"), M("src/checkout/cart.ts")]), "IN_SCOPE");
  expectState(BULLET_SOW("Payment providers other than Stripe; gift cards"), GIFT_CARDS_PR(), "CHANGE_REQUIRED");
  expectReview(
    BULLET_SOW("All third-party integrations except Stripe, including CRM and ERP systems"),
    pr("Sync customers to the CRM", ["src/integrations/crm/hubspot-sync.ts", M("src/checkout/cart.ts")]),
  );
  expectReview(scope({ included: ["product catalogue and search", "shopping cart", "stripe checkout"], excluded: ["payment providers other than stripe, gift cards"] }), GIFT_CARDS_PR());
  expectState(BULLET_SOW("Payment providers [other than Stripe] and gift cards"), GIFT_CARDS_PR(), "CHANGE_REQUIRED");
  expectReview(
    BULLET_SOW("Payment gateways other than Stripe, such as PayPal or Klarna"),
    pr("Add PayPal to checkout", ["src/checkout/paypal.ts", M("src/checkout/cart.ts")], { branch: "feat/paypal" }),
  );
  // An exception after the semicolon stays an exception, and a part that may be one names no capability.
  expectNotExcluded(BULLET_SOW("Payment providers except PayPal; analytics other than Plausible"), pr("Add Plausible analytics", ["src/analytics/plausible.ts"]));
  expectNotExcluded(
    scope({ included: ["single sign-on with okta"], excluded: ["identity providers other than google, okta"] }),
    pr("Okta SSO for staff login", ["src/auth/okta-sso.ts", "src/auth/saml-callback.ts"]),
  );
});

test("9. an exception that is the plain variant keeps its qualifier", () => {
  const search = scopeFromSow(
    "# SOW\n## 2.1 Storefront\n**Explicit Inclusions**:\n- Product catalogue\n- Basic search\n- Shopping cart\n\n**Explicit Exclusions**:\n- Search features other than basic search\n",
  );
  expectReview(search, pr("Faceted search filters", ["src/search/facets.ts", M("src/search/SearchPage.tsx")]));
  const reports = scopeFromSow("# SOW\n## 4.1 Reporting\nIncludes standard reports and an orders dashboard.\nExcludes reports other than standard reports.\n");
  const builder = pr("Report builder: pick columns and date ranges", ["src/reports/ReportBuilder.tsx"]);
  expectReview(reports, builder);
  expectState(reports, pr("Standard reports: fix date filter", [M("src/reports/standard/date-filter.ts")]), "IN_SCOPE");
  expectReview(
    scope({ included: ["shopping cart", "order emails"], excluded: ["email templates other than the standard templates"] }),
    pr("Abandoned cart email template", ["src/emails/templates/abandoned-cart.tsx"]),
  );
  // A file that names the plain exception doesn't hide another one building the excluded work.
  expectState(
    scope({ included: ["shopping cart"], excluded: ["payment gateways other than the standard stripe gateway"] }),
    pr("Add PayPal checkout", ["src/payment-gateways/stripe-adapter.ts", "src/payment-gateways/paypal.ts"]),
    "CHANGE_REQUIRED",
  );
  // An included item's qualified exception keeps unqualified work out of scope.
  expectReview(scope({ included: ["reports other than custom reports"] }), builder);
});

test("10. a shared file next to the excepted work is a question, not a change order", () => {
  const stripe = pr("Stripe: support 3D Secure", [M("src/payments/providers/stripe.ts"), M("src/payments/providers/index.ts")]);
  const parsed = scopeFromSow("# SOW\n## 1.1 Payments\nExcludes payment providers other than Stripe.\n\n## 1.2 Storefront\nIncludes shopping cart, Stripe checkout and order confirmation emails.\n");
  expectNotExcluded(parsed, stripe);
  expectState(parsed, pr("Add Klarna payment provider", ["src/payments/providers/klarna.ts", M("src/payments/providers/index.ts")]), "CHANGE_REQUIRED");
  expectNotExcluded(scope({ included: ["stripe checkout"], excluded: ["payment providers other than stripe"] }), stripe);
  const notifications = scope({ included: ["order confirmation emails"], excluded: ["notifications other than email"] });
  expectNotExcluded(notifications, pr("Order shipped email", ["src/notifications/email/order-shipped.ts", M("src/notifications/dispatcher.ts")]));
  expectState(notifications, pr("SMS order shipped", ["src/notifications/sms/order-shipped.ts", M("src/notifications/dispatcher.ts")]), "CHANGE_REQUIRED");
  const analytics = scope({ included: ["stripe checkout"], excluded: ["analytics other than google analytics"] });
  expectNotExcluded(analytics, pr("Google Analytics purchase event", [M("src/analytics/google-analytics.ts"), M("src/analytics/tracker.ts")]));
  // The exception named in an unrelated file doesn't excuse other analytics.
  expectState(analytics, pr("Mixpanel purchase event", ["src/analytics/mixpanel.ts", M("src/auth/google.ts")]), "CHANGE_REQUIRED");
  const result = evaluate(parsed, stripe);
  assert.ok(result.detectedDelta.some((d) => d.includes("apart from stripe")), result.detectedDelta.join(" | "));
});

test("11. a narrower inclusion the pull request never names doesn't clear the qualifier question", () => {
  const prose = scopeFromSow("# SOW\n## 1.1 Store\nIncludes order management and sales reports.\nOut of scope: custom reports.\n");
  expectReview(prose, pr("Report builder for admins", ["src/admin/reports/ReportBuilder.tsx", M("src/admin/orders.ts")]));
  expectReview(scope({ included: ["sales reports"], excluded: ["custom reports"] }), pr("Ad-hoc report builder: pick columns", ["src/reports/builder/ColumnPicker.tsx", "src/reports/builder/query.ts"]));
  expectReview(scopeFromSow("# SOW\n## 1.1 Store\nIncludes product search.\nOut of scope: advanced search.\n"), pr("Faceted search with brand filters", ["src/search/facets.ts", M("src/search/SearchPage.tsx")]));
  const narrower = scope({
    included: ["order management", "sales reports", "product search", "admin dashboard"],
    excluded: ["custom reports", "advanced search", "custom dashboards"],
  });
  expectReview(narrower, pr("Dashboard builder: drag-and-drop widgets", ["src/dashboard/builder/WidgetGrid.tsx"]));
  expectState(narrower, pr("Fix date range on monthly sales report", ["src/reports/sales.ts"]), "IN_SCOPE");
  expectState(narrower, pr("Fix product search pagination", [M("src/search/SearchPage.tsx")]), "IN_SCOPE");
  expectState(narrower, pr("Custom report builder", ["src/reports/custom-builder.ts"]), "CHANGE_REQUIRED");
});

test("12. common exclusion headings and predicates are read", () => {
  const giftPR = pr("Add gift cards", ["src/giftcards/redeem.ts", M("src/checkout/cart.ts")], { branch: "feature/gift-cards" });
  const agency = scopeFromSow(
    "# Website Rebuild — Statement of Work\n## 1. Project Overview\nRebuild of the marketing site and online store on Next.js.\n## 2. Deliverables\n- Product catalogue and search\n- Shopping cart\n- Stripe checkout\n- Order confirmation emails\n## 3. Scope Exclusions\nThe following items are excluded from this SOW and may be quoted separately:\n- Gift cards\n- Loyalty points\n- Native mobile apps\n",
  );
  expectState(agency, giftPR, "CHANGE_REQUIRED");
  expectState(agency, pr("Native mobile app shell", ["mobile/App.tsx"]), "CHANGE_REQUIRED");
  const inScope = (rest: string) =>
    scopeFromSow(`# SOW\n## 1. In Scope\n- Product catalogue and search\n- Shopping cart\n- Stripe checkout\n\n${rest}\n`);
  for (const rest of [
    "## 2.1 Exclusions\nThe following items are excluded from this SOW:\n- Gift cards",
    "Out of scope for Phase 1 (may be quoted separately): gift cards, loyalty points.",
    "## 2.1 Scope Exclusions\n- Gift cards",
    "## Out-of-Scope Items\n- Gift cards",
    "**Out of Scope (Phase 2):**\n- Gift cards",
    "Out of scope -\n- Gift cards",
    "## What's not included\n- Gift cards",
    "Gift cards are outside the scope of this SOW.",
    "Gift cards will not be included.",
    "Gift cards shall be excluded.",
    "Gift cards fall outside the scope of this engagement.",
    "Not included in this SOW:\n- Gift cards",
    "## Excluded Services\n- Gift cards",
  ]) {
    expectState(inScope(rest), giftPR, "CHANGE_REQUIRED");
  }
  expectState(
    scopeFromSow("# SOW\n## 1.1 Storefront\nThe Agency shall deliver the product catalogue, shopping cart and Stripe checkout.\n## 3. Out-of-Scope Items\n- Gift cards\n"),
    giftPR,
    "CHANGE_REQUIRED",
  );
  // Sentences about how the product behaves, and assumptions, are not exclusions.
  expectNotExcluded(
    inScope("Out-of-stock products will not be included in search results."),
    pr("Show out-of-stock products with a badge", [M("src/catalog/ProductCard.tsx"), M("src/search/results.ts")]),
  );
  expectNotExcluded(inScope("Draft orders shall be excluded from the sales report."), pr("Draft orders in admin", ["src/admin/orders/drafts.ts"]));
  expectNotExcluded(
    inScope("## Assumptions and Exclusions\n- The Client will supply Stripe API credentials"),
    pr("Stripe checkout: read API credentials from env", [M("src/checkout/stripe.ts")]),
  );
});

test("13. 'other', 'additional' and 'alternative' payment providers don't make the included provider's work a change order", () => {
  const stripe = pr("Stripe payment provider: 3D Secure", [M("src/payments/providers/stripe.ts"), M("src/checkout/cart.ts")]);
  expectReview(
    scopeFromSow("# SOW\n## 2.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\n\nOut of scope: integration with other payment providers.\n"),
    stripe,
  );
  const additional = scope({ included: STORE_INCLUDED, excluded: ["additional payment providers (paypal, klarna, apple pay)"] });
  expectReview(additional, stripe);
  expectReview(scope({ included: STORE_INCLUDED, excluded: ["alternative payment gateways"] }), pr("Stripe gateway retries", [M("src/payments/gateways/stripe.ts")]));
  // A named example, or work that says the word itself, is still excluded.
  expectState(additional, pr("Add Klarna payment provider", ["src/payments/providers/klarna.ts", M("src/checkout/cart.ts")]), "CHANGE_REQUIRED");
  expectState(
    scope({ included: STORE_INCLUDED, excluded: ["additional payment providers"] }),
    pr("Add Klarna as an additional payment provider", ["src/payments/providers/klarna.ts"]),
    "CHANGE_REQUIRED",
  );
  expectState(scope({ included: ["up to 10 landing pages"], excluded: ["additional pages"] }), pr("Additional landing page for spring sale", ["src/pages/landing/spring-sale.tsx"]), "CHANGE_REQUIRED");
  // An included provider never clears another one: a question, never in scope.
  expectReview(scope({ included: ["payment gateway integration (stripe)"], excluded: ["alternative payment gateways"] }), pr("Add Adyen payment gateway", ["src/payments/gateways/adyen.ts"]));
  expectReview(scope({ included: ["third-party integration with stripe"], excluded: ["all other third-party integrations"] }), pr("Sync newsletter signups to Mailchimp", ["src/integrations/third-party/mailchimp.ts"]));
  // Built without the word: the same question.
  expectReview(scope({ included: STORE_INCLUDED, excluded: ["additional languages"] }), pr("Language switcher", ["src/i18n/LanguageSwitcher.tsx"]));
});

test("14. a capability doesn't override an item's exception", () => {
  const auth = scopeFromSow("## 3.2 Authentication\n\nIncludes email and password login, password reset and Google sign-in.\n\nExcludes single sign-on except Google.\n");
  const googleSso = pr("Google SSO", ["src/auth/sso/google.ts", M("src/auth/LoginPage.tsx")]);
  expectNotExcluded(auth, googleSso);
  expectNotExcluded(
    scopeFromSow("## 3.2 Authentication\n\nIncludes email and password login, password reset and Google sign-in.\n\n**Explicit Exclusions**:\n- Single sign-on except Google\n"),
    googleSso,
  );
  expectNotExcluded(
    scopeFromSow("## 3.1 Authentication\n\nIncludes email and password login, password reset and sign-in with Google Workspace.\n\nSingle sign-on (SSO) with identity providers other than Google Workspace is out of scope.\n"),
    pr("Google Workspace SSO", ["src/auth/sso/google-workspace.ts"], { branch: "feat/google-workspace-sso" }),
  );
  expectNotExcluded(
    scopeFromSow("## 4.1 Reporting\n\nIncludes an orders dashboard with filters.\n\nExports other than CSV are out of scope.\n"),
    pr("Export orders to CSV", ["src/orders/exportCsv.ts", M("src/orders/OrdersPage.tsx")]),
  );
  expectNotExcluded(
    scopeFromSow("# SOW\n## 1.1 Auth\nIncludes email and password login.\n\n**Explicit Exclusions**:\n- Third-party integrations other than the client's identity provider (Okta)\n"),
    pr("Okta login", ["src/auth/okta.ts"]),
  );
  // Work outside the exception is still excluded by the capability.
  expectState(auth, pr("Okta SAML login", ["src/auth/sso/okta-saml.ts"]), "CHANGE_REQUIRED");
  expectState(auth, pr("Azure AD single sign-on", ["src/auth/sso/azure-ad.ts"]), "CHANGE_REQUIRED");
  expectState(scope({ included: ["orders dashboard"], excluded: ["data exports except csv"] }), pr("Export orders to PDF", ["src/orders/exportPdf.ts"]), "CHANGE_REQUIRED");
  expectState(scope({ included: ["shopping cart"], excluded: ["single sign-on (sso)"] }), pr("Okta SAML login", ["src/auth/sso/okta-saml.ts"]), "CHANGE_REQUIRED");
});

test("15. a '.' inside a list ('e.g.', 'etc.', 'WCAG 2.1', 'v2.0') doesn't end it", () => {
  const sow = (line: string) =>
    scopeFromSow(`# Acme Storefront SOW\n\n## 1.1 Storefront and Checkout\nThe Supplier shall deliver a product catalogue and search, a shopping cart and Stripe checkout.\n${line}\n`);
  const gift = pr("Add gift cards", ["src/giftcards/redeem.ts", M("src/checkout/cart.ts")]);
  for (const line of [
    "Excludes native mobile apps (i.e. iOS and Android), gift cards and loyalty points.",
    "Out of scope: additional payment providers (e.g. PayPal), gift cards and loyalty points.",
    "Out of scope: additional payment providers (e.g., PayPal), gift cards and loyalty points.",
    "Explicitly excludes CRM integrations (Salesforce, HubSpot, etc.), gift cards and loyalty points.",
    "Excludes WCAG 2.1 AA compliance, gift cards and loyalty points.",
    "Out of scope: v2.0 redesign, gift cards and loyalty points.",
    "The project does not include payment providers (e.g. PayPal) or gift cards.",
  ]) {
    expectState(sow(line), gift, "CHANGE_REQUIRED");
  }
  expectState(
    sow("Excludes third-party integrations (e.g. Salesforce, HubSpot)."),
    pr("Sync orders to Salesforce", ["src/integrations/salesforce/client.ts", M("src/checkout/cart.ts")]),
    "CHANGE_REQUIRED",
  );
  // "Node.js" stays one word: "node" alone is not excluded.
  expectNotExcluded(sow("Excludes a Node.js backend rewrite."), pr("Show node count in category tree", [M("src/catalog/CategoryTree.tsx")]));
  expectState(
    scopeFromSow("# SOW\n## 1.1 Store\nThe Supplier shall deliver a product catalogue (e.g. search and filters), a shopping cart and Stripe checkout.\n"),
    pr("Shopping cart quantity fix", [M("src/checkout/cart.ts")]),
    "IN_SCOPE",
  );
});

test("16. the first example after 'such as', 'including' or 'e.g.' is excluded too", () => {
  const sow = (line: string) => scopeFromSow(`# SOW\n## 1.1 Store\nIncludes product catalogue, shopping cart and Stripe checkout.\n${line}\n`);
  const salesforce = pr("Sync orders to Salesforce", ["src/integrations/salesforce/client.ts", M("src/checkout/cart.ts")], { branch: "feat/salesforce-sync" });
  const hubspot = pr("Sync new customers to HubSpot", ["src/integrations/hubspot.ts", M("src/checkout/cart.ts")]);
  for (const line of [
    "Excludes CRM integrations including Salesforce and HubSpot.",
    "Excludes CRM integrations, e.g. Salesforce and HubSpot.",
    "Excludes CRM integrations, including, but not limited to, Salesforce and HubSpot.",
    "Integrations with CRM systems such as Salesforce or HubSpot are out of scope.",
    "Excludes CRM integrations, for example Salesforce or HubSpot.",
    "Excludes CRM integrations (e.g. Salesforce, HubSpot).",
  ]) {
    expectState(sow(line), salesforce, "CHANGE_REQUIRED");
    expectState(sow(line), hubspot, "CHANGE_REQUIRED");
  }
  expectState(scope({ included: STORE_INCLUDED, excluded: ["crm integrations including salesforce and hubspot"] }), salesforce, "CHANGE_REQUIRED");
  // PayPal named without "payment" or "gateway": a question, as "(PayPal, Klarna)" is.
  const paypal = pr("Add PayPal to checkout", ["src/checkout/paypal.ts", M("src/checkout/cart.ts")], { branch: "feat/paypal" });
  expectReview(sow("Excludes additional payment gateways such as PayPal, Klarna or Adyen."), paypal);
  expectReview(sow("**Explicit Exclusions**:\n- Additional payment gateways such as PayPal or Klarna"), paypal);
  // An included item's examples don't clear an excluded qualified variant.
  expectReview(
    scope({ included: ["product catalogue including keyword search", "shopping cart"], excluded: ["advanced search"] }),
    pr("Faceted search with price and brand filters", ["src/search/facets.ts"]),
  );
});

test("17. a bracket on the first exception doesn't turn the rest of the exception list into exclusions", () => {
  const sendgrid = pr("Send order confirmation emails via SendGrid", ["src/email/sendgrid.ts", M("src/checkout/cart.ts")], { branch: "feat/sendgrid-order-emails" });
  const deliverables = scopeFromSow(
    "# SOW\n## 3. Deliverables\nThe Agency will deliver the storefront, shopping cart, Stripe checkout and order confirmation emails sent through SendGrid.\n\n## 4. Exclusions\nThe following are excluded: third-party integrations other than Stripe (payments) and SendGrid (email); native mobile apps; loyalty points.\n",
  );
  expectNotExcluded(deliverables, sendgrid);
  expectNotExcluded(deliverables, pr("Password reset email through SendGrid", ["src/email/sendgrid/password-reset.ts"]));
  expectState(deliverables, pr("Native mobile app shell", ["mobile/native/App.tsx"]), "CHANGE_REQUIRED");
  expectState(deliverables, pr("Stripe checkout retries", ["src/checkout/stripe-retry.ts"]), "IN_SCOPE");
  const sow = (line: string) => scopeFromSow(`# SOW\n## 1.1 Store\nIncludes product catalogue, shopping cart and Stripe checkout.\n${line}\n`);
  expectNotExcluded(sow("Excludes third-party integrations except Stripe (payments) and SendGrid (email)."), sendgrid);
  expectNotExcluded(sow("Third-party integrations other than Stripe (payments) and SendGrid (transactional email) are out of scope."), sendgrid);
  expectNotExcluded(
    scope({ included: ["shopping cart", "stripe checkout"], excluded: ["third-party integrations other than stripe (payments) and sendgrid (transactional email)"] }),
    sendgrid,
  );
  const nested = sow("Third-party integrations (other than Stripe (payments) and SendGrid (email)) and gift cards are out of scope.");
  expectNotExcluded(nested, sendgrid);
  expectState(nested, pr("Add gift cards", ["src/giftcards/redeem.ts", M("src/checkout/cart.ts")]), "CHANGE_REQUIRED");
});

test("18. a bracket that never closes doesn't fold the rest of the list into the exception", () => {
  const sow = (line: string) =>
    scopeFromSow(`# Statement of Work\n\n## 1. Storefront and Checkout\n\nIn scope: product catalogue and search, shopping cart, Stripe checkout.\n\n${line}\n`);
  const unclosed = sow("Out of scope: payment providers (other than Stripe, gift cards and loyalty points.");
  const gift = pr("Add gift cards", ["src/giftcards/redeem.ts", M("src/checkout/cart.ts")]);
  expectState(unclosed, gift, "CHANGE_REQUIRED");
  expectState(unclosed, pr("Loyalty points programme", ["src/loyalty/points.ts", M("src/checkout/cart.ts")]), "CHANGE_REQUIRED");
  expectState(unclosed, pr("Stripe checkout retries", ["src/checkout/stripe-retry.ts"]), "IN_SCOPE");
  expectState(sow("Explicitly excludes payment providers (other than Stripe, native mobile apps and gift cards."), gift, "CHANGE_REQUIRED");
  expectReview(scope({ included: ["shopping cart"], excluded: ["payment providers (other than stripe, gift cards and loyalty points"] }), gift);
});

test("19. a typographic hyphen reads like '-'", () => {
  const sample = (hyphen: string) =>
    scopeFromSow(
      `# SOW\n\n## 3.1 Storefront and Checkout\nA single currency (GBP) store.\n\n**Explicit Inclusions**:\n- Product catalogue and search\n- Shopping cart\n- Stripe checkout\n\n**Explicit Exclusions**:\n- Loyalty points programme\n- Multi${hyphen}currency pricing\n- Gift cards\n`,
    );
  for (const hyphen of ["\u2010", "\u2011", "\u2013"]) {
    expectReview(sample(hyphen), pr("Currency pricing rounding fix for GBP", [M("src/pricing/currency-pricing.ts")]));
    expectState(sample(hyphen), pr("Add multi-currency pricing", ["src/pricing/multi-currency.ts"]), "CHANGE_REQUIRED");
  }
  const drafted = scopeFromSow(
    "# SOW\n## 1.1 Store\n**In scope**\n- Product catalogue and search\n- Shopping cart\n- Stripe checkout\n- Email and password login\n\n**Out of scope**\n- Loyalty points programme\n- Multi\u2011currency pricing\n- Two\u2011factor authentication\n- In\u2011app purchases\n- Gift cards\n",
  );
  expectNotExcluded(drafted, pr("Factor out auth helpers", [M("src/auth/session.ts")]));
  expectNotExcluded(drafted, pr("Purchase confirmation email", ["src/checkout/emails/PurchaseConfirmation.tsx"]));
  expectState(drafted, pr("Add 2FA via TOTP two-factor", ["src/auth/two-factor.ts"]), "CHANGE_REQUIRED");
  // Saved items, and items stored before this change, read the same way.
  assert.deepStrictEqual(checklistFromBaseline(scope({ excluded: ["Multi\u2011currency pricing"] })).clauses[0].excluded, ["multi-currency pricing"]);
  const stored = { ...STORE, clauses: STORE.clauses.map((c) => ({ ...c, exclusions: c.exclusions.map((e) => e.replace("-", "\u2011")) })) };
  expectReview(stored, pr("Currency pricing rounding fix for GBP", [M("src/pricing/currency-pricing.ts")]));
});

test("long exception lists in one item and numbered exclusion sections evaluate in well under a second", () => {
  const files: FileSpec[] = Array.from({ length: 300 }, (_, i) => `src/payments/providers/stripe${i}/gift/cards/item${i}.ts`);
  const items = [
    "a other than b, ".repeat(2500),
    Array.from({ length: 2400 }, (_, i) => `a${i} other than b${i}, `).join(""),
    "x (other than y) and ".repeat(1900),
    "c such as d ".repeat(3400),
    "(other than a, ".repeat(2700),
  ].map((item) => item.slice(0, 40_000));
  for (const item of items) {
    const baseline = scope({ included: ["shopping cart"], excluded: [item] });
    const elapsed = time(() => evaluate(baseline, pr("Gift cards other than such as", files)));
    assert.ok(elapsed < 1000, `${item.slice(0, 30)}: took ${Math.round(elapsed)} ms`);
  }
  const numbered = ("## 1.1 A\nIncludes a cart.\n4. Exclusions\n" + Array.from({ length: 3000 }, (_, i) => `4.${i + 1} Gift card item ${i}.`).join("\n")).slice(0, 40_000);
  const elapsed = time(() => evaluate(scopeFromSow(numbered), pr("Gift cards", files)));
  assert.ok(elapsed < 1000, `numbered exclusions: took ${Math.round(elapsed)} ms`);
});


/* ------------------------------------------------------------------ */
/* Vocabulary: a category named in the SOW knows its members            */
/* ------------------------------------------------------------------ */
console.log("\n▶ Vocabulary: a category named in the SOW recognises its members");

/** One excluded item against the sample storefront, which includes Stripe checkout. */
const EXCLUDING = (...excluded: string[]) => scope({ title: "Storefront", included: STORE_INCLUDED, excluded });

/**
 * Per category: an excluded item naming it, a pull request building one of
 * its members (a change order), and a look-alike that is not one (never a
 * change order).
 */
const CATEGORY_CASES: Array<{ id: string; excluded: string; builds: PullRequest; lookAlike: PullRequest }> = [
  {
    id: "native_mobile_app",
    excluded: "native mobile apps",
    builds: pr("iOS app shell with product catalogue", ["ios/AcmeStore/AppDelegate.swift", "ios/AcmeStore/CatalogViewController.swift"]),
    lookAlike: pr("Home screen icons for the shopping cart", ["public/apple-touch-icon.png", "public/android-chrome-192x192.png", M("public/site.webmanifest")]),
  },
  {
    id: "payment_provider",
    excluded: "payment providers other than stripe",
    builds: pr("Add Klarna payment provider", ["src/payments/klarna-provider.ts", M("src/checkout/cart.ts")]),
    lookAlike: pr("Square image crop on product catalogue cards", [M("src/catalog/ProductCard.tsx")]),
  },
  {
    id: "social_login",
    excluded: "social login other than google",
    builds: pr("Sign in with Apple", ["src/auth/apple-signin.ts", M("src/auth/login.ts")]),
    lookAlike: pr("Apple Pay button on Stripe checkout", ["src/checkout/ApplePayButton.tsx"]),
  },
  {
    id: "multi_language",
    excluded: "localisation",
    builds: pr("German storefront", ["src/locales/de/common.json", M("src/catalog/ProductPage.tsx")]),
    lookAlike: pr("Fix error message translations", [M("src/i18n/en.json")]),
  },
  {
    id: "analytics",
    excluded: "analytics",
    builds: pr("Track add-to-cart", ["src/analytics/mixpanel.ts", M("src/checkout/cart.ts")]),
    lookAlike: pr("Shopping cart: parse the path segment of the URL", [M("src/cart/url-segment.ts")]),
  },
  {
    id: "crm",
    excluded: "crm integration",
    builds: pr("Sync customers", ["src/crm/hubspot.ts"]),
    lookAlike: pr("Shopping cart contact form", ["src/cart/ContactForm.tsx"]),
  },
  {
    id: "email_marketing",
    excluded: "email marketing",
    builds: pr("Abandoned cart emails", ["src/marketing/klaviyo.ts", M("src/checkout/cart.ts")]),
    lookAlike: pr("SendGrid order confirmation for the shopping cart", ["src/email/sendgrid.ts"]),
  },
  {
    id: "helpdesk",
    excluded: "helpdesk integration",
    builds: pr("Ticket on failed order", ["src/support/zendesk.ts"]),
    lookAlike: pr("Shopping cart support page copy", [M("src/cart/SupportCopy.tsx")]),
  },
  {
    id: "live_chat",
    excluded: "live chat",
    builds: pr("Chat widget on product pages", ["src/chat/intercom.ts"]),
    lookAlike: pr("AI chatbot for product questions", ["src/chatbot/bot.ts"]),
  },
  {
    id: "chatbot",
    excluded: "ai chatbot",
    builds: pr("Product questions assistant", ["src/assistant/openai-chat.ts"]),
    lookAlike: pr("OpenAI product descriptions for the catalogue", ["src/catalog/openai-descriptions.ts"]),
  },
  {
    id: "search_engine",
    excluded: "third-party search engines",
    builds: pr("Product search index", ["src/search/algolia.ts"]),
    lookAlike: pr("Open search panel on product catalogue", [M("src/catalog/SearchPanel.tsx")]),
  },
  {
    id: "marketplace",
    excluded: "multi-vendor marketplace functionality",
    builds: pr("Vendor onboarding and payouts", ["src/vendors/onboarding.ts", M("src/catalog/product.ts")]),
    lookAlike: pr("Update vendored chart library for the shopping cart", [M("vendor/chart.js"), M("src/cart/Chart.tsx")]),
  },
  {
    id: "data_migration",
    excluded: "data migration from the legacy platform",
    builds: pr("Import legacy customers from Magento", ["scripts/data-migration/magento-customers.ts", M("src/accounts/customer.ts")]),
    lookAlike: pr("Shopping cart table", ["db/migrations/0012_cart.sql", M("src/cart/cart.ts")]),
  },
  {
    id: "subscriptions",
    excluded: "product subscriptions",
    builds: pr("Subscribe and save: recurring orders", ["src/subscriptions/plan.ts", M("src/checkout/cart.ts")]),
    lookAlike: pr("GraphQL subscription for shopping cart updates", ["src/graphql/cartSubscription.ts"]),
  },
  {
    id: "loyalty",
    excluded: "loyalty programme",
    builds: pr("Loyalty points on orders", ["src/loyalty/points.ts", M("src/checkout/cart.ts")]),
    lookAlike: pr("Shopping cart breakpoint fix", [M("src/cart/Cart.css")]),
  },
  {
    id: "push_notifications",
    excluded: "push notifications",
    builds: pr("Order status alerts", ["src/notifications/push/fcm.ts"]),
    lookAlike: pr("Shopping cart: router push after checkout", [M("src/cart/Cart.tsx")]),
  },
  {
    id: "sms",
    excluded: "sms notifications",
    builds: pr("Order updates by text", ["src/notifications/sms/twilio.ts"]),
    lookAlike: pr("Shopping cart message banner", [M("src/cart/MessageBanner.tsx")]),
  },
  {
    id: "notifications",
    excluded: "notifications other than email",
    builds: pr("WhatsApp order updates", ["src/notifications/whatsapp.ts", M("src/notifications/order-status.ts")]),
    lookAlike: pr("Order shipped email notification", ["src/notifications/email/shipped.ts"]),
  },
  {
    id: "maps",
    excluded: "store locator",
    builds: pr("Find a store", ["src/stores/GoogleMap.tsx"]),
    lookAlike: pr("Sitemap for the product catalogue", ["src/seo/sitemap.ts"]),
  },
  {
    id: "video",
    excluded: "video hosting",
    builds: pr("Product videos", ["src/video/vimeo.ts"]),
    lookAlike: pr("Footer YouTube icon link", [M("src/layout/Footer.tsx")]),
  },
  {
    id: "gift_cards",
    excluded: "gift certificates",
    builds: pr("E-gift cards at checkout", ["src/checkout/egift-cards.ts"]),
    lookAlike: pr("Gift wrapping option on the shopping cart", ["src/cart/gift-wrap.tsx"]),
  },
  {
    id: "two_factor",
    excluded: "two-factor authentication",
    builds: pr("TOTP setup", ["src/auth/totp.ts"]),
    lookAlike: pr("Email OTP for passwordless login", ["src/auth/email-otp.ts"]),
  },
  {
    id: "shipping_integration",
    excluded: "shipping carrier integrations",
    builds: pr("Live rates at checkout", ["src/shipping/shipstation.ts"]),
    lookAlike: pr("Shopping cart: ups and downs of quantity stepper", [M("src/cart/Stepper.tsx")]),
  },
  {
    id: "tax_service",
    excluded: "tax calculation service",
    builds: pr("Sales tax at checkout", ["src/tax/avalara.ts"]),
    lookAlike: pr("Show VAT line in the shopping cart", [M("src/cart/Totals.tsx")]),
  },
  {
    id: "erp_accounting",
    excluded: "erp integration",
    builds: pr("Push orders", ["src/erp/netsuite.ts"]),
    lookAlike: pr("Shopping cart order summary", [M("src/cart/Summary.tsx")]),
  },
  {
    id: "cms",
    excluded: "headless cms",
    builds: pr("Product content", ["src/cms/contentful.ts"]),
    lookAlike: pr("Product catalogue content tweaks", [M("src/catalog/content.ts")]),
  },
  {
    id: "review_platform",
    excluded: "review platform integration",
    builds: pr("Product reviews widget", ["src/reviews/trustpilot.ts"]),
    lookAlike: pr("Shopping cart review step", [M("src/cart/ReviewStep.tsx")]),
  },
  {
    id: "ab_testing",
    excluded: "a/b testing",
    builds: pr("Checkout experiment", ["src/experiments/optimizely.ts"]),
    lookAlike: pr("Shopping cart unit tests", [M("src/cart/cart.ts")]),
  },
  {
    id: "third_party_integrations",
    excluded: "third-party integrations",
    builds: pr("Sync orders to Salesforce", ["src/integrations/salesforce/client.ts", M("src/checkout/cart.ts")]),
    lookAlike: pr("Stripe checkout fix", [M("src/integrations/stripe.ts")]),
  },
];

test("every category in the vocabulary has a true positive and a look-alike here", () => {
  const covered = new Set(CATEGORY_CASES.map((c) => c.id));
  for (const category of VOCABULARY) assert.ok(covered.has(category.id), `no test for ${category.id}`);
  assert.strictEqual(covered.size, VOCABULARY.length);
});

// Work that uses the excluded item's own words ("Add Klarna payment provider")
// is a change order on those words; a member read from the category alone
// only asks.
const SAYS_THE_ITEM = new Set(["payment_provider", "analytics", "crm", "push_notifications", "sms", "notifications", "erp_accounting"]);

for (const { id, excluded, builds, lookAlike } of CATEGORY_CASES) {
  test(`${id}: "${excluded}" catches "${builds.title}", not "${lookAlike.title}"`, () => {
    const baseline = EXCLUDING(excluded);
    expectState(baseline, builds, SAYS_THE_ITEM.has(id) ? "CHANGE_REQUIRED" : "REVIEW_REQUIRED");
    expectNotExcluded(baseline, lookAlike);
  });
}

test("the question names what was built and the contract's words for it", () => {
  const result = expectReview(EXCLUDING("payment providers other than stripe"), pr("Add Klarna", ["src/payments/klarna.ts"]));
  assert.ok(
    result.detectedDelta.some((d) => d.includes("Builds Klarna") && d.includes('"payment providers"') && d.includes("doesn't name Klarna")),
    result.detectedDelta.join(" | "),
  );
});

test("a member the contract names itself is a change order that says it", () => {
  const baseline = scopeFromSow("# SOW\n## 1.1 Accounts\nIncludes email and password login and social login (Google and Facebook only, not Apple).\n");
  const result = evaluate(baseline, pr("Apple sign-in", ["src/auth/social/apple.ts"]));
  assert.strictEqual(result.state, "CHANGE_REQUIRED", result.detectedDelta.join(" | "));
  const draft = draftChangeOrder({ evaluation: result, pullRequestTitle: "Apple sign-in" });
  assert.ok(draft && draft.subject.includes("apple (social login)"), draft?.subject);
});

test("an approved change order covers the member it names, not another member of the category", () => {
  const baseline = EXCLUDING("payment providers other than stripe");
  const klarna = pr("Add Klarna", ["src/payments/klarna.ts"]);
  const order = (title: string) => ({
    id: "CO-1",
    contractId: "c",
    baselineVersion: "v1",
    title,
    reason: title,
    authorizedSubsystems: [],
    hours: { min: 1, max: 1 },
    amount: 0,
    status: "APPROVED" as const,
  });
  const approved = (title: string) =>
    evaluateCommercialScope({ baseline, pullRequest: klarna, issue: pullRequestAsWorkItem(), approvedChangeOrders: [order(title)], policyMode: "REVIEW" }).state;
  assert.strictEqual(approved("Add Klarna as a payment provider"), "APPROVED_CHANGE");
  assert.strictEqual(approved("Add PayPal as a payment provider"), "REVIEW_REQUIRED");
});

console.log("\n▶ Vocabulary: a member read from a category only asks");

// Read on contracts nobody tuned for, members alone drafted change orders for
// work a narrower item ("voice one-time codes", "iPad layouts") or another
// clause allowed. However clearly one is built, a person confirms it.
const says = (result: CommercialEvaluation, text: string) =>
  assert.ok(result.detectedDelta.some((d) => d.includes(text)), result.detectedDelta.join(" | "));

test("a member named only in a title, with nothing naming its category, says so", () => {
  const mobile = EXCLUDING("native mobile apps");
  expectReview(mobile, pr("React Native app: cart screen", ["apps/mobile/src/screens/CartScreen.tsx"]));
  expectReview(EXCLUDING("payment providers other than stripe"), pr("Add PayPal to checkout", ["src/checkout/paypal.ts", M("src/checkout/cart.ts")]));
  // Titled and branched in the item's own words ("native", "mobile app"): a change order on those words.
  expectState(mobile, pr("React Native app: cart screen", ["apps/mobile/src/screens/CartScreen.tsx"], { branch: "feat/mobile-app" }), "CHANGE_REQUIRED");
  // A path only that work has still only asks.
  says(expectReview(mobile, pr("Cart screen", ["android/app/src/main/java/com/acme/CartActivity.kt"])), "doesn't name Android");
  expectReview(mobile, pr("SwiftUI product list", ["App/Views/ProductList.swift"]));
  expectReview(mobile, pr("Flutter cart screen", ["lib/screens/cart.dart", "pubspec.yaml"]));
});

test("a narrower excluded item is not every member of its category", () => {
  const sow = scopeFromSow(
    "# SOW\n## 2.1 Sign-in\nIncludes email login with SMS one-time codes as the second factor.\n\n## 3. Out of scope\n- Voice one-time codes\n- iPad-optimised layouts\n",
  );
  expectNotExcluded(sow, pr("Fix 2FA redirect loop", [M("src/auth/two-factor/verify.ts")]));
  expectNotExcluded(sow, pr("Dark app icon", [M("Folio/Assets.xcassets/AppIcon.appiconset/Contents.json"), M("Folio.xcodeproj/project.pbxproj")]));
  // Built as the item's own word, it is a change order; a qualified item ("marketing SMS") only asks.
  expectState(EXCLUDING("sms"), pr("Text approvers", ["src/server/notifications/smsApprover.ts"]), "CHANGE_REQUIRED");
  expectReview(EXCLUDING("marketing sms"), pr("SMS appointment reminders", ["lib/sms/twilio.ts"], { branch: "feat/sms-reminders" }));
});

test("a member only described, or only in tests and docs, is a question", () => {
  const baseline = EXCLUDING("payment providers other than stripe");
  const described = expectReview(baseline, pr("Checkout tidy-up", [M("src/checkout/cart.ts")], { body: "Prepares the PayPal payment provider for next sprint." }));
  assert.ok(described.detectedDelta.some((d) => d.includes("no new code shows it")), described.detectedDelta.join(" | "));
  expectReview(baseline, pr("Klarna provider tests", ["src/payments/klarna-provider.test.ts"]));
});

test("a member's own name never corroborates it: 'pay' in PayPal is not 'payment'", () => {
  says(expectReview(EXCLUDING("payment providers other than stripe"), pr("PayPal", ["src/checkout/PayPalButton.tsx"])), "nothing next to it names");
  says(expectReview(EXCLUDING("payment providers other than stripe"), pr("Wallets", ["src/payments/PayPalButton.tsx"])), "doesn't name PayPal");
});

test("case-split names read whole: PayPal, GitHub, iOS, ApplePay", () => {
  assert.deepStrictEqual(vocabularyWords("src/auth/GitHubSignIn.tsx", "path"), ["src", "|", "auth", "|", "github", "signin", "|", "tsx"]);
  assert.deepStrictEqual(vocabularyWords("iOS app: ApplePayButton", "prose"), ["ios", "app", "|", "applepay", "button"]);
  // A space keeps words apart: "Open search" is not OpenSearch.
  assert.deepStrictEqual(vocabularyWords("Open search panel", "prose"), ["open", "search", "panel"]);
  says(expectReview(EXCLUDING("social login other than google"), pr("GitHub sign-in", ["src/auth/GitHubSignIn.tsx"])), "Builds GitHub");
});

test("a member is never evidence for an included category", () => {
  const baseline = scope({ included: ["analytics dashboard", "shopping cart"] });
  expectReview(baseline, pr("Add Mixpanel", ["src/tracking/mixpanel.ts"]));
  const social = scope({ included: ["social login"] });
  expectReview(social, pr("Add Facebook pixel", ["src/marketing/facebook-pixel.ts"]));
});

console.log("\n▶ Vocabulary: exceptions and what the SOW includes");

test("an exception still clears the member it names", () => {
  const baseline = EXCLUDING("payment providers other than stripe", "social login other than google", "analytics other than google analytics");
  expectState(baseline, pr("Stripe webhooks for refunds", ["src/payments/stripe/webhooks.ts", M("src/checkout/cart.ts")]), "IN_SCOPE");
  expectNotExcluded(baseline, pr("Google sign-in", ["src/auth/google.ts", M("src/auth/login.ts")]));
  // GA4 is Google Analytics: the item's own word "analytics" in its path is the allowed work.
  expectNotExcluded(baseline, pr("GA4 ecommerce events for the shopping cart", ["src/analytics/ga4.ts", M("src/checkout/cart.ts")]));
  expectState(baseline, pr("Mixpanel and GA4 events for the shopping cart", ["src/analytics/mixpanel.ts", "src/analytics/ga4.ts"]), "CHANGE_REQUIRED");
  says(expectReview(baseline, pr("Facebook login", ["src/auth/facebook.ts", M("src/auth/login.ts")])), "Builds Facebook");
  // Typed with "save for", as a PM writes it: still the exception.
  const saveFor = EXCLUDING("payment providers save for stripe");
  expectNotExcluded(saveFor, pr("Stripe payment provider: 3D Secure", [M("src/payments/providers/stripe.ts"), M("src/checkout/cart.ts")]));
  expectState(saveFor, pr("Add Klarna payment provider", ["src/payments/klarna-provider.ts"]), "CHANGE_REQUIRED");
  expectNotExcluded(EXCLUDING("gift cards"), pr("Save for later in the shopping cart", ["src/cart/save-for-later.ts"]));
});

test("work next to an exception or an included member may be that allowed work: a question", () => {
  const baseline = EXCLUDING("payment providers other than stripe");
  expectReview(baseline, pr("Apple Pay through the Stripe Payment Element", ["src/payments/apple-pay.ts"]));
  says(expectReview(baseline, pr("Add Klarna", ["src/payments/klarna.ts", M("src/payments/stripe.ts")])), "also works on");
  says(expectReview(baseline, pr("Add Klarna", ["src/payments/klarna.ts"])), "doesn't name Klarna");
});

test("a member the SOW includes elsewhere stays in scope against an excluded category", () => {
  const baseline = scopeFromSow("# SOW\n## 1.1 Checkout\nIncludes payments via Stripe and a shopping cart.\nOut of scope: payment providers.\n");
  expectState(baseline, pr("Stripe payment provider: webhooks", [M("src/payments/providers/stripe.ts")]), "IN_SCOPE");
  expectState(baseline, pr("PayPal payment provider", ["src/payments/providers/paypal.ts"]), "CHANGE_REQUIRED");
  const bracketed = scope({ included: STORE_INCLUDED, excluded: ["payment providers [paypal, klarna]"] });
  expectNotExcluded(bracketed, pr("Stripe payment provider: 3D Secure", [M("src/payments/providers/stripe.ts"), M("src/checkout/cart.ts")]));
  // A brand in an included list is not an included login.
  const brands = scope({ included: ["product search by brand (apple, samsung)", "email login"], excluded: ["social login"] });
  says(expectReview(brands, pr("Sign in with Apple", ["src/auth/apple-signin.ts"])), "Builds Apple");
});

test("what an included item says it leaves out ('not Apple') is excluded", () => {
  const baseline = scopeFromSow("# SOW\n## 1.1 Accounts\nIncludes email and password login and social login (Google and Facebook only, not Apple).\n");
  expectState(baseline, pr("Apple sign-in", ["src/auth/social/apple.ts", M("src/auth/social/index.ts")]), "CHANGE_REQUIRED");
  expectState(baseline, pr("Google sign-in", ["src/auth/social/google.ts"]), "IN_SCOPE");
  expectNotExcluded(baseline, pr("Apple touch icon for the login page", ["public/apple-touch-icon.png", M("src/auth/LoginPage.tsx")]));
});

test("members listed after an exception may belong to it: a question", () => {
  expectReview(BULLET_SOW("All third-party integrations except Stripe, including CRM and ERP systems"), pr("Sync customers to the CRM", ["src/integrations/crm/hubspot-sync.ts", M("src/checkout/cart.ts")]));
  expectReview(BULLET_SOW("Payment gateways other than Stripe, such as PayPal or Klarna"), pr("Add PayPal", ["src/payments/paypal.ts"]));
});

console.log("\n▶ Vocabulary: qualified and additive categories");

test("'multi-language' and 'additional languages' ask, unless the work says it", () => {
  const multi = EXCLUDING("multi-language support");
  expectReview(multi, pr("French translations for product pages", ["src/i18n/fr.json", "src/i18n/index.ts", M("src/catalog/ProductPage.tsx")]));
  expectState(multi, pr("Multi-language: add German", ["src/locales/de/common.json"]), "CHANGE_REQUIRED");
  expectReview(EXCLUDING("additional languages"), pr("French translations for product pages", ["src/i18n/fr.json"]));
  // An English-only change is no language at all.
  expectNotExcluded(multi, pr("Fix error message translations", [M("src/i18n/en.json"), M("src/locales/en-GB/errors.json")]));
  expectNotExcluded(EXCLUDING("translations"), pr("Animate the shopping cart drawer with translateX", [M("src/cart/Drawer.css")]));
});

test("'additional', 'other' and 'custom' ask, unless the work says it", () => {
  expectReview(EXCLUDING("additional payment methods"), pr("Klarna payment method", ["src/payments/klarna.ts"]));
  expectState(EXCLUDING("additional payment methods"), pr("Klarna as an additional payment method", ["src/payments/klarna.ts"]), "CHANGE_REQUIRED");
  expectReview(EXCLUDING("custom integrations"), pr("Sync orders to Salesforce", ["src/integrations/salesforce/client.ts", M("src/checkout/cart.ts")]));
  expectReview(EXCLUDING("advanced analytics"), pr("Mixpanel events", ["src/analytics/mixpanel.ts", M("src/checkout/cart.ts")]));
});

test("an item naming one variant ('native iOS app') only asks about another", () => {
  const ios = EXCLUDING("native ios app");
  says(expectReview(ios, pr("Product list", ["ios/App/ProductList.swift"])), "doesn't name");
  says(expectReview(ios, pr("Cart screen", ["android/app/src/main/java/com/acme/CartActivity.kt"])), "nothing next to it names");
  // Named by the contract itself ("android apps"): a change order on its words.
  expectState(EXCLUDING("native ios or android apps"), pr("Cart screen", ["android/app/src/main/java/com/acme/CartActivity.kt"]), "CHANGE_REQUIRED");
});

console.log("\n▶ Vocabulary: look-alikes are never members");

test("favicons and web-app icons are not native apps", () => {
  const mobile = EXCLUDING("native mobile apps");
  expectNotExcluded(mobile, pr("Shopping cart icons", ["public/android-chrome-512x512.png", "public/apple-touch-icon.png", "public/favicon.ico"]));
  // Read literally too: the icons' names never match an item that says "Android".
  const written = scopeFromSow("# SOW\n## 1.1 Storefront\nIncludes a PWA manifest and icons.\n\nThe Agency will not build a native mobile application for iOS or Android.\n");
  expectNotExcluded(written, pr("PWA icons", ["public/android-chrome-192x192.png", "public/android-chrome-512x512.png", M("public/site.webmanifest")]));
  expectState(mobile, pr("Fix iOS Safari keyboard overlap on the shopping cart", [M("src/cart/Cart.css")]), "IN_SCOPE");
  expectState(mobile, pr("Mobile responsive shopping cart layout", [M("src/cart/Cart.css")]), "IN_SCOPE");
  expectNotExcluded(mobile, pr("Shopping cart pricing service", ["src/main/kotlin/com/acme/CartService.kt"]));
  expectNotExcluded(mobile, pr("Shopping cart: detect iOS for the share sheet", ["src/cart/isIOS.ts"]));
});

test("Apple Pay is not Sign in with Apple; Google Analytics is not Google sign-in", () => {
  const social = EXCLUDING("social login");
  expectState(social, pr("Apple Pay on Stripe checkout", ["src/payments/apple-pay.ts"]), "IN_SCOPE");
  expectNotExcluded(social, pr("Google Analytics on the login page", ["src/analytics/google-analytics.ts", M("src/auth/LoginPage.tsx")]));
  expectNotExcluded(social, pr("GitHub Actions: run login tests", [".github/workflows/ci.yml"]));
  says(expectReview(social, pr("Google sign-in", ["src/auth/google.ts"])), "Builds Google");
  says(expectReview(EXCLUDING("payment providers other than stripe"), pr("Apple Pay express checkout", ["src/payments/apple-pay.ts"])), "Builds Apple Pay");
});

test("import statements and schema migrations are not a data migration", () => {
  const baseline = EXCLUDING("data migration from the legacy platform");
  expectState(baseline, pr("Fix import order in the shopping cart", [M("src/cart/cart.ts")]), "IN_SCOPE");
  expectNotExcluded(baseline, pr("Shopping cart schema", ["prisma/migrations/20260101_cart/migration.sql"]));
  expectNotExcluded(baseline, pr("Add magento_id to products", ["db/migrations/0042_add_magento_id.sql"]));
  says(expectReview(baseline, pr("WooCommerce CSV import", ["src/migration/woocommerce.ts"])), "Builds WooCommerce");
});

test("vendor/ directories and vendor chunks are not a marketplace", () => {
  const baseline = EXCLUDING("multi-vendor marketplace");
  expectNotExcluded(baseline, pr("Split vendor chunk", [M("webpack.config.js")]));
  expectState(baseline, pr("Show product vendor on the product catalogue", [M("src/catalog/Product.tsx")]), "IN_SCOPE");
  expectNotExcluded(baseline, pr("Best sellers row on the product catalogue", [M("src/catalog/BestSellers.tsx")]));
  expectReview(baseline, pr("Seller dashboard", ["src/sellers/dashboard.tsx"]));
});

test("a subscription in GraphQL, websockets or a newsletter is not a product subscription", () => {
  const baseline = EXCLUDING("product subscriptions");
  expectNotExcluded(baseline, pr("GraphQL subscription for shopping cart updates", ["src/graphql/cartSubscription.ts"]));
  expectNotExcluded(baseline, pr("Shopping cart: subscribe to stock updates", ["src/cart/useStockSubscription.ts"]));
  expectNotExcluded(baseline, pr("Newsletter subscribe form", ["src/newsletter/Subscribe.tsx"]));
  expectNotExcluded(baseline, pr("Shopping cart websocket subscription", ["src/realtime/socket.ts"]));
});

test("payment work stays in scope when Stripe checkout is included", () => {
  const baseline = EXCLUDING("payment providers other than stripe", "additional payment methods");
  expectState(baseline, pr("Fix payment form validation on the shopping cart", [M("src/checkout/PaymentForm.tsx"), M("src/checkout/cart.ts")]), "IN_SCOPE");
  expectState(baseline, pr("Stripe payment intents retry", [M("src/payments/stripe.ts")]), "IN_SCOPE");
  expectState(baseline, pr("Stripe Payment Request button", [M("src/payments/stripe/PaymentRequest.tsx")]), "IN_SCOPE");
});

test("other look-alikes: git push, router push, Array.map, sitemap, SEO, passwordless OTP", () => {
  expectNotExcluded(EXCLUDING("push notifications"), pr("CI: push docker image", [M(".github/workflows/deploy.yml")]));
  expectNotExcluded(EXCLUDING("store locator"), pr("Refactor shopping cart map helper", [M("src/cart/mapItems.ts")]));
  expectNotExcluded(EXCLUDING("search engine optimisation"), pr("Algolia search index", ["src/search/algolia.ts"]));
  expectNotExcluded(EXCLUDING("two-factor authentication"), pr("Magic link login", ["src/auth/magic-link.ts"]));
});

console.log("\n▶ Vocabulary: SOW wording read end to end");

test("new exclusion wording reaches the vocabulary", () => {
  const sow = (line: string) => scopeFromSow(`# SOW\n## 1.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\n${line}\n`);
  const ios = pr("iOS app shell with product catalogue", ["ios/AcmeStore/AppDelegate.swift"]);
  for (const line of [
    "We will not build native mobile apps.",
    "The Agency will not develop native mobile apps.",
    "Native mobile apps are not part of this engagement.",
    "This phase does not cover native mobile apps.",
    "No native mobile apps will be built.",
    "Neither native mobile apps nor gift cards are included.",
    "The Agency is not responsible for building native mobile apps.",
  ]) {
    says(expectReview(sow(line), ios), "native mobile apps");
  }
  expectReview(sow("The project shall not include the development of native mobile applications."), pr("Android app: shopping cart", ["android/app/src/main/java/com/acme/CartActivity.kt"]));
  // A requirement is not scope; an assumption about the Client is not excluded work.
  expectNotExcluded(sow("The storefront must not include native app banners."), ios);
  expectState(sow("The Client will not provide product photography."), pr("Product photography for the product catalogue", ["src/catalog/photos.ts"]), "IN_SCOPE");
  const mixed = scopeFromSow(
    "# SOW\n## 1.1 Storefront\nIncludes product catalogue, shopping cart and Stripe checkout.\n\n## 2. Assumptions and Exclusions\n- Client will provide product copy\n- Native mobile apps\n- Payment providers other than Stripe\n",
  );
  expectReview(mixed, pr("Android app: cart", ["android/app/src/main/java/com/acme/Cart.kt"]));
  expectReview(mixed, pr("Klarna payments", ["src/payments/klarna.ts"]));
  expectNotExcluded(mixed, pr("Product copy updates on the product catalogue", [M("src/catalog/copy.ts")]));
});

test("the demo's largest vocabulary-heavy check stays fast", () => {
  const camel = "PayPalApplePayGoogleAnalyticsGitHubSignInReactNativeSwiftUIiOSAndroidLanguageSwitcher";
  const dirs = ["ios", "android", "i18n/fr", "payments/paypal", "auth/apple", "analytics/mixpanel", "vendors/onboarding", "loyalty/points", "integrations/salesforce", "locales/de"];
  const files = Array.from({ length: 300 }, (_, i) => `src/${dirs[i % dirs.length]}/${camel}${i}.${i % 2 ? "swift" : "json"}`);
  const words = "paypal klarna apple pay google analytics sign in with apple ios android swiftui react native french translations i18n mixpanel hubspot vendor onboarding magento import subscribe and save loyalty points ";
  const body = words.repeat(Math.ceil(40_000 / words.length)).slice(0, 40_000);
  const names = CATEGORY_CASES.map((c) => c.excluded);
  const excluded = Array.from({ length: 500 }, (_, i) => `${names[i % names.length]} ${i}`);
  const included = Array.from({ length: 500 }, (_, i) => `stripe checkout, google sign-in and plausible analytics ${i} (not apple, no paypal)`);
  const clauses: Clause[] = [];
  for (let i = 0; i < 500; i += 100) clauses.push({ included: included.slice(i, i + 100), excluded: excluded.slice(i, i + 100) });
  const baseline = scope(...clauses);
  const pullRequest = pr("PayPal Apple Pay iOS React Native French translations", files, { body });
  evaluate(baseline, pullRequest);
  const elapsed = time(() => evaluate(baseline, pullRequest));
  assert.ok(elapsed < 600, `took ${Math.round(elapsed)} ms`);
  const camelBody = time(() => evaluate(baseline, pr("x", files, { body: "PayPal".repeat(6700) })));
  assert.ok(camelBody < 600, `one 40,000-character camelCase word took ${Math.round(camelBody)} ms`);
});

/* ------------------------------------------------------------------ */

console.log(`\nMATCHER TESTS: ${passed} PASSED / ${failures.length} FAILED\n`);
if (failures.length > 0) {
  for (const name of failures) console.error(`  - ${name}`);
  process.exitCode = 1;
}
