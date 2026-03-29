import type { Page, Locator } from "playwright";
import type { Target } from "./schema.js";

function toLocator(page: Page, target: Target): Locator {
  if (target.role) {
    const opts: Record<string, string> = {};
    if (target.name) opts.name = target.name;
    return page.getByRole(target.role as any, opts);
  }
  if (target.label) return page.getByLabel(target.label);
  if (target.text) return page.getByText(target.text);
  if (target.placeholder) return page.getByPlaceholder(target.placeholder);
  if (target.testId) return page.getByTestId(target.testId);
  if (target.selector) return page.locator(target.selector);
  throw new Error(
    `Cannot resolve locator from target: ${JSON.stringify(target)}`
  );
}

export { toLocator };
