// The ways a pilot can go wrong, through the real UI: GitHub down, the
// browser offline, a session that ends, the server failing, a project that
// isn't there, a webhook that can't be processed, the database going away.
// Each must say what happened in words and offer a way on; none may leave a
// blank screen, a spinner forever or a raw error.

import path from "node:path";
import { execSync } from "node:child_process";

export async function errorJourney({ browser, app, github, out, results }) {
  const step = async (page, name, fn) => {
    try {
      await fn();
      results.push({ ok: true, name });
    } catch (err) {
      results.push({ ok: false, name, detail: (err?.message ?? String(err)).split("\n")[0] });
      await page?.screenshot({ path: path.join(out, `fail-errors-${results.length}.png`), fullPage: true }).catch(() => {});
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
  const api = (page, method, url, body) =>
    page.evaluate(
      async ([m, u, b]) => {
        const res = await fetch(u, { method: m, headers: b ? { "content-type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined });
        return { status: res.status, body: await res.json().catch(() => null) };
      },
      [method, url, body],
    );

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10_000);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await control("/__e2e/sign-in-as", { login: "dana" });
  await page.goto(`${app}/app`);
  await page.getByTestId("button-sign-in").click();
  await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();

  // A project set up through the API, so these checks start from a known state.
  const created = await api(page, "POST", "/api/projects", { name: "Error drills", clientName: "Harbor & Pine", hourlyRate: 120 });
  const projectId = created.body.id;
  await api(page, "PUT", `/api/projects/${projectId}/scope`, {
    title: "Error drills SOW",
    clauses: [{ clauseRef: "§1", title: "Storefront", included: ["shopping cart"], excluded: ["gift cards"] }],
  });

  await step(page, "GitHub down: the repository list says so and Try again recovers", async () => {
    // Three refusals outlast the server's own two retries.
    await control("/__e2e/fail", { path: "/user/installations", status: 502, times: 3 });
    await page.goto(`${app}/app/projects/${projectId}`);
    await page.getByTestId("button-choose-repo").click();
    await page.getByText("GitHub didn't answer properly. Try again in a minute.").waitFor();
    await page.screenshot({ path: path.join(out, "err-github-down.png") });
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByLabel(/harbor-agency\/storefront/).check();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("link", { name: "harbor-agency/storefront" }).waitFor();
  });

  await step(page, "Offline: a notice appears, saving says why it failed, and works once back", async () => {
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByText("You're offline. Nothing can be saved until you reconnect.").waitFor();
    await page.getByLabel("Project name").fill("Error drills (renamed)");
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.getByText("You're offline. Reconnect and try again.").waitFor();
    await page.screenshot({ path: path.join(out, "err-offline.png") });
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.getByRole("heading", { name: "Error drills (renamed)" }).waitFor();
  });

  await step(page, "Server trouble: a failed load is put into words with Try again", async () => {
    let fail = true;
    await page.route(`**/api/projects/${projectId}/pull-requests`, (route) =>
      fail ? route.fulfill({ status: 503, contentType: "text/html", body: "<html>Service Unavailable</html>" }) : route.fallback(),
    );
    await page.reload();
    await page.getByText("ScopeCI is having trouble right now. Try again in a minute.").waitFor({ timeout: 15_000 });
    await page.screenshot({ path: path.join(out, "err-server.png") });
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    // The repository's open pull requests were checked when it was connected.
    await page.getByTestId("pr-result").first().waitFor();
    if (await page.locator(".load-error").count()) throw new Error("the error stayed after a good retry");
    await page.unroute(`**/api/projects/${projectId}/pull-requests`);
  });

  await step(page, "A project that isn't there says so, with the way back", async () => {
    await page.goto(`${app}/app/projects/00000000-0000-4000-8000-000000000000`);
    await page.getByText(/No such project in this workspace/).waitFor();
    await page.getByRole("link", { name: "Back to your projects" }).click();
    await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
  });

  await step(page, "A webhook that can't be processed leaves a neutral check, and a re-check recovers", async () => {
    const sha = "c3".repeat(20);
    // Every try at the file list fails: the server retries twice, then gives up.
    await control("/__e2e/fail", { path: "/repos/harbor-agency/storefront/pulls/31/files", status: 500, times: 3 });
    await control("/__e2e/pull-request", {
      repo: "harbor-agency/storefront",
      number: 31,
      title: "Gift card balance page",
      branch: "feat/gift-cards",
      sha,
      files: [{ filename: "src/giftcards/balance.tsx", status: "added", additions: 80, deletions: 0 }],
    });
    const run = await until(async () => (await ghState()).checkRuns.find((r) => r.head_sha === sha), "a check run");
    if (run.output?.title !== "ScopeCI couldn't check this commit" || run.conclusion !== "neutral") {
      throw new Error(`check run was "${run.output?.title}" (${run.conclusion})`);
    }
    await page.goto(`${app}/app/projects/${projectId}`);
    await page.getByRole("button", { name: "Re-check open pull requests" }).click();
    await until(async () => {
      await page.reload();
      await page.getByRole("heading", { name: "Checked pull requests" }).waitFor();
      return page.getByTestId("pr-result").filter({ hasText: "#31" }).filter({ hasText: "Change order needed" }).first()
        .waitFor({ timeout: 3000 }).then(() => true, () => false);
    }, "the re-checked result", 30_000);
  });

  await step(page, "A session that ends mid-use goes back to sign-in, not a page of errors", async () => {
    await page.goto(`${app}/app/projects/${projectId}`);
    await page.getByRole("button", { name: "Re-check open pull requests" }).waitFor();
    await ctx.clearCookies();
    await page.getByRole("button", { name: "Re-check open pull requests" }).click();
    await page.getByTestId("button-sign-in").waitFor();
  });

  if (process.env.E2E_DB_STOP && process.env.E2E_DB_START) {
    await step(page, "Database down: the app says so plainly and recovers when it's back", async () => {
      // Signing in returns to the page they were on; then go to the list.
      await page.getByTestId("button-sign-in").click();
      await page.getByRole("button", { name: /Sign out/ }).waitFor();
      await page.goto(`${app}/app`);
      await page.getByRole("heading", { name: "Projects", exact: true }).waitFor();
      execSync(process.env.E2E_DB_STOP, { stdio: "ignore" });
      try {
        await page.reload();
        await page.getByText(/can't reach its database right now/).waitFor({ timeout: 20_000 });
        await page.screenshot({ path: path.join(out, "err-database.png") });
      } finally {
        execSync(process.env.E2E_DB_START, { stdio: "ignore" });
      }
      await until(async () => {
        await page.getByRole("button", { name: "Try again" }).click().catch(() => {});
        return page.getByRole("heading", { name: "Projects", exact: true }).isVisible();
      }, "the app to recover", 30_000);
    });
  }

  results.push({ ok: pageErrors.length === 0, name: "No page errors during the error drills", detail: pageErrors.slice(0, 3).join(" | ") });
  await ctx.close();
}
