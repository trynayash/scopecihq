/**
 * What the page said when a step failed: its error and status lines and the
 * open side panel, so a failure on CI (where the screenshots are only an
 * artifact) can be read from the log.
 */
export async function onScreen(page) {
  if (!page) return "";
  try {
    const said = await page.evaluate(() => {
      const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
      const texts = [...document.querySelectorAll(".form-error, [role=alert], .app-status, .notice, .stale-notice")]
        .filter(visible)
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      const drawer = document.querySelector("[data-testid=change-order-drawer]");
      if (drawer) texts.push(`panel: ${drawer.textContent.replace(/\s+/g, " ").trim().slice(0, 400)}`);
      return texts;
    });
    return said.length ? ` | on screen: ${said.join(" / ").slice(0, 900)}` : "";
  } catch {
    return "";
  }
}
