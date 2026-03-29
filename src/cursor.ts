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
  opacity: 0;
  transition: left 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              top 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              opacity 0.25s ease;
}
#ndemo-cursor.visible {
  opacity: 1;
}
#ndemo-cursor.clicking {
  transform: translate(-50%, -50%) scale(0.7);
  transition: left 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              top 0.35s cubic-bezier(0.22, 1, 0.36, 1),
              opacity 0.25s ease,
              transform 0.1s ease-in;
}

#ndemo-highlight {
  position: fixed;
  pointer-events: none;
  z-index: 2147483646;
  border-radius: 4px;
  border: 2px solid rgba(255, 60, 60, 0.7);
  background: rgba(255, 60, 60, 0.08);
  transition: opacity 0.3s ease, left 0.3s ease, top 0.3s ease,
              width 0.3s ease, height 0.3s ease;
  opacity: 0;
}
#ndemo-highlight.visible {
  opacity: 1;
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

/**
 * Get an element's center and bounding rect in coordinates that work
 * for our fixed-position cursor, accounting for CSS zoom on body.
 */
async function getElementPosition(locator: Locator): Promise<{
  cx: number; cy: number;
  rect: { x: number; y: number; width: number; height: number };
} | null> {
  try {
    return await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const zoom = parseFloat(document.body.style.zoom) || 1;
      // getBoundingClientRect returns zoomed coordinates in the viewport.
      // Fixed-position elements inside a zoomed body are also zoomed,
      // so we need to divide by zoom to get the right CSS position.
      return {
        cx: (r.left + r.width / 2) / zoom,
        cy: (r.top + r.height / 2) / zoom,
        rect: {
          x: r.left / zoom,
          y: r.top / zoom,
          width: r.width / zoom,
          height: r.height / zoom,
        },
      };
    });
  } catch {
    return null;
  }
}

/**
 * Animate cursor to a locator's center, briefly flash the highlight,
 * then return so the caller can perform the action.
 */
async function pointAt(page: Page, locator: Locator): Promise<void> {
  await injectCursor(page);

  const pos = await getElementPosition(locator);
  if (!pos) return;

  // Move cursor and show highlight
  await page.evaluate(({ cx, cy, rect }: {
    cx: number; cy: number;
    rect: { x: number; y: number; width: number; height: number };
  }) => {
    const padding = 4;
    const cursor = document.getElementById("ndemo-cursor");
    const highlight = document.getElementById("ndemo-highlight");
    if (cursor) {
      cursor.style.left = cx + "px";
      cursor.style.top = cy + "px";
      cursor.classList.add("visible");
    }
    if (highlight) {
      highlight.style.left = (rect.x - padding) + "px";
      highlight.style.top = (rect.y - padding) + "px";
      highlight.style.width = (rect.width + padding * 2) + "px";
      highlight.style.height = (rect.height + padding * 2) + "px";
      highlight.classList.add("visible");
      // Auto-hide highlight after 600ms
      setTimeout(() => highlight.classList.remove("visible"), 600);
    }
  }, pos);

  // Wait for cursor travel animation
  await page.waitForTimeout(400);
}

/**
 * Show click feedback (cursor shrink) BEFORE the actual click.
 * This ensures the effect is visible even if the click causes navigation.
 */
async function clickEffect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cursor = document.getElementById("ndemo-cursor");
    if (!cursor) return;
    cursor.classList.add("clicking");
    setTimeout(() => {
      cursor.classList.remove("clicking");
      cursor.classList.remove("visible");
    }, 150);
  });
  await page.waitForTimeout(200);
}

/**
 * Fade out the cursor after a non-click action (type, hover, select).
 */
async function hideCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById("ndemo-cursor")?.classList.remove("visible");
  });
}

export { injectCursor, pointAt, clickEffect, hideCursor };
