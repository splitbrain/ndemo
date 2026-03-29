import type { Page } from "playwright";
import { execa } from "execa";
import type { SetupStep, Condition } from "./schema.js";
import { executeAction } from "./executor.js";

async function checkCondition(
  page: Page,
  condition: Condition
): Promise<boolean> {
  if (condition.visible) {
    const count = await page.locator(condition.visible).count();
    if (count === 0) return false;
  }
  if (condition.hidden) {
    const count = await page.locator(condition.hidden).count();
    if (count > 0) return false;
  }
  if (condition.url) {
    const url = page.url();
    // Support glob-like patterns with **
    const pattern = condition.url
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    if (!new RegExp(`^${pattern}$`).test(url)) return false;
  }
  return true;
}

function isRunStep(step: SetupStep): step is { run: string; if?: Condition } {
  return "run" in step;
}

async function executeSetup(
  page: Page | null,
  steps: SetupStep[],
  options: { cwd?: string } = {}
): Promise<void> {
  for (const step of steps) {
    // Check condition
    const condition = step.if;
    if (condition && page) {
      const met = await checkCondition(page, condition);
      if (!met) continue;
    }

    if (isRunStep(step)) {
      process.stderr.write(`  run: ${step.run}\n`);
      try {
        await execa("sh", ["-c", step.run], {
          stdout: process.stderr,
          stderr: process.stderr,
          stdin: "ignore",
          cwd: options.cwd,
        });
      } catch (err: any) {
        throw new Error(`Setup command failed: ${step.run}\n${err.message}`);
      }
    } else {
      if (!page) {
        throw new Error("Setup browser action requires an open page");
      }
      await executeAction(page, step);
    }
  }
}

export { executeSetup, checkCondition };
