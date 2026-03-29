import type { Page, Locator } from "playwright";

const CURSOR_STYLE = `
#ndemo-cursor {
  position: fixed;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 60, 60, 0.85);
  border: 2px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.3);
  pointer-events: none;
  z-index: 2147483647;
  transform: translate(-50%, -50%);
  transition: left 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              top 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  display: none;
}
#ndemo-cursor.visible {
  display: block;
}
#ndemo-cursor.clicking {
  transform: translate(-50%, -50%) scale(0.7);
  transition: left 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              top 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.1s ease-in;
}

#ndemo-highlight {
  position: fixed;
  pointer-events: none;
  z-index: 2147483646;
  border-radius: 4px;
  border: 2px solid rgba(255, 60, 60, 0.7);
  background: rgba(255, 60, 60, 0.08);
  transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  display: none;
}
#ndemo-highlight.visible {
  display: block;
}
`;

async function injectCursor(page: Page): Promise<void> {
  const already = await page.evaluate(() =>
    !!document.getElementById("ndemo-cursor")
  );
  if (already) return;

  await page.evaluate((css: string) => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const cursor = document.createElement("div");
    cursor.id = "ndemo-cursor";
    document.body.appendChild(cursor);

    const highlight = document.createElement("div");
    highlight.id = "ndemo-highlight";
    document.body.appendChild(highlight);
  }, CURSOR_STYLE);
}

async function showCursorAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(({ x, y }: { x: number; y: number }) => {
    const cursor = document.getElementById("ndemo-cursor");
    if (!cursor) return;
    cursor.style.left = x + "px";
    cursor.style.top = y + "px";
    cursor.classList.add("visible");
  }, { x, y });
}

async function highlightRect(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
  padding = 4
): Promise<void> {
  await page.evaluate(({ rect, padding }: {
    rect: { x: number; y: number; width: number; height: number };
    padding: number;
  }) => {
    const el = document.getElementById("ndemo-highlight");
    if (!el) return;
    el.style.left = (rect.x - padding) + "px";
    el.style.top = (rect.y - padding) + "px";
    el.style.width = (rect.width + padding * 2) + "px";
    el.style.height = (rect.height + padding * 2) + "px";
    el.classList.add("visible");
  }, { rect, padding });
}

async function hideHighlight(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("ndemo-highlight")?.classList.remove("visible");
  });
}

async function clickEffect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cursor = document.getElementById("ndemo-cursor");
    if (!cursor) return;
    cursor.classList.add("clicking");
    setTimeout(() => cursor.classList.remove("clicking"), 150);
  });
}

/**
 * Animate cursor to a locator's center, highlight the element,
 * then return so the caller can perform the action.
 */
async function pointAt(page: Page, locator: Locator): Promise<void> {
  await injectCursor(page);

  const box = await locator.boundingBox();
  if (!box) return;

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await highlightRect(page, box);
  await showCursorAt(page, cx, cy);
  // Let the transition animate
  await page.waitForTimeout(400);
}

/**
 * Show click feedback (cursor shrink), then hide highlight after a delay.
 */
async function clickFeedback(page: Page): Promise<void> {
  await clickEffect(page);
  await page.waitForTimeout(200);
  await hideHighlight(page);
}

export { injectCursor, pointAt, clickFeedback, hideHighlight, showCursorAt };
