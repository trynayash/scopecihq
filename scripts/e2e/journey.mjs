// The journey a pilot PM takes, through the real UI, checked step by step.
// Each step is named for what a person would notice if it broke.

import path from "node:path";

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
      results.push({ ok: false, name, detail: (err?.message ?? String(err)).split("\n")[0] });
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
  page.setDefaultTimeout(10_000);
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
  phone.setDefaultTimeout(10_000);
  await step(phone, "A teammate signs in from the invite on a phone and joins", async () => {
    await control("/__e2e/sign-in-as", { login: "eve" });
    await phone.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, app));
    await phone.getByTestId("button-sign-in").click();
    await phone.getByTestId("button-join").click();
    await phone.getByText("Harbor & Pine store").waitFor();
    await shot(phone, "05-teammate-joined");
  });

  await step(page, "The owner sees the new member", async () => {
    await page.reload();
    await page.getByText("@eve-dev").waitFor();
  });

  await step(page, "Archiving a project asks first and removes it from the list", async () => {
    await page.goto(projectUrl);
    await page.getByRole("button", { name: "Archive project" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive project" }).click();
    await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
    if ((await page.getByTestId("project-card").count()) !== 0) throw new Error("the archived project is still listed");
  });

  await step(page, "Signing out returns to the sign-in page", async () => {
    await page.getByRole("button", { name: /Sign out/ }).click();
    await page.getByTestId("button-sign-in").waitFor();
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
