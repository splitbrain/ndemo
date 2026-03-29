import type { Page } from "playwright";
import type { Action, Segment } from "./schema.js";
import { toLocator } from "./locators.js";
import { waitForDone } from "./waiters.js";
import { pointAt, clickFeedback, hideHighlight } from "./cursor.js";

async function executeAction(
  page: Page,
  action: Action,
  options: { cursor?: boolean } = {}
): Promise<void> {
  const showCursor = options.cursor ?? false;

  if (action.type === "wait") {
    await page.waitForTimeout(action.duration ?? 1000);
    return;
  }

  if (action.type === "press") {
    await page.keyboard.press(action.key!);
    if (action.done) await waitForDone(page, action.done);
    return;
  }

  const locator = toLocator(page, action.target!);

  if (showCursor && (action.type === "click" || action.type === "type"
      || action.type === "hover" || action.type === "select")) {
    await pointAt(page, locator);
  }

  switch (action.type) {
    case "click":
      await locator.click();
      if (showCursor) await clickFeedback(page);
      break;
    case "type":
      await locator.fill("");
      await locator.pressSequentially(
        action.text!,
        { delay: action.delay ?? 80 }
      );
      if (showCursor) await hideHighlight(page);
      break;
    case "hover":
      await locator.hover();
      if (showCursor) await hideHighlight(page);
      break;
    case "scroll":
      await locator.scrollIntoViewIfNeeded();
      break;
    case "select":
      await locator.selectOption(action.option!);
      if (showCursor) await clickFeedback(page);
      break;
  }

  if (action.done) {
    await waitForDone(page, action.done);
  }
}

interface SegmentResult {
  ok: boolean;
  error?: string;
  actionIndex?: number;
}

async function executeSegment(
  page: Page,
  segment: Segment,
  options: { cursor?: boolean } = {}
): Promise<SegmentResult> {
  for (let i = 0; i < segment.actions.length; i++) {
    try {
      await executeAction(page, segment.actions[i], options);
    } catch (err) {
      return {
        ok: false,
        error: String(err),
        actionIndex: i,
      };
    }
  }
  return { ok: true };
}

export { executeAction, executeSegment };
