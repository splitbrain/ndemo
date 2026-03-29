import type { Page } from "playwright";
import type { DoneCondition } from "./schema.js";

const DEFAULT_TIMEOUT = 15000;

async function waitForDone(
  page: Page,
  done: DoneCondition,
  timeout = DEFAULT_TIMEOUT
): Promise<void> {
  const promises: Promise<unknown>[] = [];

  if (done.visible)
    promises.push(
      page.locator(done.visible)
        .waitFor({ state: "visible", timeout })
    );
  if (done.hidden)
    promises.push(
      page.locator(done.hidden)
        .waitFor({ state: "hidden", timeout })
    );
  if (done.networkIdle)
    promises.push(
      page.waitForLoadState("networkidle")
    );
  if (done.url)
    promises.push(
      page.waitForURL(done.url, { timeout })
    );
  if (done.stable)
    promises.push(
      waitForDomStable(page, done.stable)
    );
  if (done.text)
    promises.push(
      page.locator(done.text.selector)
        .filter({ hasText: done.text.has })
        .waitFor({ state: "visible", timeout })
    );
  if (done.attribute)
    promises.push(
      page.locator(
        `${done.attribute.selector}` +
        `[${done.attribute.name}="${done.attribute.value}"]`
      ).waitFor({ state: "visible", timeout })
    );

  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

async function waitForDomStable(page: Page, ms: number): Promise<void> {
  await page.evaluate((timeout: number) => {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, timeout);
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, timeout);
    });
  }, ms);
}

export { waitForDone };
