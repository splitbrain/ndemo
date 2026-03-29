import type { Page } from "playwright";

async function readPageState(
  page: Page,
  options: { screenshot?: boolean }
): Promise<string> {
  const url = page.url();
  const title = await page.title();

  const lines: string[] = [];
  lines.push(`url: ${url}`);
  lines.push(`title: ${title}`);
  lines.push("---");

  // Use ariaSnapshot which returns a YAML-like string representation
  try {
    const snapshot = await page.locator("body").ariaSnapshot({ timeout: 10000 });
    lines.push(snapshot);
  } catch {
    lines.push("(empty accessibility tree)");
  }

  if (options.screenshot) {
    await page.screenshot({ path: ".ndemo/screenshot.png" });
    lines.push("---");
    lines.push("screenshot saved to .ndemo/screenshot.png");
  }

  return lines.join("\n");
}

export { readPageState };
