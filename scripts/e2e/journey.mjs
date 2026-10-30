// The journey a pilot PM takes, through the real UI, checked step by step.
// Each step is named for what a person would notice if it broke.

import path from "node:path";
import { onScreen } from "./on-screen.mjs";

const SOW = `# Statement of Work — Harbor & Pine Online Store

## 3. Scope of work

### 3.1 Storefront and Checkout

In scope:
- Product catalogue and search
- Shopping cart
- Stripe checkout

Out of scope:
- Loyalty points programme
- Gift cards

### 3.2 Accounts

In scope:
- Customer accounts with email sign-in
- Order history

Out of scope:
- Single sign-on
`;

export async function journey({ browser, app, github, fake, out, results, serverLog }) {
  const problems = [];
  const watch = (page, who) => {
    page.on("pageerror", (e) => problems.push(`${who} page error: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      // The browser logs every non-2xx response it fetched; those are judged by status below.
      if (/Failed to load resource/.test(text)) return;
      problems.push(`${who} console: ${text}`);
    });
    page.on("response", (r) => {
      if (r.status() >= 500 && r.url().startsWith(app)) problems.push(`${who} ${r.status()} ${r.request().method()} ${r.url()}`);
    });
  };

  let stop = false;
  const step = async (page, name, fn) => {
    if (stop) return results.push({ ok: false, name, detail: "skipped after an earlier failure" });
    try {
      await fn();
      results.push({ ok: true, name });
    } catch (err) {
      results.push({ ok: false, name, detail: `${(err?.message ?? String(err)).split("\n")[0]}${await onScreen(page)}` });
      await page?.screenshot({ path: path.join(out, `fail-${results.length}.png`), fullPage: true }).catch(() => {});
      stop = true;
    }
  };
  const control = (p, body) =>
    fetch(`${github}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const ghState = () => fetch(`${github}/__e2e/state`).then((r) => r.json());
  const until = async (fn, what, ms = 20_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  /** Reloads until a result row matching every text appears; each reload waits for the list to load. */
  const resultAppears = (page, texts, what) =>
    until(async () => {
      await page.reload();
      await page.getByRole("heading", { name: "Checked pull requests" }).waitFor();
      let row = page.getByTestId("pr-result");
      for (const t of texts) row = row.filter({ hasText: t });
      return row.first().waitFor({ timeout: 3000 }).then(() => true, () => false);
    }, what, 30_000);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page, "dana");
  page.setDefaultTimeout(15_000);
  let projectUrl = "";

  await step(page, "Signing in with GitHub lands a new PM in an empty workspace", async () => {
    await page.goto(`${app}/app`);
    await page.getByTestId("button-sign-in").click();
    await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Set up your first project" }).waitFor();
    await shot(page, "01-empty-workspace");
  });

  await step(page, "A project is created with its client and rate", async () => {
    await page.getByTestId("button-new-project").click();
    await page.getByLabel("Project name").fill("Harbor & Pine store");
    await page.getByLabel(/^Client/).fill("Harbor & Pine");
    await page.getByLabel(/^Hourly rate/).fill("150");
    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByRole("heading", { name: "Harbor & Pine store" }).waitFor();
    projectUrl = page.url();
  });

  await step(page, "The statement of work is read and saved as scope v1", async () => {
    await page.locator("#project-sow").fill(SOW);
    await page.getByRole("button", { name: "Read the scope" }).click();
    await page.getByText("loyalty points programme", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Save this scope" }).click();
    await page.getByText(/Saved as v1/).waitFor();
    await shot(page, "02-scope-saved");
  });

  await step(page, "The GitHub repository is connected", async () => {
    await page.getByTestId("button-choose-repo").click();
    await page.getByLabel(/harbor-agency\/storefront/).check();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("link", { name: "harbor-agency/storefront" }).waitFor();
  });

  const head1 = "a1".repeat(20);
  await step(page, "A pull request building excluded work is flagged on GitHub and in the app", async () => {
    const sent = await control("/__e2e/pull-request", {
      repo: "harbor-agency/storefront",
      number: 12,
      title: "Add loyalty points at checkout",
      body: "Customers earn points on every order.",
      branch: "feat/loyalty-points",
      sha: head1,
      files: [
        { filename: "src/loyalty/points.ts", status: "added", additions: 120, deletions: 0 },
        { filename: "src/checkout/summary.tsx", status: "modified", additions: 14, deletions: 3 },
      ],
    });
    if (sent.delivered !== 202) throw new Error(`webhook answered ${sent.delivered}`);
    const run = await until(async () => (await ghState()).checkRuns.find((r) => r.head_sha === head1 && r.output?.title), "a check run");
    if (run.output.title !== "ScopeCI: Change order needed") throw new Error(`check run says "${run.output.title}"`);
    const comments = (await ghState()).comments["harbor-agency/storefront#12"] ?? [];
    if (comments.length !== 1) throw new Error(`${comments.length} comments on the pull request`);
    await resultAppears(page, ["#12", "Change order needed"], "the result in the app");
    await shot(page, "03-flagged");
  });

  await step(page, "A pull request opened before connecting is checked by Re-check", async () => {
    await control("/__e2e/pull-request", {
      repo: "harbor-agency/storefront",
      number: 9,
      title: "Search results paging",
      body: "",
      branch: "feat/search-paging",
      sha: "b2".repeat(20),
      files: [{ filename: "src/search/results.tsx", status: "modified", additions: 30, deletions: 8 }],
      silent: true,
    });
    await page.getByRole("button", { name: "Re-check open pull requests" }).click();
    await page.getByText(/Checking the open pull requests again/).waitFor();
    await resultAppears(page, ["#9", "In scope"], "the re-checked pull request");
  });

  await step(page, "The change order is priced, edited, saved and marked as sent", async () => {
    await page.getByRole("button", { name: "Open the change order for #12" }).click();
    const drawer = page.getByTestId("change-order-drawer");
    await drawer.waitFor();
    await drawer.getByLabel(/^Hours/).fill("10");
    await drawer.getByRole("button", { name: "Save hours" }).click();
    await drawer.getByText(/Hours saved/).waitFor();
    const letter = drawer.locator("textarea");
    await until(async () => (await letter.inputValue()).includes("$1,500"), "the priced letter");
    await letter.fill(`${await letter.inputValue()}\n\nHappy to talk it through on Thursday.`);
    // Closing with unsaved edits asks first; Cancel keeps them.
    await page.keyboard.press("Escape");
    const ask = page.getByRole("alertdialog");
    await ask.getByText("Discard your edits to the letter?").waitFor();
    await ask.getByRole("button", { name: "Cancel" }).click();
    await ask.waitFor({ state: "detached" });
    if (!(await letter.inputValue()).includes("Thursday")) throw new Error("the edit went on Cancel");
    await drawer.getByRole("button", { name: "Save draft" }).click();
    await drawer.getByText("Draft saved.").waitFor();
    await drawer.getByRole("button", { name: "Mark as sent" }).click();
    await drawer.getByText(/Marked as sent/).waitFor();
    await until(async () => letter.evaluate((el) => el.readOnly), "the sent letter to lock");
    await shot(page, "04-sent");
  });

  await step(page, "Recording the approval asks first, then clears the GitHub check", async () => {
    const drawer = page.getByTestId("change-order-drawer");
    await drawer.getByRole("button", { name: "Client approved" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Client approved" }).click();
    await drawer.getByText(/Recorded as approved/).waitFor();
    await until(
      async () => (await ghState()).checkRuns.find((r) => r.head_sha === head1)?.output?.title === "ScopeCI: Covered by an approved change",
      "the check to clear",
    );
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached" });
  });

  await step(page, "New excluded work after the approval gets its own change order", async () => {
    await control("/__e2e/pull-request", {
      repo: "harbor-agency/storefront",
      number: 12,
      title: "Add loyalty points and gift cards at checkout",
      body: "",
      branch: "feat/loyalty-points",
      sha: "e5".repeat(20),
      files: [
        { filename: "src/loyalty/points.ts", status: "modified", additions: 6, deletions: 1 },
        { filename: "src/giftcards/redeem.ts", status: "added", additions: 70, deletions: 0 },
      ],
    });
    await resultAppears(page, ["#12", "Change order needed", "needs its own change order"], "the follow-up flag");
    await page.getByRole("button", { name: "Open the change order for #12" }).click();
    const drawer = page.getByTestId("change-order-drawer");
    await drawer.getByText(/This one is for the work added since/).waitFor();
    await drawer.getByLabel(/^Hours/).fill("4");
    await drawer.getByRole("button", { name: "Save hours" }).click();
    await drawer.getByText(/Hours saved/).waitFor();
    await drawer.getByText("CO-2").waitFor();
    await shot(page, "04b-follow-up");
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached" });
  });

  await step(page, "A pull request that needs a decision is accepted with a reason, then withdrawn", async () => {
    const sha = "f6".repeat(20);
    await control("/__e2e/pull-request", {
      repo: "harbor-agency/storefront",
      number: 15,
      title: "Export orders as CSV",
      body: "Adds a CSV export of orders for the finance team.",
      branch: "feat/orders-csv",
      sha,
      files: [{ filename: "src/admin/orders-export.ts", status: "added", additions: 64, deletions: 0 }],
    });
    await resultAppears(page, ["#15", "Needs a decision"], "the review result");
    const dialog = page.getByTestId("accept-dialog");
    // A reason typed and then cancelled doesn't come back next time.
    await page.getByRole("button", { name: "Accept #15 without a change order" }).click();
    await dialog.getByLabel("Why").fill("a reason meant for another pull request");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Accept #15 without a change order" }).click();
    if ((await dialog.getByLabel("Why").inputValue()) !== "") throw new Error("the cancelled reason came back");
    await dialog.getByRole("button", { name: "Accept", exact: true }).click();
    await dialog.getByText(/Say why/).waitFor();
    await dialog.getByLabel("Why").fill("Finance export was agreed as part of order history.");
    await dialog.getByRole("button", { name: "Accept", exact: true }).click();
    await page.getByText(/#15 accepted/).waitFor();
    await resultAppears(page, ["#15", "Accepted without a change order", "Accepted by @dana-pm"], "the accepted result");
    const run = (await ghState()).checkRuns.find((r) => r.head_sha === sha);
    if (run?.output?.title !== "ScopeCI: Accepted without a change order") throw new Error(`check run says "${run?.output?.title}"`);
    await shot(page, "04c-accepted");
    await page.getByRole("button", { name: "Withdraw the acceptance of #15" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Withdraw" }).click();
    await resultAppears(page, ["#15", "Needs a decision"], "the withdrawn result");
  });

  await step(page, "Policy changes are saved", async () => {
    await page.getByLabel(/Fail the check/).check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.getByText(/Saved/).first().waitFor();
  });

  let inviteUrl = "";
  await step(page, "An owner makes an invite link", async () => {
    await page.getByTestId("link-team").click();
    await page.getByRole("button", { name: "Make an invite link" }).click();
    inviteUrl = await page.locator("#invite-url").inputValue();
    if (!inviteUrl.includes("/app/invite/")) throw new Error(`invite link was "${inviteUrl}"`);
  });

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await ctx2.newPage();
  watch(phone, "eve");
  phone.setDefaultTimeout(15_000);
  await step(phone, "A teammate signs in from the invite on a phone and joins", async () => {
    await control("/__e2e/sign-in-as", { login: "eve" });
    await phone.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, app));
    await phone.getByTestId("button-sign-in").click();
    await phone.getByTestId("button-join").click();
    await phone.getByText("Harbor & Pine store").waitFor();
    await shot(phone, "05-teammate-joined");
  });

  await step(page, "The owner sees the new member, and the activity log says who did what", async () => {
    await page.reload();
    await page.getByText("@eve-dev").first().waitFor();
    const activity = page.getByTestId("activity-list");
    await activity.getByText("joined the workspace").waitFor();
    await activity.getByText("made an invite link").waitFor();
    await activity.getByText(/connected .+ to "/).first().waitFor();
  });

  await step(page, "The owner makes the teammate an owner", async () => {
    await page.getByRole("button", { name: "Make @eve-dev an owner" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Make owner" }).click();
    await page.getByText("@eve-dev is now an owner.").waitFor();
    await page.getByText(/@eve-dev · owner/).waitFor();
    await shot(page, "06-team");
  });

  await step(phone, "The teammate leaves the workspace", async () => {
    await phone.goto(`${app}/app/team`);
    await phone.getByRole("button", { name: "Leave workspace" }).click();
    await phone.getByRole("alertdialog").getByRole("button", { name: "Leave workspace" }).click();
    await phone.getByRole("heading", { name: "Projects", exact: true }).waitFor();
    if (await phone.getByText("Harbor & Pine store").count()) throw new Error("still sees the agency's project");
  });

  await step(page, "Archiving a project asks first and removes it from the list", async () => {
    await page.goto(projectUrl);
    await page.getByRole("button", { name: "Archive project" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive project" }).click();
    await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
    if ((await page.getByTestId("project-card").count()) !== 0) throw new Error("the archived project is still listed");
  });

  await step(page, "An archived project can be restored from the list", async () => {
    await page.getByRole("button", { name: "Archived projects" }).click();
    await page.getByRole("button", { name: "Restore Harbor & Pine store" }).click();
    await page.getByText(/Harbor & Pine store is back/).waitFor();
    await page.getByTestId("project-card").first().waitFor();
    // Archive it again, so the error drills can connect its repository elsewhere.
    await page.getByTestId("project-card").first().click();
    await page.getByRole("button", { name: "Archive project" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive project" }).click();
    await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
  });

  await step(page, "Signing out returns to the sign-in page", async () => {
    await page.getByRole("button", { name: /Sign out/ }).click();
    await page.getByTestId("button-sign-in").waitFor();
  });

  await step(page, "A visitor compares plans yearly, then asks about a larger plan", async () => {
    await page.goto(`${app}/pricing`);
    await page.getByRole("heading", { name: "One price for the agency, not for each seat.", level: 1 }).waitFor();
    await page.getByTestId("price-studio").getByText("$49", { exact: true }).waitFor();
    await page.getByTestId("button-billing-yearly").click();
    await page.getByTestId("price-studio").getByText("$490", { exact: true }).waitFor();
    await page.getByTestId("price-agency").getByText("$1,490", { exact: true }).waitFor();
    await page.getByTestId("plan-larger").getByRole("link", { name: "Write to us" }).click();
    await page.getByRole("heading", { name: "Write to a person." }).waitFor();
    const topic = await page.getByTestId("select-contact-topic").inputValue();
    if (topic !== "pilot") throw new Error(`The contact form opened on "${topic}", not the pricing topic`);
  });

  const note = "Does the check read Bitbucket pull requests? We are moving two clients next quarter.";
  await step(page, "A visitor reads the terms and sends a message from the contact form", async () => {
    await page.goto(`${app}/terms`);
    await page.getByRole("heading", { name: "Terms of Service", level: 1 }).waitFor();
    await page.getByTestId("link-contact-footer").click();
    await page.getByRole("heading", { name: "Write to a person." }).waitFor();
    await page.getByTestId("input-contact-name").fill("Mara Lindqvist");
    await page.getByTestId("input-contact-email").fill("mara@northwind.example");
    await page.getByTestId("select-contact-topic").selectOption("pilot");
    await page.getByTestId("input-contact-message").fill(note);
    await page.getByTestId("button-contact-send").click();
    await page.getByTestId("contact-sent").getByText("mara@northwind.example").waitFor();
  });

  await step(page, "The message is in the admin inbox, and can be deleted", async () => {
    await page.goto(`${app}/admin`);
    await page.locator("#admin-key").fill("e2e-admin-secret-0123456789");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Messages" }).waitFor();
    await page.getByText(note).waitFor();
    await page.getByRole("button", { name: "Delete the message from Mara Lindqvist" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /Delete/ }).click();
    await page.getByText(note).waitFor({ state: "detached" });
  });

  results.push({
    ok: problems.length === 0,
    name: "No page errors, console errors or 5xx answers anywhere",
    detail: problems.slice(0, 5).join(" | "),
  });
  const serverErrors = serverLog.join("").split("\n").filter((l) => /"level":(50|60)/.test(l));
  results.push({ ok: serverErrors.length === 0, name: "The server logged no errors on the happy path", detail: serverErrors.slice(0, 2).join(" | ") });
  await ctx.close();
  await ctx2.close();
}
