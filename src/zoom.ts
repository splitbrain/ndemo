import type { Page } from "playwright";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Path to the zoom extension bundled by the playwright-zoom package. */
const ZOOM_EXTENSION_PATH = path.join(
  path.dirname(require.resolve("playwright-zoom")),
  "lib",
  "zoom-extension",
);

/**
 * Chrome args needed to load the zoom extension.
 * Must be spread into the `args` array when launching the browser.
 */
function zoomExtensionArgs(): string[] {
  return [
    `--disable-extensions-except=${ZOOM_EXTENSION_PATH}`,
    `--load-extension=${ZOOM_EXTENSION_PATH}`,
  ];
}

/**
 * Set real browser zoom on a page via the playwright-zoom extension.
 *
 * This triggers `chrome.tabs.setZoom()` through the extension, which
 * behaves like Ctrl+/- zoom: viewport units (vh/vw) adjust, media
 * queries respond, and `window.innerWidth`/`innerHeight` reflect the
 * zoomed viewport. The zoom persists across navigations within the tab.
 *
 * The page must be on an HTTP(S) URL (not about:blank or data:) so the
 * extension's content script is active.
 */
async function setBrowserZoom(page: Page, zoomPercent: number): Promise<void> {
  // Uses the same postMessage protocol as playwright-zoom's setBrowserZoom,
  // but typed against playwright's Page (not @playwright/test's Page).
  await page.evaluate(
    (zoom: number) => window.postMessage({ type: "setTabZoom", browserZoom: zoom }, "*"),
    zoomPercent,
  );
  // The extension applies zoom asynchronously; wait for it to take effect.
  await page.waitForTimeout(200);
}

export { ZOOM_EXTENSION_PATH, zoomExtensionArgs, setBrowserZoom };
